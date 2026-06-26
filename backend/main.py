import os
import io
import re
import math
import json
from datetime import datetime, timezone
from fastapi import FastAPI, BackgroundTasks, Body
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from supabase import create_client
from pypdf import PdfReader
import llm  # task-aware model router (automatic best->cheapest fallback)

app = FastAPI(title="StudyApp Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Connect to Gemini and Supabase ---
gemini = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
llm.init(gemini)  # the model router shares this client
supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_KEY"],
)

# Generation model selection now lives in llm.py: each call below picks a task
# tier (heavy / standard / light) and the router uses the best AVAILABLE model,
# falling back automatically on quota caps or paid-only / unavailable models.
# Embeddings stay on one dedicated model (separate quota, fixed dimensions).
EMBED_MODEL = "gemini-embedding-001"


# --- Helper functions ---

def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Pull all the text out of a PDF."""
    reader = PdfReader(io.BytesIO(pdf_bytes))
    text = ""
    for page in reader.pages:
        text += (page.extract_text() or "") + "\n"
    return text


def transcribe_pdf_with_gemini(pdf_bytes: bytes) -> str:
    """Read a scanned / image-only PDF by having Gemini transcribe it.

    pypdf returns nothing for pages that are photos or scans. Gemini reads the
    PDF natively (printed text, figures, even handwriting) and gives back
    Markdown. Math is wrapped in single-dollar (inline) and
    double-dollar (block) delimiters so a future KaTeX frontend can
    render it. Returns "" if the model can't be reached or returns nothing, so
    the caller can fall back to a clean error.
    """
    prompt = (
        "Transcribe this document to clean Markdown for a study app.\n"
        "- Output every piece of readable text, in natural reading order.\n"
        "- Wrap inline math in single-dollar delimiters and wrap block or "
        "display equations in double-dollar delimiters (a pair of dollar signs "
        "on each side).\n"
        "- For each figure, diagram, or chart, write a short bracketed "
        "description of what it shows, e.g. [Figure: right triangle with legs 3 "
        "and 4].\n"
        "- Do not add commentary, headings, or anything not present in the "
        "document. Return only the transcription."
    )
    try:
        resp, _model = llm.generate(
            "heavy",
            contents=[
                types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
                prompt,
            ],
        )
    except Exception as e:
        return "", f"Gemini transcription failed: {e}"
    text = (resp.text or "").strip()
    if not text:
        return "", "Gemini returned an empty transcription (possibly a quota limit)."
    return text, None


def get_pdf_text(pdf_bytes: bytes, min_chars_per_page: int = 50) -> str:
    """Get a PDF's text, transcribing with Gemini only when pypdf comes up thin.

    Digital PDFs take the free pypdf route and never touch Gemini's quota.
    Scanned or photographed PDFs, where pypdf returns little or nothing, fall
    back to Gemini vision transcription. The decision is a simple density check:
    a real page of text is hundreds of characters, a scanned page is ~0, so if
    the whole document averages below `min_chars_per_page` we treat it as
    image-only and let Gemini read it.
    """
    text = extract_text_from_pdf(pdf_bytes)
    try:
        n_pages = max(1, len(PdfReader(io.BytesIO(pdf_bytes)).pages))
    except Exception:
        n_pages = 1
    if len(text.strip()) >= min_chars_per_page * n_pages:
        return text, None  # plenty of real text -> use the free extraction
    # Thin: likely scanned / image-only -> let Gemini read the whole PDF
    transcribed, err = transcribe_pdf_with_gemini(pdf_bytes)
    if len(transcribed) > len(text.strip()):
        return transcribed, None
    # Thin AND transcription didn't help -> pass the reason up so it's visible
    return text, err


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
        model=EMBED_MODEL,
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

def _parse_dt(iso_dt):
    """Parse a Supabase timestamptz string into an aware datetime, or None."""
    if not iso_dt:
        return None
    s = str(iso_dt).strip().replace("Z", "+00:00")
    for cand in (s, s[:26], s[:19]):
        try:
            dt = datetime.fromisoformat(cand)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except Exception:
            continue
    return None


def _days_until(iso_dt):
    """Whole days from now until an ISO timestamp (floored; past dates go negative)."""
    dt = _parse_dt(iso_dt)
    if dt is None:
        return None
    return math.floor((dt - datetime.now(timezone.utc)).total_seconds() / 86400.0)


def _mean_normalize(vecs: list[list[float]]) -> list[float]:
    """Average several vectors into one, scaled back to length 1.

    Used to turn a handout's many chunk embeddings into a single vector that
    represents the whole handout.
    """
    n = len(vecs)
    dim = len(vecs[0])
    acc = [0.0] * dim
    for v in vecs:
        for i in range(dim):
            acc[i] += v[i]
    return normalize([a / n for a in acc])


def _filename_ordinal(name: str) -> int:
    """Pull the first integer out of a filename for fallback ordering.
    'Lecture 3.pdf' -> 3, 'Week_02' -> 2, 'intro.pdf' -> large number (goes last)."""
    if not name:
        return 10 ** 9
    m = re.search(r"\d+", name)
    return int(m.group()) if m else 10 ** 9


def _topics_from_plan(plan_text: str):
    """Ask Gemini for the ordered topics a lesson plan / syllabus teaches.

    Returns (topics, error). On success error is None; topics are short phrases
    in teaching order. The plan is read ONLY for this -- it never gets embedded
    into RAG, brain-built, or quizzed.
    """
    prompt = f"""You are reading a course lesson plan / syllabus. Extract the list of TOPICS the course teaches, in the ORDER they are taught (top to bottom, week 1 first).

Rules:
- Each topic is a short phrase (2-8 words): the subject matter, not admin text.
- Preserve teaching order exactly as the plan presents it.
- Ignore non-topic material: grading, attendance, office hours, policies, dates, instructor names.
- If the plan is organised by weeks or sessions, output the topic(s) for each week in order.

Return ONLY valid JSON in this exact shape, nothing else:
{{ "topics": ["string", "string"] }}

Lesson plan:
{plan_text[:15000]}
"""
    try:
        resp, _model = llm.generate(
            "standard",
            contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
    except Exception as e:
        return None, f"The AI model could not be reached: {e}"
    raw = (resp.text or "").strip()
    if not raw:
        return None, "The model returned an empty response. Try again."
    try:
        parsed = json.loads(raw)
        topics = [t.strip() for t in parsed.get("topics", []) if isinstance(t, str) and t.strip()]
    except Exception as e:
        return None, f"Could not parse topics from model: {e}"
    return topics, None


def _topics_from_brain(classroom_id: str, top_n: int = 12):
    """Derive an ordered topic list from the classroom's concept brain.

    The most-connected concepts (highest edge degree) are the likely 'topics';
    we hand those to Gemini to merge near-duplicates and arrange them into a
    sensible teaching order. Returns (topics, error) like the other helpers.
    """
    nodes = (
        supabase.table("brain_nodes").select("id,label,summary")
        .eq("classroom_id", classroom_id).execute().data
    ) or []
    if not nodes:
        return None, "No concept brain found for this classroom yet. Build the brain first."

    owner_rows = supabase.table("classrooms").select("user_id").eq("id", classroom_id).execute().data
    owner_id = owner_rows[0]["user_id"] if owner_rows else None
    edges = (
        supabase.table("brain_edges").select("source_node_id,target_node_id")
        .eq("user_id", owner_id).execute().data
    ) or []

    node_ids = {n["id"] for n in nodes}
    deg = {}
    for e in edges:
        for nid in (e["source_node_id"], e["target_node_id"]):
            if nid in node_ids:
                deg[nid] = deg.get(nid, 0) + 1

    ranked = sorted(nodes, key=lambda n: deg.get(n["id"], 0), reverse=True)[:top_n]
    concept_lines = "\n".join(
        f"- {n['label']}: {(n.get('summary') or '').strip()}" for n in ranked
    )
    prompt = f"""These are the most connected concepts pulled from a student's course notes, with short summaries:

{concept_lines}

