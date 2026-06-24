import os
import io
import math
import json
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


def dot(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def _parse_vec(e):
    if isinstance(e, str):
        try:
            return json.loads(e)
        except Exception:
            return None
    return e


def recompute_connections(owner_id, same_thresh=0.74, prereq_thresh=0.77, cross_thresh=0.82):
    """Rebuild the cheap 'shared' bridge edges from existing node embeddings.

    Re-extracts nothing (no LLM calls). Bridges each concept to its nearest
    relevant concept in OTHER handouts, and reconnects any orphaned concept
    (e.g. left stranded after a delete) so the map never falls apart.
    """
    nodes = (
        supabase.table("brain_nodes")
        .select("id,classroom_id,document_id,embedding")
        .eq("user_id", owner_id).execute().data
    )
    for n in nodes:
        n["_v"] = _parse_vec(n.get("embedding"))
    valid = [n for n in nodes if n.get("_v")]

    # Prerequisite-linked classrooms connect more eagerly in the whole brain
    prereqs = (
        supabase.table("classroom_prerequisites")
        .select("classroom_id,prereq_classroom_id").eq("user_id", owner_id).execute().data
    )
    prereq_pairs = {frozenset((p["classroom_id"], p["prereq_classroom_id"])) for p in prereqs}

    # Drop the previously derived bridges; keep within-handout ('related') + note edges
    supabase.table("brain_edges").delete().eq("user_id", owner_id).eq("kind", "shared").execute()

    kept = (
        supabase.table("brain_edges").select("source_node_id,target_node_id")
        .eq("user_id", owner_id).execute().data
    )
    deg = {}

    def bump(a, b):
        deg[a] = deg.get(a, 0) + 1
        deg[b] = deg.get(b, 0) + 1

    for e in kept:
        bump(e["source_node_id"], e["target_node_id"])

    new_edges = []
    seen = set()

    def add(a, b):
        if a == b:
            return
        s, t = sorted([a, b])
        if (s, t) in seen:
            return
        seen.add((s, t))
        new_edges.append({
            "user_id": owner_id, "source_node_id": s, "target_node_id": t,
            "relationship": "related concept", "kind": "shared",
        })
        bump(s, t)

    # Best cross-document match for each concept (within a similarity threshold)
    for i, a in enumerate(valid):
        best, best_sim = None, -1.0
        for j, b in enumerate(valid):
            if i == j or a["document_id"] == b["document_id"]:
                continue
            sim = dot(a["_v"], b["_v"])
            if a["classroom_id"] == b["classroom_id"]:
                thr = same_thresh
            elif frozenset((a["classroom_id"], b["classroom_id"])) in prereq_pairs:
                thr = prereq_thresh
            else:
                thr = cross_thresh
            if sim >= thr and sim > best_sim:
                best, best_sim = b, sim
        if best:
            add(a["id"], best["id"])

    # Repair: connect any still-isolated concept to its single nearest neighbor
    for a in valid:
        if deg.get(a["id"], 0) == 0:
            best, best_sim = None, -1.0
            for b in valid:
                if b["id"] == a["id"] or a["document_id"] == b["document_id"]:
                    continue
                sim = dot(a["_v"], b["_v"])
                if sim > best_sim:
                    best, best_sim = b, sim
            if best:
                add(a["id"], best["id"])

    if new_edges:
        supabase.table("brain_edges").upsert(
            new_edges, on_conflict="user_id,source_node_id,target_node_id", ignore_duplicates=True
        ).execute()
    return len(new_edges)


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
        # Clear any existing chunks so re-processing a new version doesn't duplicate
        supabase.table("document_chunks").delete().eq("document_id", document_id).execute()

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


@app.post("/generate-quiz")
def generate_quiz(classroom_id: str, document_id: str = None, num_questions: int = 5):
    # Keep the request sane
    num_questions = max(1, min(num_questions, 10))

    # 1. Gather source text from this classroom's processed chunks
    query = (
        supabase.table("document_chunks")
        .select("content")
        .eq("classroom_id", classroom_id)
    )
    if document_id:
        query = query.eq("document_id", document_id)
    chunks = query.order("chunk_index").limit(40).execute().data

    if not chunks:
        return {"error": "No processed material found yet. Upload and process a handout first."}

    # Bound how much text we send to Gemini
    source_text = "\n\n".join(c["content"] for c in chunks)[:12000]

    # 2. Ask Gemini for multiple-choice questions as strict JSON
    prompt = f"""You are a quiz writer for a study app. Using ONLY the course material below, write {num_questions} multiple-choice questions that test understanding of the material.

Rules:
- Each question has exactly 4 options.
- Exactly one option is correct.
- Base every question and answer strictly on the material. Do not invent facts.
- Vary which option is the correct one.
- Keep questions clear and concise.

Return ONLY valid JSON in exactly this shape, nothing else:
{{
  "questions": [
    {{
      "question": "string",
      "choices": ["string", "string", "string", "string"],
      "correct_index": 0,
      "explanation": "one short sentence grounded in the material"
    }}
  ]
}}

Course material:
{source_text}
"""

    try:
        response = gemini.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
            ),
        )
    except Exception as e:
        return {"error": f"The AI model could not be reached: {e}"}

    # 3. Parse and validate the model's JSON
    raw_text = (response.text or "").strip()
    if not raw_text:
        return {"error": "The model returned an empty response. Try again."}
    try:
        parsed = json.loads(raw_text)
        raw_questions = parsed["questions"]
    except Exception as e:
        return {"error": f"Could not parse quiz from model: {e}"}

    clean = []
    for q in raw_questions:
        choices = q.get("choices", [])
        idx = q.get("correct_index", 0)
        if not q.get("question") or not isinstance(choices, list) or len(choices) != 4:
            continue
        if not isinstance(idx, int) or idx < 0 or idx > 3:
            idx = 0
        clean.append({
            "question": q["question"],
            "choices": choices,
            "correct_index": idx,
            "explanation": q.get("explanation", ""),
        })

    if not clean:
        return {"error": "The model did not return usable questions. Try again."}

    # 4. Find the owner so RLS lets the app read this quiz later
    try:
        owner_rows = (
            supabase.table("classrooms").select("user_id")
            .eq("id", classroom_id).execute().data
        )
        if not owner_rows:
            return {"error": "Classroom not found."}
        owner_id = owner_rows[0]["user_id"]

        # Nicer title if we know the source document
        title = f"Quiz \u00b7 {len(clean)} questions"
        if document_id:
            doc = supabase.table("documents").select("file_name").eq("id", document_id).single().execute().data
            if doc and doc.get("file_name"):
                title = doc["file_name"].rsplit(".pdf", 1)[0] + " \u2014 Quiz"

        # 5. Save the quiz and its questions
        inserted = supabase.table("quizzes").insert({
            "classroom_id": classroom_id,
            "document_id": document_id,
            "user_id": owner_id,
            "title": title,
        }).execute().data
        if not inserted:
            return {"error": "Could not save the quiz (no row returned). Check the quizzes table."}
        quiz = inserted[0]

        rows = [
            {
                "quiz_id": quiz["id"],
                "position": i,
                "question": q["question"],
                "choices": q["choices"],
                "correct_index": q["correct_index"],
                "explanation": q["explanation"],
            }
            for i, q in enumerate(clean)
        ]
        supabase.table("quiz_questions").insert(rows).execute()
    except Exception as e:
        return {"error": f"Saving the quiz failed: {e}"}

    # 6. Return the quiz for immediate use
    return {
        "quiz_id": quiz["id"],
        "title": title,
        "questions": [
            {
                "position": r["position"],
                "question": r["question"],
                "choices": r["choices"],
                "correct_index": r["correct_index"],
                "explanation": r["explanation"],
            }
            for r in rows
        ],
    }


