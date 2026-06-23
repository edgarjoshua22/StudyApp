import os
import io
import math
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from supabase import create_client
from pypdf import PdfReader

app = FastAPI(title="StudyApp Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Connect to Gemini and Supabase ---
gemini = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_KEY"],
)


# --- Helper functions ---

def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Pull all the text out of a PDF."""
    reader = PdfReader(io.BytesIO(pdf_bytes))
    text = ""
    for page in reader.pages:
        text += (page.extract_text() or "") + "\n"
    return text


def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 150) -> list[str]:
    """Split long text into overlapping pieces small enough to embed."""
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        start = end - overlap  # step back a little so chunks overlap
    return [c.strip() for c in chunks if c.strip()]


def normalize(vec: list[float]) -> list[float]:
    """Scale a vector to length 1 (required when using 768 dimensions)."""
    length = math.sqrt(sum(x * x for x in vec))
    return [x / length for x in vec] if length > 0 else vec


def embed_text(text: str, task_type: str) -> list[float]:
    """Turn one piece of text into a 768-number vector via Gemini."""
    result = gemini.models.embed_content(
        model="gemini-embedding-001",
        contents=text,
        config=types.EmbedContentConfig(
            task_type=task_type,
            output_dimensionality=768,
        ),
    )
    return normalize(result.embeddings[0].values)


# --- Endpoints ---

@app.get("/")
def root():
    return {"message": "StudyApp backend is alive!"}


@app.post("/process-pdf")
def process_pdf(document_id: str):
    # 1. Look up the document row to find its file and owner
    doc = supabase.table("documents").select("*").eq("id", document_id).single().execute().data
    storage_path = doc["storage_path"]
    classroom_id = doc["classroom_id"]

    # Mark it as processing
    supabase.table("documents").update({"status": "processing"}).eq("id", document_id).execute()

    try:
        # 2. Download, extract, chunk
        pdf_bytes = supabase.storage.from_("handouts").download(storage_path)
        text = extract_text_from_pdf(pdf_bytes)
        chunks = chunk_text(text)

        if not chunks:
            supabase.table("documents").update({"status": "error"}).eq("id", document_id).execute()
            return {"error": "No text found in PDF (it may be a scanned image)."}

        # 3. Embed every chunk and build rows to insert
        rows = []
        for i, chunk in enumerate(chunks):
            embedding = embed_text(chunk, "RETRIEVAL_DOCUMENT")
            rows.append({
                "document_id": document_id,
                "classroom_id": classroom_id,
                "content": chunk,
                "embedding": embedding,
                "chunk_index": i,
            })

        # 4. Save all chunks to the database in one go
        supabase.table("document_chunks").insert(rows).execute()

        # 5. Mark the document ready
        supabase.table("documents").update({"status": "ready"}).eq("id", document_id).execute()

        return {"status": "ready", "chunks_saved": len(rows)}

    except Exception as e:
        supabase.table("documents").update({"status": "error"}).eq("id", document_id).execute()
        return {"error": str(e)}

@app.post("/ask")
def ask(question: str, classroom_id: str):
    # 1. Turn the question into a vector (note: QUERY task type, not DOCUMENT)
    query_embedding = embed_text(question, "RETRIEVAL_QUERY")

    # 2. Find the most relevant chunks in this classroom
    matches = supabase.rpc("match_chunks", {
        "query_embedding": query_embedding,
        "match_classroom_id": classroom_id,
        "match_count": 5,
    }).execute().data

    if not matches:
        return {
            "answer": "I couldn't find anything in your uploaded materials yet. Try uploading a handout first.",
            "sources": [],
        }

    # 3. Stitch the chunks into a context block
    context = "\n\n---\n\n".join(m["content"] for m in matches)

    # 4. Ask Gemini to answer using only that context
    prompt = f"""You are a helpful study tutor. Answer the student's question using ONLY the course materials below. If the answer isn't in the materials, say so clearly instead of guessing.

Course materials:
{context}

Question: {question}

Answer:"""

    response = gemini.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
    )

    return {
        "answer": response.text,
        "sources": [m["content"][:200] for m in matches],
    }