Turn them into a clean, ordered list of the course's TOPICS for a learning path.
Rules:
- Merge near-duplicates or sub-concepts into a single broader topic.
- Order them in a sensible teaching sequence (foundations first).
- Each topic is a short phrase (2-6 words).
- Aim for the natural number of topics; do not pad.

Return ONLY valid JSON in this exact shape, nothing else:
{{ "topics": ["string", "string"] }}
"""
    try:
        resp, _model = llm.generate(
            "standard", contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
    except Exception as e:
        return None, f"The AI model could not be reached: {e}"
    raw = (resp.text or "").strip()
    if not raw:
        return None, "The model returned an empty response. Try again."
    try:
        parsed = json.loads(raw)
        topics = [t.strip() for t in parsed.get("topics", []) if isinstance(t, str) and t.strip()]
    except Exception as e:
        return None, f"Could not parse topics from brain: {e}"
    if not topics:
        return None, "No topics could be derived from the brain."
    return topics, None


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


# --- Quiz generation core (shared by /generate-quiz and /lesson-quiz) ---

def _owner_of_classroom(classroom_id: str):
    """Return the user_id that owns a classroom, or None if it doesn't exist."""
    rows = supabase.table("classrooms").select("user_id").eq("id", classroom_id).execute().data
    return rows[0]["user_id"] if rows else None

def _questions_from_text(source_text: str, num_questions: int, focus: str = None):
    """Ask Gemini for multiple-choice questions from text.

    Returns (clean_questions, error_message). On success error_message is None;
    on failure clean_questions is None. `focus` optionally nudges the model to
    emphasise particular topics that appear in the material.
    """
    num_questions = max(1, min(num_questions, 15))
    focus_line = ""
    if focus:
        focus_line = (
            f"\nThe student wants this quiz to focus on: {focus}. "
            "Prioritise questions about those topics where the material covers them, "
            "but still only use facts present in the material.\n"
        )
    prompt = f"""You are a quiz writer for a study app. Using ONLY the course material below, write {num_questions} multiple-choice questions that test understanding of the material.
{focus_line}
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
        response, _model = llm.generate(
            "standard",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
            ),
        )
    except Exception as e:
        return None, f"The AI model could not be reached: {e}"

    raw_text = (response.text or "").strip()
    if not raw_text:
        return None, "The model returned an empty response. Try again."
    try:
        parsed = json.loads(raw_text)
        raw_questions = parsed["questions"]
    except Exception as e:
        return None, f"Could not parse quiz from model: {e}"

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
        return None, "The model did not return usable questions. Try again."
    return clean, None


def _foundation_gaps(topic_names, max_gaps: int = 3):
    """Find FOUNDATIONAL prerequisite topics the course assumes but doesn't cover.

    Returns (names, error). Empty when the material is self-contained. These become
    AI 'bridge' chapters so a path that starts mid-subject (e.g. handouts on the
    Chain Rule but nothing on Limits) still teaches the basics first.
    """
    if not topic_names:
        return [], None
    listed = "\n".join(f"- {t}" for t in topic_names)
    prompt = f"""A student's course is built from these topics, in teaching order:
{listed}

List up to {max_gaps} FOUNDATIONAL prerequisite topics this course clearly ASSUMES the
student already knows but that are NOT in the list above. Only include genuine basics a
beginner would be lost without. If the list above already starts from basics or is
self-contained, return an empty list. Order them foundations-first.

Return ONLY valid JSON: {{ "gaps": ["string"] }}"""
    try:
        resp, _m = llm.generate(
            "standard", contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
    except Exception as e:
        return [], f"foundation-gap check failed: {e}"
    try:
        gaps = [g.strip() for g in json.loads(resp.text or "{}").get("gaps", [])
                if isinstance(g, str) and g.strip()]
    except Exception:
        return [], "could not parse foundation gaps"
    existing = {t.strip().lower() for t in topic_names}
    gaps = [g for g in gaps if g.lower() not in existing][:max_gaps]
    return gaps, None


def _questions_from_topic(topic_name: str, num_questions: int):
    """Generate quiz questions for a topic from the model's OWN knowledge (no source
    material). Powers 'bridge' lessons that fill gaps the student's uploads don't
    cover. Returns (clean_questions, error).
    """
    num_questions = max(1, min(num_questions, 15))
    prompt = f"""You are a tutor writing a short practice quiz to teach a FOUNDATIONAL prerequisite topic to a student whose course materials assume it but do not cover it.

Topic: "{topic_name}"

Write {num_questions} multiple-choice questions that teach and check the core basics of this topic using standard, widely-accepted curriculum knowledge. Keep them clear and beginner-friendly.

Rules:
- Exactly 4 options each, exactly one correct.
- Vary which option is correct.
- Each explanation is one sentence that actually teaches the point.

Return ONLY valid JSON in exactly this shape, nothing else:
{{
  "questions": [
    {{ "question": "string", "choices": ["string","string","string","string"], "correct_index": 0, "explanation": "string" }}
  ]
}}"""
    try:
        response, _m = llm.generate(
            "standard", contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
    except Exception as e:
        return None, f"The AI model could not be reached: {e}"
    raw_text = (response.text or "").strip()
    if not raw_text:
        return None, "The model returned an empty response. Try again."
    try:
        parsed = json.loads(raw_text)
        raw_questions = parsed["questions"]
    except Exception as e:
        return None, f"Could not parse quiz from model: {e}"
    clean = []
    for q in raw_questions:
        choices = q.get("choices", [])
        idx = q.get("correct_index", 0)
        if not q.get("question") or not isinstance(choices, list) or len(choices) != 4:
            continue
        if not isinstance(idx, int) or idx < 0 or idx > 3:
            idx = 0
        clean.append({
            "question": q["question"], "choices": choices,
            "correct_index": idx, "explanation": q.get("explanation", ""),
        })
    if not clean:
        return None, "The model did not return usable questions. Try again."
    return clean, None


def _save_quiz(classroom_id, document_id, owner_id, title, clean, origin="manual"):
    """Insert a quiz + its questions, and return the app-facing payload.

    `origin` is 'manual' for the user's classroom quiz, or 'lesson' for a
    learning-path node's quiz. Keeping them separate means replacing one never
    touches the other. Raises RuntimeError if the quiz can't be saved.
    """
    inserted = supabase.table("quizzes").insert({
        "classroom_id": classroom_id,
        "document_id": document_id,
        "user_id": owner_id,
        "title": title,
        "origin": origin,
    }).execute().data
    if not inserted:
        raise RuntimeError("Could not save the quiz (no row returned). Check the quizzes table.")
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

# --- Endpoints ---

@app.get("/")
def root():
    return {"message": "StudyApp backend is alive!"}


def _process_pdf_job(document_id: str):
    """Heavy PDF work run in the background so the upload returns instantly.

    Downloads the file, gets its text (transcribing scanned PDFs via
    get_pdf_text), chunks, embeds every chunk, and stores them. The outcome is
    written onto the documents row -- status 'ready' or 'error', with
    status_detail carrying the reason on failure -- so the app polls the row
    instead of waiting on the HTTP call.
    """
    try:
        doc = supabase.table("documents").select("*").eq("id", document_id).single().execute().data
        storage_path = doc["storage_path"]
        classroom_id = doc["classroom_id"]

        # Clear any existing chunks so re-processing a new version doesn't duplicate
        supabase.table("document_chunks").delete().eq("document_id", document_id).execute()

        # Download, get text (transcribes scanned PDFs), chunk
        pdf_bytes = supabase.storage.from_("handouts").download(storage_path)
        text, text_err = get_pdf_text(pdf_bytes)
        chunks = chunk_text(text)

        if not chunks:
            supabase.table("documents").update({
                "status": "error",
                "status_detail": text_err or "No text found in PDF (even after image transcription).",
            }).eq("id", document_id).execute()
            return

        # Embed every chunk and build rows to insert
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

        supabase.table("document_chunks").insert(rows).execute()
        supabase.table("documents").update({
            "status": "ready", "status_detail": None,
        }).eq("id", document_id).execute()

    except Exception as e:
        supabase.table("documents").update({
            "status": "error", "status_detail": str(e)[:500],
        }).eq("id", document_id).execute()


@app.post("/process-pdf")
def process_pdf(document_id: str, background_tasks: BackgroundTasks):
    """Kick off PDF processing and return immediately.

    Marks the document 'processing', queues the heavy embedding work as a
    background task, and responds right away so the app never blocks on upload.
    The app should poll the documents row's status until it becomes 'ready' or
    'error'.
    """
    doc = supabase.table("documents").select("id").eq("id", document_id).execute().data
    if not doc:
        return {"error": "Document not found."}
    supabase.table("documents").update({
        "status": "processing", "status_detail": None,
    }).eq("id", document_id).execute()
    background_tasks.add_task(_process_pdf_job, document_id)
    return {"status": "processing", "document_id": document_id}

# Models we trust to support Google Search grounding (override via env).
_GROUNDING_MODELS = [
    m.strip() for m in
    (os.environ.get("LLM_GROUNDING") or "gemini-2.5-flash,gemini-2.0-flash").split(",")
    if m.strip()
]


def _web_search_tool():
    """The Google Search grounding tool, or None if this SDK can't build it."""
    try:
        return types.Tool(google_search=types.GoogleSearch())
    except Exception:
        return None