@app.post("/build-brain")
def build_brain(classroom_id: str, document_id: str = None, force: bool = False):
    """Build each handout's concept brain ONCE (thoroughly), then connect them.

    Extraction is the expensive part and only runs for handouts not yet built
    (or when force=True, e.g. after a new version). Connecting the handouts'
    brains together is cheap and always re-run, so deletes/additions stay tidy.
    """
    owner_id = (
        supabase.table("classrooms").select("user_id")
        .eq("id", classroom_id).single().execute().data["user_id"]
    )

    if document_id:
        target_docs = (
            supabase.table("documents").select("id,brain_built")
            .eq("id", document_id).execute().data
        )
    else:
        target_docs = (
            supabase.table("documents").select("id,brain_built")
            .eq("classroom_id", classroom_id).eq("status", "ready").execute().data
        ) or []

    if not target_docs:
        return {"error": "No processed handouts to map yet."}

    built = 0
    for d in target_docs:
        doc_id = d["id"]
        if d.get("brain_built") and not force:
            continue  # already mapped once; don't redo the expensive part

        # Fresh start for this handout
        supabase.table("brain_nodes").delete().eq("document_id", doc_id).execute()

        chunks = (
            supabase.table("document_chunks").select("content")
            .eq("document_id", doc_id).order("chunk_index").execute().data
        )
        if not chunks:
            continue

        # Batch the handout's text so even long PDFs are covered fully (accuracy over speed)
        batches, cur, cur_len = [], [], 0
        for c in chunks:
            t = c["content"]
            if cur and cur_len + len(t) > 15000:
                batches.append("\n\n".join(cur))
                cur, cur_len = [], 0
            cur.append(t)
            cur_len += len(t)
        if cur:
            batches.append("\n\n".join(cur))

        concept_summary = {}   # label_key -> (label, summary)
        all_links = []
        for btext in batches:
            prompt = f"""You are building a concept map (a "second brain") from part of a student's handout.
Extract the concepts and how they connect, so the student can find information fast instead of re-reading the PDF.

Rules:
- Extract as many concepts as this text genuinely warrants. Do not limit the number, but skip trivial filler.
- A concept label is 1-4 words (a term, idea, method, or named thing).
- Give each concept a one-sentence summary grounded in the text.
- List meaningful links between concepts that are actually related.
- In "links", use the exact concept labels as written in "concepts".

Return ONLY valid JSON in this shape, nothing else:
{{
  "concepts": [ {{ "label": "string", "summary": "string" }} ],
  "links": [ {{ "from": "string", "to": "string", "relationship": "short phrase" }} ]
}}

Text:
{btext}
"""
            try:
                resp = gemini.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=prompt,
                    config=types.GenerateContentConfig(response_mime_type="application/json"),
                )
                parsed = json.loads(resp.text)
            except Exception:
                continue
            for c in parsed.get("concepts", []):
                label = (c.get("label") or "").strip()
                if not label:
                    continue
                key = label.lower()
                if key not in concept_summary:
                    concept_summary[key] = (label, (c.get("summary") or "").strip())
            all_links.extend(parsed.get("links", []))

        if not concept_summary:
            continue

        # Embed each concept (label + summary) so we can connect them by meaning later
        node_rows = []
        for key, (label, summary) in concept_summary.items():
            try:
                emb = embed_text(f"{label}. {summary}", "RETRIEVAL_DOCUMENT")
            except Exception:
                emb = None
            node_rows.append({
                "user_id": owner_id, "classroom_id": classroom_id, "document_id": doc_id,
                "label": label, "label_key": key, "summary": summary,
                "embedding": emb, "source": "pdf",
            })

        supabase.table("brain_nodes").upsert(
            node_rows, on_conflict="user_id,document_id,label_key", ignore_duplicates=True
        ).execute()

        # Within-handout edges from the model
        this_doc = (
            supabase.table("brain_nodes").select("id,label_key")
            .eq("document_id", doc_id).execute().data
        )
        id_by_key = {n["label_key"]: n["id"] for n in this_doc}
        edge_rows, edge_seen = [], set()
        for link in all_links:
            a = id_by_key.get((link.get("from") or "").strip().lower())
            b = id_by_key.get((link.get("to") or "").strip().lower())
            if not a or not b or a == b:
                continue
            s, t = sorted([a, b])
            if (s, t) in edge_seen:
                continue
            edge_seen.add((s, t))
            edge_rows.append({
                "user_id": owner_id, "source_node_id": s, "target_node_id": t,
                "relationship": (link.get("relationship") or "").strip(), "kind": "related",
            })
        if edge_rows:
            supabase.table("brain_edges").upsert(
                edge_rows, on_conflict="user_id,source_node_id,target_node_id", ignore_duplicates=True
            ).execute()

        supabase.table("documents").update({"brain_built": True}).eq("id", doc_id).execute()
        built += 1

    # Cheap step: connect the handout brains (and repair any gaps)
    bridges = recompute_connections(owner_id)
    return {"classroom_id": classroom_id, "handouts_built": built, "bridges": bridges}