def _grounding_sources(resp):
    """Pull any web pages the model cited, defensively (SDK shape varies)."""
    out = []
    try:
        gm = resp.candidates[0].grounding_metadata
        for c in (getattr(gm, "grounding_chunks", None) or []):
            w = getattr(c, "web", None)
            uri = getattr(w, "uri", None) if w else None
            if uri:
                out.append({"title": getattr(w, "title", None) or uri, "url": uri})
    except Exception:
        pass
    return out


def _answer_with_web(prompt):
    """Answer with web-search grounding enabled so the model can look things up.
    Runs OUTSIDE the tiered router (so an unsupported-tool error never cools the
    shared models). Returns (text, model, web_sources) or None on any failure."""
    tool = _web_search_tool()
    if not tool:
        return None
    cfg = types.GenerateContentConfig(tools=[tool])
    for model in _GROUNDING_MODELS:
        try:
            resp = gemini.models.generate_content(model=model, contents=prompt, config=cfg)
            if resp and (resp.text or "").strip():
                return resp.text, model, _grounding_sources(resp)
        except Exception:
            continue
    return None


@app.post("/ask")
def ask(question: str, classroom_id: str, history: list = Body(default=[], embed=True)):
    # 1. Retrieve the most relevant handout chunks (the first knowledge base).
    query_embedding = embed_text(question, "RETRIEVAL_QUERY")
    matches = supabase.rpc("match_chunks", {
        "query_embedding": query_embedding,
        "match_classroom_id": classroom_id,
        "match_count": 6,
    }).execute().data or []

    if matches:
        context = "\n\n---\n\n".join(
            f"[Material {i + 1}]\n{m['content']}" for i, m in enumerate(matches)
        )
    else:
        context = "(No course materials matched this question.)"

    # 2. Recent conversation so follow-ups ("why?", "another example") make sense.
    hist = ""
    if history:
        lines = []
        for turn in history[-8:]:
            if not isinstance(turn, dict):
                continue
            txt = (turn.get("text") or "").strip()
            if not txt:
                continue
            who = "Student" if turn.get("role") == "user" else "You"
            lines.append(f"{who}: {txt}")
        if lines:
            hist = "CONVERSATION SO FAR:\n" + "\n".join(lines) + "\n\n"

    # 3. Materials-first, but not materials-only: knowledge + web fill the gaps.
    prompt = f"""You are StudyBuddy, a sharp and friendly study tutor. Answer the student's question clearly and get straight to the point.

How to answer:
- Treat the COURSE MATERIALS below as your first and most trusted source. If they cover the question, build your answer on them and pull together the relevant points across the different materials.
- They are your first source, not your only one. If they don't fully cover it (or there are none), use your own expert knowledge, and search the web when current or outside facts would make the answer better or more accurate.
- Always put it in your own words — never copy-paste chunks of the materials back at the student.
- If you're explaining something, make it genuinely easy to understand: plain language, build up from the basics, and add a short concrete example or analogy when it helps.
- Be warm and encouraging, but skip the fluff. Don't restate the question. Keep it tight: a few short paragraphs or clean bullet points.
- Use the conversation so far to understand short follow-ups (like "why?" or "give another example").
- If the materials and outside facts disagree, briefly flag it.

COURSE MATERIALS:
{context}

{hist}STUDENT QUESTION: {question}"""

    answer, used_model, web_sources = None, None, []

    # 3. Try a web-grounded answer first (the model only actually searches when it
    #    needs to). Fall back to the tiered router with no tool if grounding isn't
    #    available on this key/tier.
    grounded = _answer_with_web(prompt)
    if grounded:
        answer, used_model, web_sources = grounded
    else:
        try:
            response, used_model = llm.generate("standard", contents=prompt)
            answer = response.text
        except Exception:
            return {
                "answer": "Your study buddy is over today's limit on every available model. "
                          "Please try again in a little while.",
                "model": None, "sources": [], "web_sources": [],
            }

    return {
        "answer": answer,
        "model": used_model,
        "sources": [m["content"][:200] for m in matches],
        "web_sources": web_sources,
    }


def _delete_manual_quizzes(classroom_id):
    """Delete the classroom's existing MANUAL quiz and its child rows.

    Lesson quizzes (origin='lesson') are left untouched. We delete children
    explicitly so it works regardless of foreign-key cascade settings.
    """
    olds = (
        supabase.table("quizzes").select("id")
        .eq("classroom_id", classroom_id).eq("origin", "manual").execute().data
    ) or []
    for q in olds:
        qid = q["id"]
        supabase.table("quiz_attempts").delete().eq("quiz_id", qid).execute()
        supabase.table("quiz_questions").delete().eq("quiz_id", qid).execute()
        supabase.table("quizzes").delete().eq("id", qid).execute()


@app.post("/generate-quiz")
def generate_quiz(classroom_id: str, document_ids: str = None, topics: str = None, num_questions: int = 8):
    """Generate the classroom's single MANUAL quiz from chosen coverage.

    document_ids -> comma-separated handout ids to cover (empty = whole classroom).
    topics       -> optional free text; pulls the most relevant chunks and tells
                    the model to focus there.
    Only one manual quiz exists per classroom: a successful generation replaces it.
    """
    num_questions = max(1, min(num_questions, 15))
    doc_ids = [d.strip() for d in (document_ids or "").split(",") if d.strip()]

    # 1. Pull candidate chunks from the selected handouts (or the whole classroom)
    q = (
        supabase.table("document_chunks")
        .select("content,chunk_index,embedding,document_id")
        .eq("classroom_id", classroom_id)
    )
    if doc_ids:
        q = q.in_("document_id", doc_ids)
    rows = q.order("chunk_index").execute().data or []
    if not rows:
        return {"error": "No processed material found for that selection yet."}

    # 2. If the user typed topics, rank chunks by similarity to those topics
    if topics:
        try:
            tvec = embed_text(topics, "RETRIEVAL_QUERY")
            scored = []
            for r in rows:
                v = _parse_vec(r.get("embedding"))
                if v:
                    scored.append((dot(tvec, v), r))
            if scored:
                scored.sort(key=lambda x: x[0], reverse=True)
                top = [r for _, r in scored[:40]]
                top.sort(key=lambda r: (r["document_id"], r["chunk_index"]))
                rows = top
        except Exception:
            rows = rows[:40]  # if embedding the topics fails, fall back gracefully
    else:
        rows = rows[:40]

    source_text = "\n\n".join(r["content"] for r in rows)[:12000]

    # 3. Generate (with optional topic focus)
    clean, err = _questions_from_text(source_text, num_questions, focus=topics)
    if err:
        return {"error": err}

    owner_id = _owner_of_classroom(classroom_id)
    if not owner_id:
        return {"error": "Classroom not found."}

    # 4. Build a friendly title
    title = f"Classroom Quiz \u00b7 {len(clean)} questions"
    if topics:
        title = f"{topics[:40]} \u2014 Quiz"
    elif len(doc_ids) == 1:
        doc = supabase.table("documents").select("file_name").eq("id", doc_ids[0]).single().execute().data
        if doc and doc.get("file_name"):
            title = doc["file_name"].rsplit(".pdf", 1)[0] + " \u2014 Quiz"

    # 5. Replace the old manual quiz only AFTER generation succeeded
    _delete_manual_quizzes(classroom_id)
    try:
        return _save_quiz(
            classroom_id,
            doc_ids[0] if len(doc_ids) == 1 else None,
            owner_id, title, clean, origin="manual",
        )
    except Exception as e:
        return {"error": f"Saving the quiz failed: {e}"}