@app.post("/delete-document")
def delete_document(document_id: str):
    """Remove a handout completely: its file, chunks, and row. Its brain nodes
    cascade away, then we reconnect any concepts left stranded by the gap."""
    rows = supabase.table("documents").select("storage_path,user_id").eq("id", document_id).execute().data
    if not rows:
        return {"error": "Document not found."}
    storage_path = rows[0]["storage_path"]
    owner_id = rows[0]["user_id"]

    # Remove the stored file (ignore if it's already gone)
    try:
        supabase.storage.from_("handouts").remove([storage_path])
    except Exception:
        pass

    # Remove its chunks, then the row itself (brain_nodes cascade on the FK)
    supabase.table("document_chunks").delete().eq("document_id", document_id).execute()
    supabase.table("documents").delete().eq("id", document_id).execute()

    # Reconnect the map around the gap left by the deleted handout
    bridges = recompute_connections(owner_id)
    return {"deleted": True, "bridges": bridges}


@app.post("/connect-brain")
def connect_brain(classroom_id: str):
    """Cheaply re-connect the existing handout brains (no re-extraction)."""
    owner_id = (
        supabase.table("classrooms").select("user_id")
        .eq("id", classroom_id).single().execute().data["user_id"]
    )
    bridges = recompute_connections(owner_id)
    return {"bridges": bridges}