@app.post("/order-from-plan")
def order_from_plan(classroom_id: str, plan_path: str = None, plan_id: str = None, dry_run: bool = False, match_threshold: float = 0.45):
    """Reorder a classroom's handouts to follow an uploaded lesson plan / syllabus.

    The plan is a META-DOCUMENT used ONLY for ordering: it is never chunked,
    embedded into RAG, brain-built, or quizzed (it has no `documents` row).

    Steps:
      1. download + extract the plan PDF text,
      2. ask Gemini for the ordered list of topics it teaches,
      3. embed each topic and compare it to every chunk of every module,
         so coverage is many-to-many: a module can cover several topics and a
         topic can appear across several modules,
      4. a module 'covers' a topic if any of its chunks matches it above
         match_threshold (coverage score = the best such chunk),
      5. order modules by the EARLIEST topic they cover; modules covering no
         topic are parked at the end (filename number, then upload time),
      6. write documents.sort_order 1..N and documents.topic_coverage
         (both skipped when dry_run=True).

    `plan_path` is the file's path inside the 'handouts' storage bucket.
    `match_threshold` is the minimum cosine for a handout to count as matched;
    run dry_run first to read the best_sim values and tune it.
    Returns the proposed order with per-handout match info so it's auditable.
    """
    owner_id = _owner_of_classroom(classroom_id)
    if not owner_id:
        return {"error": "Classroom not found."}

    # Resolve the plan file: either a direct path, or look it up from a plan_id
    if not plan_path and plan_id:
        prow = supabase.table("lesson_plans").select("storage_path").eq("id", plan_id).execute().data
        if prow:
            plan_path = prow[0]["storage_path"]
    if not plan_path:
        return {"error": "Provide plan_path or plan_id."}

    # 1. Download + extract the plan
    try:
        pdf_bytes = supabase.storage.from_("handouts").download(plan_path)
    except Exception as e:
        return {"error": f"Could not download the lesson plan at '{plan_path}': {e}"}
    plan_text, plan_err = get_pdf_text(pdf_bytes)
    plan_text = plan_text.strip()
    if not plan_text:
        return {"error": plan_err or "No text found in the lesson plan (it may be a scanned image)."}

    # 2. Ordered topics from Gemini
    topics, err = _topics_from_plan(plan_text)
    if err:
        return {"error": err}
    if not topics:
        return {"error": "The lesson plan didn't yield any topics to order by."}

    # 3. Handouts + their chunk vectors (per-chunk, so coverage is many-to-many)
    docs = (
        supabase.table("documents")
        .select("id,file_name,created_at,sort_order,status")
        .eq("classroom_id", classroom_id).execute().data
    ) or []
    if not docs:
        return {"error": "No handouts in this classroom to order yet."}

    # Embed every topic once
    topic_vecs = []
    for t in topics:
        try:
            topic_vecs.append(embed_text(t, "RETRIEVAL_QUERY"))
        except Exception:
            topic_vecs.append(None)

    # 4. For each module, find which topics it covers (any chunk above threshold)
    modules = []
    for d in docs:
        crows = (
            supabase.table("document_chunks").select("embedding,chunk_index")
            .eq("document_id", d["id"]).order("chunk_index").execute().data
        ) or []
        chunks = [(r.get("chunk_index"), _parse_vec(r.get("embedding"))) for r in crows]
        chunks = [(ci, v) for ci, v in chunks if v]

        # No processed chunks yet -> use the filename as a single pseudo-chunk
        if not chunks:
            name = (d.get("file_name") or "").rsplit(".pdf", 1)[0]
            try:
                chunks = [(0, embed_text(name or "untitled", "RETRIEVAL_DOCUMENT"))]
            except Exception:
                chunks = []

        covered = []
        for ti, tv in enumerate(topic_vecs):
            if not tv:
                continue
            best_sim, first_chunk = -1.0, None
            for ci, v in chunks:
                sim = dot(tv, v)
                if sim > best_sim:
                    best_sim = sim
                if sim >= match_threshold and first_chunk is None:
                    first_chunk = ci
            if best_sim >= match_threshold:
                covered.append({
                    "topic_index": ti,
                    "topic": topics[ti],
                    "score": round(best_sim, 4),
                    "first_chunk": first_chunk if first_chunk is not None else 0,
                })
        covered.sort(key=lambda c: c["first_chunk"])  # path order: by appearance
        earliest = min((c["topic_index"] for c in covered), default=None)
        top_score = max((c["score"] for c in covered), default=-1.0)
        modules.append({
            "document_id": d["id"],
            "file_name": d.get("file_name"),
            "covered": covered,
            "earliest_topic_index": earliest,
            "_top_score": top_score,
            "_created": d.get("created_at") or "",
        })

    # 5. Order modules by their earliest covered topic; park the uncovered ones
    strong = [m for m in modules if m["earliest_topic_index"] is not None]
    weak = [m for m in modules if m["earliest_topic_index"] is None]
    strong.sort(key=lambda m: (m["earliest_topic_index"], -m["_top_score"],
                               _filename_ordinal(m["file_name"]), m["_created"]))
    weak.sort(key=lambda m: (_filename_ordinal(m["file_name"]), m["_created"]))
    ordered = strong + weak

    # 6. Persist sort_order + topic_coverage (unless previewing)
    for pos, m in enumerate(ordered, start=1):
        m["new_sort_order"] = pos
    if not dry_run:
        for m in ordered:
            supabase.table("documents").update({
                "sort_order": m["new_sort_order"],
                "topic_coverage": m["covered"],
            }).eq("id", m["document_id"]).execute()

    # Inverted view: which modules touch each topic (the other half of many-to-many)
    topic_to_modules = []
    for ti, t in enumerate(topics):
        hits = [
            {"file_name": m["file_name"],
             "score": next(c["score"] for c in m["covered"] if c["topic_index"] == ti)}
            for m in modules if any(c["topic_index"] == ti for c in m["covered"])
        ]
        topic_to_modules.append({"topic_index": ti, "topic": t, "modules": hits})

    for m in ordered:
        m.pop("_top_score", None)
        m.pop("_created", None)

    # Record this run on the plan row so the app can show its status
    if plan_id and not dry_run:
        supabase.table("lesson_plans").update({
            "topics": topics,
            "topic_count": len(topics),
            "match_threshold": match_threshold,
            "last_ordered_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", plan_id).execute()

    return {
        "classroom_id": classroom_id,
        "dry_run": dry_run,
        "match_threshold": match_threshold,
        "topics": topics,
        "ordered": ordered,
        "topic_to_modules": topic_to_modules,
        "matched": len(strong),
        "parked": len(weak),
    }


@app.post("/derive-topics")
def derive_topics(classroom_id: str, plan_id: str = None, source: str = "auto",
                  match_threshold: float = 0.7, top_n_nodes: int = 12, dry_run: bool = False,
                  merge_threshold: float = 0.86):
    """Phase 1 of the topic-based path: build the classroom's ordered TOPIC list
    and assign every chunk to its single best-matching topic.

    Topic source (when source='auto', in priority): an uploaded lesson plan,
    else the concept brain, else a fallback where each handout is its own topic.
    Each chunk is hard-assigned to the topic it most resembles, as long as that
    similarity clears match_threshold; weaker chunks are parked (topic_id stays
    null = an implicit 'Other').

    dry_run=True returns the proposed topics + per-topic chunk/handout counts
    WITHOUT writing, so you can inspect and tune match_threshold first.
    """
    owner_id = _owner_of_classroom(classroom_id)
    if not owner_id:
        return {"error": "Classroom not found."}

    # --- 1. Decide the source and get an ordered list of topic names ---
    chosen = source
    plan_row = None
    if source in ("auto", "plan"):
        pq = supabase.table("lesson_plans").select("*").eq("classroom_id", classroom_id)
        if plan_id:
            pq = pq.eq("id", plan_id)
        prows = pq.limit(1).execute().data
        plan_row = prows[0] if prows else None

    has_brain = bool(
        supabase.table("brain_nodes").select("id")
        .eq("classroom_id", classroom_id).limit(1).execute().data
    )
    if source == "auto":
        chosen = "plan" if plan_row else ("brain" if has_brain else "fallback")

    topic_names = []
    if chosen == "plan":
        if not plan_row:
            return {"error": "No lesson plan uploaded for this classroom."}
        try:
            pdf_bytes = supabase.storage.from_("handouts").download(plan_row["storage_path"])
        except Exception as e:
            return {"error": f"Could not download the lesson plan: {e}"}
        plan_text, plan_err = get_pdf_text(pdf_bytes)
        plan_text = plan_text.strip()
        if not plan_text:
            return {"error": plan_err or "No text found in the lesson plan."}
        topic_names, err = _topics_from_plan(plan_text)
        if err:
            return {"error": err}
    elif chosen == "brain":
        topic_names, err = _topics_from_brain(classroom_id, top_n=top_n_nodes)
        if err:
            return {"error": err}

    # Foundation gaps: prerequisite topics the course assumes but doesn't cover.
    # We prepend them as AI "bridge" chapters (only for conceptual sources, never
    # the filename fallback). They get embeddings too, so if matching material is
    # uploaded later they simply fill up; otherwise build-path serves them via AI.
    bridge_names = set()
    if chosen in ("plan", "brain") and topic_names:
        gaps, _gerr = _foundation_gaps(topic_names)
        if gaps:
            topic_names = gaps + topic_names
            bridge_names = {g.lower() for g in gaps}

    # --- 2. Gather the classroom's ready handouts + all chunks ---
    docs = (
        supabase.table("documents").select("id,file_name,sort_order,created_at")
        .eq("classroom_id", classroom_id).eq("status", "ready").execute().data
    ) or []
    if not docs:
        return {"error": "No processed handouts yet. Upload a handout first."}
    name_by_doc = {d["id"]: d.get("file_name") for d in docs}

    chunk_rows = (
        supabase.table("document_chunks").select("id,document_id,chunk_index,embedding")
        .eq("classroom_id", classroom_id).order("chunk_index").execute().data
    ) or []
    if not chunk_rows:
        return {"error": "No processed chunks yet."}

    # --- 3. Build topics + assign each chunk to one topic ---
    assignment = {}  # chunk_id -> topic_index (or None for 'Other')

    if chosen == "fallback":
        # Each handout is its own topic, in sort_order; assign chunks by document.
        docs_sorted = sorted(docs, key=lambda d: (
            d["sort_order"] if d.get("sort_order") is not None else 10 ** 9,
            d.get("created_at") or "",
        ))
        topic_names = [(name_by_doc[d["id"]] or "Untitled").rsplit(".pdf", 1)[0] for d in docs_sorted]
        doc_to_topic = {d["id"]: i for i, d in enumerate(docs_sorted)}
        topic_vecs = [None] * len(topic_names)
        for c in chunk_rows:
            assignment[c["id"]] = doc_to_topic.get(c["document_id"])
    else:
        # Embed each topic, then argmax-assign every chunk above the threshold.
        topic_vecs = []
        for t in topic_names:
            try:
                topic_vecs.append(embed_text(t, "RETRIEVAL_QUERY"))
            except Exception:
                topic_vecs.append(None)
        for c in chunk_rows:
            v = _parse_vec(c.get("embedding"))
            if not v:
                assignment[c["id"]] = None
                continue
            best_i, best_sim = None, -1.0
            for ti, tv in enumerate(topic_vecs):
                if not tv:
                    continue
                sim = dot(tv, v)
                if sim > best_sim:
                    best_sim, best_i = sim, ti
            assignment[c["id"]] = best_i if best_sim >= match_threshold else None

    # --- 4. Summarise per topic (chunk count + which handouts fall under it) ---
    per_topic = []
    for ti, tname in enumerate(topic_names):
        doc_ids = {c["document_id"] for c in chunk_rows if assignment.get(c["id"]) == ti}
        count = sum(1 for t in assignment.values() if t == ti)
        per_topic.append({
            "order_index": ti,
            "name": tname,
            "is_bridge": tname.lower() in bridge_names,
            "chunk_count": count,
            "handouts": sorted({name_by_doc.get(d) for d in doc_ids if name_by_doc.get(d)}),
        })
    parked = sum(1 for t in assignment.values() if t is None)

    # --- 5. Persist (unless previewing) ---
    merge_stats = {"reused": 0, "created": 0, "pruned": 0}
    if not dry_run:
        # Topic INDEX -> its assigned chunk ids (for re-stamping + intro samples).
        groups_by_index = {}
        for c in chunk_rows:
            ti = assignment.get(c["id"])
            if ti is not None:
                groups_by_index.setdefault(ti, []).append(c["id"])

        # --- Incremental MERGE (entity resolution) ---
        # Reuse an existing topic row whenever the newly derived topic is
        # essentially the same one (cosine >= merge_threshold). Reused ids keep
        # their lessons + the student's progress; only genuinely new topics get
        # fresh ids, and topics that vanished from the course are pruned. This is
        # what lets a re-derive after an upload GROW the path without resetting it.
        existing = (
            supabase.table("topics").select("id,name,order_index,embedding,intro,is_bridge")
            .eq("classroom_id", classroom_id).execute().data
        ) or []
        for e in existing:
            e["_v"] = _parse_vec(e.get("embedding"))
        existing_intro = {e["id"]: (e.get("intro") or "").strip() for e in existing}

        # Greedy best-first 1:1 match of new topic index -> existing topic id.
        cands = []
        for i, tv in enumerate(topic_vecs):
            if not tv:
                continue
            for e in existing:
                if not e["_v"]:
                    continue
                s = dot(tv, e["_v"])
                if s >= merge_threshold:
                    cands.append((s, i, e["id"]))
        cands.sort(key=lambda x: x[0], reverse=True)
        resolved_id = {}        # new index -> topic id (reused or freshly created)
        used_existing = set()
        for s, i, eid in cands:
            if i in resolved_id or eid in used_existing:
                continue
            resolved_id[i] = eid
            used_existing.add(eid)

        # Update matched topics in place; queue the unmatched for insert.
        to_insert = []
        for i, tname in enumerate(topic_names):
            is_b = tname.lower() in bridge_names
            emb = topic_vecs[i] if i < len(topic_vecs) else None
            if i in resolved_id:
                supabase.table("topics").update({
                    "name": tname, "order_index": i, "source": chosen,
                    "is_bridge": is_b, "embedding": emb,
                }).eq("id", resolved_id[i]).execute()
            else:
                to_insert.append({
                    "classroom_id": classroom_id, "user_id": owner_id,
                    "name": tname, "order_index": i, "source": chosen,
                    "embedding": emb, "is_bridge": is_b,
                })
        if to_insert:
            ins = supabase.table("topics").insert(to_insert).execute().data or []
            by_order = {r["order_index"]: r["id"] for r in ins}
            for i in range(len(topic_names)):
                if i not in resolved_id and i in by_order:
                    resolved_id[i] = by_order[i]

        # Prune topics that no longer appear. Delete their lessons first so it's
        # safe regardless of FK config (lesson_progress cascades from lessons).
        # Progress on a removed topic goes -- correct, since that topic is gone.
        orphans = [e["id"] for e in existing if e["id"] not in used_existing]
        if orphans:
            supabase.table("lessons").delete().in_("topic_id", orphans).execute()
            supabase.table("topics").delete().in_("id", orphans).execute()

        merge_stats = {"reused": len(used_existing), "created": len(to_insert), "pruned": len(orphans)}

        # Re-stamp chunk -> topic (safe to redo; only affects the next build-path).
        supabase.table("document_chunks").update({"topic_id": None}).eq("classroom_id", classroom_id).execute()
        groups_by_id = {}
        for ti, cids in groups_by_index.items():
            tid = resolved_id.get(ti)
            if tid:
                groups_by_id.setdefault(tid, []).extend(cids)
        for tid, cids in groups_by_id.items():
            if cids:
                supabase.table("document_chunks").update({"topic_id": tid}).in_("id", cids).execute()

        # Intros: only for topics that don't already have one (new topics, or a
        # matched topic whose intro was empty). Preserves existing intros + saves
        # LLM calls on re-derive.
        try:
            need = [
                i for i in range(len(topic_names))
                if resolved_id.get(i) and not existing_intro.get(resolved_id[i])
            ]
            if need:
                samples = []
                for i in need:
                    snippet = ""
                    cids = groups_by_index.get(i, [])[:2]
                    if cids:
                        srows = (
                            supabase.table("document_chunks").select("content")
                            .in_("id", cids).execute().data
                        ) or []
                        snippet = " ".join((r.get("content") or "")[:300] for r in srows)[:500]
                    samples.append(f"{i}|{topic_names[i]}|{snippet}")
                intro_prompt = (
                    "Write a short, friendly 1-2 sentence intro for each study topic below, "
                    "previewing what the learner will explore, in an encouraging, game-like tone. "
                    "Each input line is 'index|topic|sample text'.\n\n"
                    + "\n".join(samples)
                    + '\n\nReturn ONLY JSON keyed by the index: '
                    '{ "intros": { "0": "...", "1": "..." } }'
                )
                iresp, _model = llm.generate(
                    "light", contents=intro_prompt,
                    config=types.GenerateContentConfig(response_mime_type="application/json"),
                )
                intros = json.loads((iresp.text or "{}")).get("intros", {})
                for i in need:
                    txt = (intros.get(str(i)) or "").strip()
                    tid = resolved_id.get(i)
                    if txt and tid:
                        supabase.table("topics").update({"intro": txt}).eq("id", tid).execute()
        except Exception:
            pass  # intros are a nice-to-have; never block deriving

    return {
        "classroom_id": classroom_id,
        "source": chosen,
        "dry_run": dry_run,
        "match_threshold": match_threshold,
        "topic_count": len(topic_names),
        "topics": per_topic,
        "parked_chunks": parked,
        "merge": merge_stats,
    }


@app.post("/build-path")
def build_path(classroom_id: str, background_tasks: BackgroundTasks, chunks_per_lesson: int = 2, max_lessons_per_unit: int = 0, rebuild: bool = False):
    """Build the Duolingo-style path with TOPICS as the units (Philosophy B pacing).

    Each topic (from /derive-topics, ordered by order_index) becomes a unit of short
    lessons drawn from that topic's chunks -- which may span several handouts -- capped
    by a 'review' node (the quiz after the topic). A topic's lessons store their exact
    chunk ids, so quizzes pull the right material no matter which handout it came from.

    Exam coverage is by TOPIC: a topic's exam is topics.exam_id if set, else inferred
    from the exams its chunks' handouts belong to. For each dated exam an 'exam' tile is
    dropped after that exam's last covered topic, and pacing uses the exam's total topic
    chunks:

        study_days        = max(1, days_until_exam - 3)
        chunks_per_lesson = clamp(ceil(exam_total_chunks / study_days), 1, 4)

    Chunks that matched no topic strongly enough (parked) become a final
    'Additional material' unit so nothing drops out of the path.

    rebuild=True wipes the path first (clears lesson_progress via cascade); a plain call
    appends only topics not yet built. After re-running /derive-topics, rebuild -- since
    deriving recreates the topic rows.
    """
    owner_id = _owner_of_classroom(classroom_id)
    if not owner_id:
        return {"error": "Classroom not found."}

    if rebuild:
        supabase.table("lessons").delete().eq("classroom_id", classroom_id).execute()

    topics = (
        supabase.table("topics").select("id,name,order_index,exam_id,is_bridge")
        .eq("classroom_id", classroom_id).order("order_index").execute().data
    ) or []
    if not topics:
        # First build for this classroom: derive the topics automatically so the
        # path "just builds" in one tap. Never surface an internal endpoint name
        # to the user -- only friendly, actionable text.
        derived = derive_topics(classroom_id)
        if isinstance(derived, dict) and derived.get("error"):
            return {"error": derived["error"]}
        topics = (
            supabase.table("topics").select("id,name,order_index,exam_id")
            .eq("classroom_id", classroom_id).order("order_index").execute().data
        ) or []
        if not topics:
            return {"error": "Upload and process a handout first, then build your path."}

    docs = (
        supabase.table("documents").select("id,file_name,exam_id,sort_order,created_at")
        .eq("classroom_id", classroom_id).eq("status", "ready").execute().data
    ) or []
    exam_id_by_doc = {d["id"]: d.get("exam_id") for d in docs}
    docs_sorted = sorted(docs, key=lambda d: (
        d["sort_order"] if d.get("sort_order") is not None else 10 ** 9,
        d.get("created_at") or "",
    ))
    doc_order = {d["id"]: i for i, d in enumerate(docs_sorted)}

    chunk_rows = (
        supabase.table("document_chunks").select("id,document_id,chunk_index,topic_id")
        .eq("classroom_id", classroom_id).order("chunk_index").execute().data
    ) or []

    # Group chunks by topic (+ collect parked), each ordered by handout then index
    chunks_by_topic = {}
    parked = []
    for c in chunk_rows:
        tid = c.get("topic_id")
        if tid:
            chunks_by_topic.setdefault(tid, []).append(c)
        else:
            parked.append(c)

    def _ck(c):
        return (doc_order.get(c["document_id"], 10 ** 9), c["chunk_index"])
    for lst in chunks_by_topic.values():
        lst.sort(key=_ck)
    parked.sort(key=_ck)

    # Each topic's exam: explicit topics.exam_id, else inferred from its chunks' handouts
    topic_exam = {}
    for t in topics:
        ex = t.get("exam_id")
        if not ex:
            tally = {}
            for c in chunks_by_topic.get(t["id"], []):
                e = exam_id_by_doc.get(c["document_id"])
                if e:
                    tally[e] = tally.get(e, 0) + 1
            ex = max(tally, key=tally.get) if tally else None
        topic_exam[t["id"]] = ex

    exam_rows = (
        supabase.table("exams").select("id,name,exam_date")
        .eq("classroom_id", classroom_id).execute().data
    ) or []
    exam_by_id = {e["id"]: e for e in exam_rows}

    # Per-exam total chunks (sum across its topics) -> Philosophy B pacing
    exam_total = {}
    for t in topics:
        ex = topic_exam[t["id"]]
        if ex:
            exam_total[ex] = exam_total.get(ex, 0) + len(chunks_by_topic.get(t["id"], []))

    cpl_by_exam = {}
    schedule = []
    for ex_id, total in exam_total.items():
        ex = exam_by_id.get(ex_id)
        date = ex.get("exam_date") if ex else None
        du = _days_until(date)
        if du is not None and total > 0:
            study_days = max(1, du - 3)
            cpl = max(1, min(4, math.ceil(total / study_days)))
            total_lessons = max(1, math.ceil(total / cpl))
            lessons_per_day = math.ceil(total_lessons / study_days)
            cpl_by_exam[ex_id] = cpl
            schedule.append({
                "exam_id": ex_id,
                "name": ex.get("name") if ex else None,
                "exam_date": date,
                "days_until": du,
                "study_days": study_days,
                "total_chunks": total,
                "chunks_per_lesson": cpl,
                "total_lessons": total_lessons,
                "lessons_per_day": lessons_per_day,
                "pace_note": (f"\u2248{lessons_per_day} lessons/day to finish on time"
                              if lessons_per_day > 1 else None),
            })
        else:
            cpl_by_exam[ex_id] = chunks_per_lesson

    # Where each exam's tile goes: after its last covered topic (by order_index)
    last_order_for_exam = {}
    for t in topics:
        ex = topic_exam[t["id"]]
        if ex:
            last_order_for_exam[ex] = max(last_order_for_exam.get(ex, -1), t["order_index"])

    existing = (
        supabase.table("lessons").select("topic_id,unit_order")
        .eq("classroom_id", classroom_id).execute().data
    ) or []
    built_topics = {r["topic_id"] for r in existing if r.get("topic_id")}
    next_unit_order = max([r["unit_order"] for r in existing], default=-1) + 1
    fresh_build = len(existing) == 0  # exam tiles + parked unit only on a full build

    created = 0
    units_summary = []

    def _insert_unit(rows, label, is_exam):
        nonlocal created, next_unit_order
        supabase.table("lessons").insert(rows).execute()
        created += len(rows)
        units_summary.append({
            "unit_order": next_unit_order, "title": label,
            "nodes": len(rows), "exam_tile": is_exam,
        })
        next_unit_order += 1

    for t in topics:
        if t["id"] in built_topics:
            continue
        tchunks = chunks_by_topic.get(t["id"], [])
        if not tchunks:
            # Bridge topic (a foundation your uploads skip): no source chunks, so
            # build a short AI-served unit. Non-bridge empty topics stay parked.
            if t.get("is_bridge") and docs_sorted:
                rep_doc = docs_sorted[0]["id"]
                brows = [{
                    "user_id": owner_id, "classroom_id": classroom_id, "document_id": rep_doc,
                    "topic_id": t["id"], "unit_order": next_unit_order, "lesson_order": 0,
                    "kind": "lesson", "title": "Lesson 1", "is_bridge": True,
                    "chunk_start": None, "chunk_end": None, "chunk_ids": [],
                }, {
                    "user_id": owner_id, "classroom_id": classroom_id, "document_id": rep_doc,
                    "topic_id": t["id"], "unit_order": next_unit_order, "lesson_order": 999,
                    "kind": "review", "title": "Topic quiz", "is_bridge": True,
                    "chunk_start": None, "chunk_end": None, "chunk_ids": [],
                }]
                _insert_unit(brows, t["name"], False)
            continue  # all this topic's material parked -> shows up in catch-all
        ex = topic_exam[t["id"]]
        cpl = cpl_by_exam.get(ex, chunks_per_lesson)
        n = len(tchunks)
        n_lessons = max(1, math.ceil(n / cpl))
        if max_lessons_per_unit and max_lessons_per_unit > 0:
            n_lessons = min(n_lessons, max_lessons_per_unit)
        per = math.ceil(n / n_lessons)
        rep_doc = tchunks[0]["document_id"]

        rows = []
        for li in range(n_lessons):
            sl = tchunks[li * per:(li + 1) * per]
            if not sl:
                continue
            rows.append({
                "user_id": owner_id, "classroom_id": classroom_id, "document_id": sl[0]["document_id"],
                "topic_id": t["id"], "unit_order": next_unit_order, "lesson_order": len(rows),
                "kind": "lesson", "title": f"Lesson {len(rows) + 1}",
                "chunk_start": None, "chunk_end": None, "chunk_ids": [c["id"] for c in sl],
            })
        rows.append({
            "user_id": owner_id, "classroom_id": classroom_id, "document_id": rep_doc,
            "topic_id": t["id"], "unit_order": next_unit_order, "lesson_order": 999,
            "kind": "review", "title": "Topic quiz",
            "chunk_start": None, "chunk_end": None, "chunk_ids": [c["id"] for c in tchunks][:60],
        })
        _insert_unit(rows, t["name"], False)

        # Exam tile right after this exam's last covered topic (full builds only)
        if fresh_build and ex and last_order_for_exam.get(ex) == t["order_index"]:
            exam = exam_by_id.get(ex)
            exam_chunk_ids = []
            for tt in topics:
                if topic_exam[tt["id"]] == ex:
                    exam_chunk_ids += [c["id"] for c in chunks_by_topic.get(tt["id"], [])]
            erow = {
                "user_id": owner_id, "classroom_id": classroom_id, "document_id": rep_doc,
                "topic_id": None, "unit_order": next_unit_order, "lesson_order": 0,
                "kind": "exam", "title": (exam.get("name") if exam else "Exam"),
                "chunk_start": None, "chunk_end": None, "chunk_ids": exam_chunk_ids[:80],
            }
            _insert_unit([erow], f"Exam: {erow['title']}", True)

    # Parked chunks -> a final catch-all unit so nothing is lost (full builds only)
    if fresh_build and parked:
        cpl = chunks_per_lesson
        n = len(parked)
        n_lessons = max(1, math.ceil(n / cpl))
        per = math.ceil(n / n_lessons)
        rows = []
        for li in range(n_lessons):
            sl = parked[li * per:(li + 1) * per]
            if not sl:
                continue
            rows.append({
                "user_id": owner_id, "classroom_id": classroom_id, "document_id": sl[0]["document_id"],
                "topic_id": None, "unit_order": next_unit_order, "lesson_order": len(rows),
                "kind": "lesson", "title": f"Lesson {len(rows) + 1}",
                "chunk_start": None, "chunk_end": None, "chunk_ids": [c["id"] for c in sl],
            })
        rows.append({
            "user_id": owner_id, "classroom_id": classroom_id, "document_id": parked[0]["document_id"],
            "topic_id": None, "unit_order": next_unit_order, "lesson_order": 999,
            "kind": "review", "title": "Review", "chunk_start": None, "chunk_end": None,
            "chunk_ids": [c["id"] for c in parked][:60],
        })
        _insert_unit(rows, "Additional material", False)

    # Pre-generate the first couple of tiles in the background so the freshly
    # built path opens ready to play instead of stalling on the first tap.
    background_tasks.add_task(_prewarm_lessons, classroom_id, None, 2)

    return {
        "classroom_id": classroom_id,
        "lessons_created": created,
        "units": units_summary,
        "parked_chunks": len(parked),
        "schedule": schedule,
    }


def _ensure_lesson_quiz(lesson_id: str):
    """Return one lesson node's quiz, generating + caching it on first open.

    Idempotent and side-effect-safe, so it can run from a background prewarm task
    as well as from the /lesson-quiz request. Returns a dict (may contain 'error')."""
    rows = supabase.table("lessons").select("*").eq("id", lesson_id).execute().data
    if not rows:
        return {"error": "Lesson not found."}
    lesson = rows[0]

    # Already generated once? Return the cached quiz instantly.
    if lesson.get("quiz_id"):
        q = supabase.table("quizzes").select("id,title").eq("id", lesson["quiz_id"]).execute().data
        if q:
            qq = (
                supabase.table("quiz_questions").select("*")
                .eq("quiz_id", lesson["quiz_id"]).order("position").execute().data
            ) or []
            return {
                "quiz_id": q[0]["id"],
                "title": q[0]["title"],
                "questions": [
                    {
                        "position": r["position"],
                        "question": r["question"],
                        "choices": r["choices"],
                        "correct_index": r["correct_index"],
                        "explanation": r["explanation"],
                    }
                    for r in qq
                ],
            }
        # The cached quiz row is gone (e.g. deleted) -> fall through and regenerate.

    # Bridge node (a foundational gap your uploads skip): there is no source
    # material, so generate the quiz from the topic itself using the model's own
    # knowledge -- a "bridge" lesson, not RAG over your handouts.
    if lesson.get("is_bridge"):
        tname = lesson.get("title") or "this topic"
        if lesson.get("topic_id"):
            trow = supabase.table("topics").select("name").eq("id", lesson["topic_id"]).execute().data
            if trow and trow[0].get("name"):
                tname = trow[0]["name"]
        num_q = 8 if lesson.get("kind") == "review" else 5
        clean, err = _questions_from_topic(tname, num_q)
        if err:
            return {"error": err}
        owner_id = _owner_of_classroom(lesson["classroom_id"])
        if not owner_id:
            return {"error": "Classroom not found."}
        try:
            payload = _save_quiz(lesson["classroom_id"], lesson["document_id"], owner_id,
                                 lesson.get("title") or tname, clean, origin="lesson")
        except Exception as e:
            return {"error": f"Saving the quiz failed: {e}"}
        supabase.table("lessons").update({"quiz_id": payload["quiz_id"]}).eq("id", lesson_id).execute()
        return payload

    # Gather this node's chunks. Topic-based nodes store explicit chunk ids
    # (which may span several handouts); legacy nodes slice one handout by index.
    chunk_ids = lesson.get("chunk_ids")
    if chunk_ids:
        rows2 = (
            supabase.table("document_chunks").select("id,content,chunk_index")
            .in_("id", chunk_ids).execute().data
        ) or []
        order = {cid: i for i, cid in enumerate(chunk_ids)}
        rows2.sort(key=lambda c: order.get(c["id"], 10 ** 9))
        chunks = rows2
    else:
        chunks = (
            supabase.table("document_chunks").select("content,chunk_index")
            .eq("document_id", lesson["document_id"]).order("chunk_index").execute().data
        ) or []
        if lesson.get("chunk_start") is not None and lesson.get("chunk_end") is not None:
            cs, ce = lesson["chunk_start"], lesson["chunk_end"]
            chunks = [c for c in chunks if cs <= c["chunk_index"] <= ce]
    if not chunks:
        return {"error": "No processed material for this lesson yet."}

    source_text = "\n\n".join(c["content"] for c in chunks)[:12000]
    num_q = 10 if lesson.get("kind") == "exam" else (8 if lesson.get("kind") == "review" else 5)

    clean, err = _questions_from_text(source_text, num_q)
    if err:
        return {"error": err}

    owner_id = _owner_of_classroom(lesson["classroom_id"])
    if not owner_id:
        return {"error": "Classroom not found."}

    title = lesson.get("title") or "Lesson"
    try:
        payload = _save_quiz(lesson["classroom_id"], lesson["document_id"], owner_id, title, clean, origin="lesson")
    except Exception as e:
        return {"error": f"Saving the quiz failed: {e}"}

    # Cache the quiz on the lesson so reopening this node is instant next time
    supabase.table("lessons").update({"quiz_id": payload["quiz_id"]}).eq("id", lesson_id).execute()
    return payload


def _path_lessons_in_order(classroom_id: str):
    """All real (non-checkpoint) path nodes for a classroom, in walk order."""
    rows = (
        supabase.table("lessons").select("id,quiz_id,kind,unit_order,lesson_order")
        .eq("classroom_id", classroom_id)
        .order("unit_order", desc=False).order("lesson_order", desc=False)
        .execute().data
    ) or []
    return [r for r in rows if r.get("kind") != "checkpoint"]


def _prewarm_lessons(classroom_id: str, after_lesson_id: str = None, count: int = 2):
    """Generate quizzes for the next `count` not-yet-cached nodes so opening them
    later is instant. Stops on the first failure (e.g. a quota cap) so it doesn't
    burn through the whole model fallback chain. Returns how many it warmed."""
    lessons = _path_lessons_in_order(classroom_id)
    if after_lesson_id:
        idx = next((i for i, l in enumerate(lessons) if l["id"] == after_lesson_id), -1)
        lessons = lessons[idx + 1:] if idx >= 0 else lessons
    warmed = 0
    for l in lessons:
        if warmed >= count:
            break
        if l.get("quiz_id"):
            continue  # already cached
        # Re-check freshly in case another task just cached it (narrows races)
        fresh = supabase.table("lessons").select("quiz_id").eq("id", l["id"]).execute().data
        if fresh and fresh[0].get("quiz_id"):
            continue
        res = _ensure_lesson_quiz(l["id"])
        if isinstance(res, dict) and res.get("error"):
            break  # don't keep hammering a capped model
        warmed += 1
    return warmed


@app.post("/lesson-quiz")
def lesson_quiz(lesson_id: str, background_tasks: BackgroundTasks):
    """Return one lesson node's quiz (generating on first open), then warm the
    NEXT node in the background so the following tile opens instantly."""
    payload = _ensure_lesson_quiz(lesson_id)
    if isinstance(payload, dict) and not payload.get("error"):
        rows = supabase.table("lessons").select("classroom_id").eq("id", lesson_id).execute().data
        if rows:
            background_tasks.add_task(_prewarm_lessons, rows[0]["classroom_id"], lesson_id, 1)
    return payload


@app.post("/prewarm-lessons")
def prewarm_lessons(classroom_id: str, background_tasks: BackgroundTasks, count: int = 2):
    """Warm the next `count` uncached tiles for a classroom in the background and
    return immediately. The app calls this when the path screen opens so the
    current (and next) tile are ready before they're tapped."""
    background_tasks.add_task(_prewarm_lessons, classroom_id, None, count)
    return {"status": "warming", "count": count}


def _ensure_doc_connected(owner_id, doc_id):
    """Make ONE handout's concept map a single connected graph.

    Gemini's links sometimes leave a concept (or a small cluster) unlinked. This
    joins every separated piece to the rest using the most similar pair of
    concepts, so 'reading the handout' always produces a connected brain.
    Cheap: no LLM calls. Adds 'related' edges (which recompute_connections keeps).
    """
    nodes = (
        supabase.table("brain_nodes").select("id,embedding")
        .eq("document_id", doc_id).execute().data
    ) or []
    if len(nodes) < 2:
        return 0

    ids = [n["id"] for n in nodes]
    id_set = set(ids)
    vecs = {n["id"]: _parse_vec(n.get("embedding")) for n in nodes}

    # Build adjacency from edges that live entirely inside this handout
    all_edges = (
        supabase.table("brain_edges").select("source_node_id,target_node_id")
        .eq("user_id", owner_id).execute().data
    ) or []
    adj = {i: set() for i in ids}
    for e in all_edges:
        s, t = e["source_node_id"], e["target_node_id"]
        if s in id_set and t in id_set:
            adj[s].add(t)
            adj[t].add(s)

    # Find connected components (BFS)
    comp_of, comps = {}, []
    for i in ids:
        if i in comp_of:
            continue
        stack, group = [i], []
        comp_of[i] = len(comps)
        while stack:
            cur = stack.pop()
            group.append(cur)
            for nb in adj[cur]:
                if nb not in comp_of:
                    comp_of[nb] = len(comps)
                    stack.append(nb)
        comps.append(group)

    if len(comps) <= 1:
        return 0

    # Greedily merge components by their most similar cross-component pair
    new_edges = []
    while len(comps) > 1:
        comps.sort(key=len, reverse=True)
        base, other = comps[0], comps[1]
        best, best_sim = None, -2.0
        for a in base:
            va = vecs.get(a)
            for b in other:
                vb = vecs.get(b)
                sim = dot(va, vb) if (va and vb) else -1.0
                if sim > best_sim:
                    best_sim, best = sim, (a, b)
        a, b = best
        s, t = sorted([a, b])
        new_edges.append({
            "user_id": owner_id, "source_node_id": s, "target_node_id": t,
            "relationship": "related concept", "kind": "related",
        })
        comps[0] = base + other
        comps.pop(1)

    if new_edges:
        supabase.table("brain_edges").upsert(
            new_edges, on_conflict="user_id,source_node_id,target_node_id", ignore_duplicates=True
        ).execute()
    return len(new_edges)

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
                resp, _model = llm.generate(
                    "heavy",
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

    # Make sure each handout's OWN concept map is one connected graph (cheap, no LLM).
    # This is what fixes lone/floating concepts after reading a handout.
    class_docs = (
        supabase.table("documents").select("id")
        .eq("classroom_id", classroom_id).execute().data
    ) or []
    for cd in class_docs:
        _ensure_doc_connected(owner_id, cd["id"])

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

    # Remove its chunks, then the row itself (brain_nodes + lessons cascade on the FK)
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


@app.get("/models")
def models(list_available: bool = False):
    """Inspect the model router: the tier chains, which model answered last, and
    which models are on cooldown. Pass ?list_available=true to also ask the API
    which model ids this key can currently see."""
    out = llm.status()
    out["embed_model"] = EMBED_MODEL
    if list_available:
        out["available"] = llm.list_available()
    return out
