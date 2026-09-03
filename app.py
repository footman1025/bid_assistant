import io
import json
import os
import uuid
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

load_dotenv()

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
STYLES_PATH = DATA_DIR / "styles.json"
STATIC_DIR = ROOT / "static"

DATA_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Bid Assistant")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class StyleIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    tone: str = ""
    voice: str = ""
    length: str = ""
    notes: str = ""
    prompts: list[str] = []


def load_styles() -> list[dict]:
    if not STYLES_PATH.exists():
        return []
    return json.loads(STYLES_PATH.read_text(encoding="utf-8"))


def save_styles(styles: list[dict]) -> None:
    STYLES_PATH.write_text(json.dumps(styles, indent=2, ensure_ascii=False), encoding="utf-8")


def find_style(style_id: str) -> dict | None:
    for style in load_styles():
        if style["id"] == style_id:
            return style
    return None


def style_prompts(style: dict) -> list[str]:
    raw = style.get("prompts")
    if isinstance(raw, list):
        return [item.strip() for item in raw if isinstance(item, str) and item.strip()]
    prompt = style.get("prompt")
    if isinstance(prompt, str) and prompt.strip():
        return [prompt.strip()]
    return []


def next_prompt(style: dict) -> str:
    prompts = style_prompts(style)
    if not prompts:
        return ""
    index = int(style.get("use_count") or 0) % len(prompts)
    return prompts[index]


def style_record(style_id: str, body: StyleIn, existing: dict | None = None) -> dict:
    return {
        "id": style_id,
        "name": body.name.strip(),
        "tone": body.tone.strip(),
        "voice": body.voice.strip(),
        "length": body.length.strip(),
        "notes": body.notes.strip(),
        "prompts": [item.strip() for item in body.prompts if item.strip()],
        "use_count": int((existing or {}).get("use_count") or 0),
    }


def extract_text(filename: str, data: bytes) -> str:
    name = filename.lower()
    if name.endswith((".txt", ".md", ".csv", ".json", ".log")):
        return data.decode("utf-8", errors="replace")
    if name.endswith(".pdf"):
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        pages = [page.extract_text() or "" for page in reader.pages]
        return "\n".join(pages).strip()
    if name.endswith(".docx"):
        from docx import Document

        document = Document(io.BytesIO(data))
        return "\n".join(p.text for p in document.paragraphs).strip()
    raise ValueError(
        f"Unsupported file type: {filename}. Use PDF, DOCX, TXT, MD, CSV, or JSON."
    )


def build_bid_prompt(
    requirements: str,
    prompt: str,
    style: dict,
    attachments: str,
    timeline: str = "",
    budget: str = "",
) -> tuple[str, str]:
    system = (
        "You write freelance bids and project proposals.\n"
        "Write only the bid, ready to send. No title, no notes, no preamble.\n"
        "Stay faithful to the project requirements and the user's bid prompt.\n"
        "Do not invent clients, prices, timelines, or credentials that were not provided.\n"
        "If a detail is missing, write around it or ask one short clarifying question at the end."
    )
    user = f"""BID STYLE
Name: {style.get("name", "")}
Tone: {style.get("tone", "")}
Voice: {style.get("voice", "")}
Length: {style.get("length", "")}
Notes: {style.get("notes", "")}

BID MAKING PROMPT
{prompt.strip() or "Write a clear bid that shows understanding, outlines a simple approach, and ends with a next step."}

PROJECT REQUIREMENTS
{requirements.strip()}

PROJECT TIMELINE
{timeline.strip() or "(not provided)"}

PROJECT BUDGET
{budget.strip() or "(not provided)"}

ATTACHMENT TEXT
{attachments.strip() or "(none)"}
"""
    return system, user


def http_error_detail(data: dict, fallback: str) -> str:
    error = data.get("error")
    if isinstance(error, dict):
        return error.get("message") or fallback
    if isinstance(error, str):
        return error
    return fallback


def call_gemini(api_key: str, model: str, system: str, user: str) -> str:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {"temperature": 0.6, "maxOutputTokens": 4096},
    }
    try:
        response = httpx.post(
            url,
            headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
            json=payload,
            timeout=90.0,
        )
    except httpx.HTTPError as error:
        raise HTTPException(status_code=400, detail=f"Could not reach Gemini: {error}") from error

    data = response.json() if response.content else {}
    if response.status_code >= 400:
        error = data.get("error") or {}
        raise HTTPException(
            status_code=400,
            detail=error.get("message") or json.dumps(data) or f"Gemini HTTP {response.status_code}",
        )

    candidates = data.get("candidates") or []
    if not candidates:
        raise HTTPException(status_code=400, detail="Gemini returned no bid. Try again.")

    parts = (candidates[0].get("content") or {}).get("parts") or []
    text = "".join(part.get("text", "") for part in parts).strip()
    if not text:
        reason = candidates[0].get("finishReason", "unknown")
        raise HTTPException(status_code=400, detail=f"Gemini stopped without text ({reason}).")
    return text


def call_openai_compatible(base_url: str, api_key: str, model: str, system: str, user: str) -> str:
    root = base_url.rstrip("/")
    if root.endswith("/v1"):
        url = f"{root}/chat/completions"
    else:
        url = f"{root}/v1/chat/completions"
    try:
        response = httpx.post(
            url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "temperature": 0.6,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            },
            timeout=90.0,
        )
    except httpx.HTTPError as error:
        raise HTTPException(status_code=400, detail=f"Could not reach the model API: {error}") from error

    data = response.json() if response.content else {}
    if response.status_code >= 400:
        raise HTTPException(
            status_code=400,
            detail=http_error_detail(data, f"Model API HTTP {response.status_code}"),
        )
    bid = (((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
    if not bid:
        raise HTTPException(status_code=400, detail="The model returned no bid. Try again.")
    return bid


def call_ollama(base_url: str, model: str, system: str, user: str) -> str:
    url = f"{base_url.rstrip('/')}/api/chat"
    try:
        response = httpx.post(
            url,
            json={
                "model": model,
                "stream": False,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            },
            timeout=180.0,
        )
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=400,
            detail=f"Could not reach Ollama at {base_url}. Install it from https://ollama.com and run: ollama pull {model}",
        ) from error

    data = response.json() if response.content else {}
    if response.status_code >= 400:
        raise HTTPException(
            status_code=400,
            detail=data.get("error") or f"Ollama HTTP {response.status_code}",
        )
    bid = ((data.get("message") or {}).get("content") or "").strip()
    if not bid:
        raise HTTPException(
            status_code=400,
            detail=f"Ollama returned no bid. Run: ollama pull {model}",
        )
    return bid


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/favicon.ico")
def favicon() -> FileResponse:
    return FileResponse(STATIC_DIR / "favicon.png")


@app.get("/api/styles")
def list_styles() -> list[dict]:
    return load_styles()


@app.post("/api/styles")
def create_style(body: StyleIn) -> dict:
    styles = load_styles()
    style = style_record(uuid.uuid4().hex[:10], body)
    styles.append(style)
    save_styles(styles)
    return style


@app.put("/api/styles/{style_id}")
def update_style(style_id: str, body: StyleIn) -> dict:
    styles = load_styles()
    for index, style in enumerate(styles):
        if style["id"] == style_id:
            styles[index] = style_record(style_id, body, style)
            save_styles(styles)
            return styles[index]
    raise HTTPException(status_code=404, detail="Style not found")


@app.delete("/api/styles/{style_id}")
def delete_style(style_id: str) -> dict:
    styles = load_styles()
    next_styles = [style for style in styles if style["id"] != style_id]
    if len(next_styles) == len(styles):
        raise HTTPException(status_code=404, detail="Style not found")
    if not next_styles:
        raise HTTPException(status_code=400, detail="Keep at least one style")
    save_styles(next_styles)
    return {"ok": True}


@app.post("/api/styles/{style_id}/use")
def mark_style_used(style_id: str) -> dict:
    styles = load_styles()
    for index, style in enumerate(styles):
        if style["id"] == style_id:
            styles[index]["use_count"] = int(style.get("use_count") or 0) + 1
            save_styles(styles)
            return {"use_count": styles[index]["use_count"]}
    raise HTTPException(status_code=404, detail="Style not found")


async def collect_prompt(
    requirements: str,
    prompt: str,
    style_id: str,
    files: list[UploadFile] | None,
    timeline: str = "",
    budget: str = "",
) -> tuple[dict, str, str]:
    if not requirements.strip():
        raise HTTPException(status_code=400, detail="Add the project requirements")

    style = find_style(style_id)
    if not style:
        raise HTTPException(status_code=400, detail="Choose a bid style")

    attachment_parts: list[str] = []
    for upload in files or []:
        if not upload.filename:
            continue
        data = await upload.read()
        if not data:
            continue
        try:
            text = extract_text(upload.filename, data)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        if text:
            attachment_parts.append(f"--- {upload.filename} ---\n{text[:20000]}")

    system, user = build_bid_prompt(
        requirements=requirements,
        prompt=next_prompt(style),
        style=style,
        attachments="\n\n".join(attachment_parts),
        timeline=timeline,
        budget=budget,
    )
    return style, system, user


@app.post("/api/prepare")
async def prepare_bid(
    requirements: str = Form(...),
    prompt: str = Form(""),
    style_id: str = Form(...),
    timeline: str = Form(""),
    budget: str = Form(""),
    files: list[UploadFile] | None = File(None),
) -> dict:
    style, system, user = await collect_prompt(
        requirements, prompt, style_id, files, timeline, budget
    )
    prompts = style_prompts(style)
    index = int(style.get("use_count") or 0) % len(prompts) if prompts else 0
    return {
        "style": style["name"],
        "system": system,
        "user": user,
        "prompt_index": index + 1 if prompts else 0,
        "prompt_count": len(prompts),
    }


@app.post("/api/generate")
async def generate_bid(
    requirements: str = Form(...),
    prompt: str = Form(""),
    style_id: str = Form(...),
    api_key: str = Form(""),
    model: str = Form(""),
    provider: str = Form("gemini"),
    base_url: str = Form(""),
    timeline: str = Form(""),
    budget: str = Form(""),
    files: list[UploadFile] | None = File(None),
) -> dict:
    style, system, user = await collect_prompt(
        requirements, prompt, style_id, files, timeline, budget
    )
    chosen = (provider or "gemini").strip().lower()
    chosen_model = model.strip()

    if chosen == "gemini":
        key = (api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or "").strip()
        if not key:
            raise HTTPException(status_code=400, detail="Add a Gemini API key in Settings.")
        bid = call_gemini(key, chosen_model or "gemini-3.6-flash", system, user)
    elif chosen == "ollama":
        host = (base_url or os.getenv("OLLAMA_HOST") or "http://127.0.0.1:11434").strip()
        bid = call_ollama(host, chosen_model or "llama3.2", system, user)
    elif chosen == "openai":
        key = (api_key or os.getenv("OPENAI_API_KEY") or "").strip()
        if not key:
            raise HTTPException(status_code=400, detail="Add an OpenAI API key in Settings.")
        bid = call_openai_compatible(
            "https://api.openai.com",
            key,
            chosen_model or "gpt-4o-mini",
            system,
            user,
        )
    elif chosen == "deepseek":
        key = (api_key or os.getenv("DEEPSEEK_API_KEY") or "").strip()
        if not key:
            raise HTTPException(status_code=400, detail="Add a DeepSeek API key in Settings.")
        bid = call_openai_compatible(
            "https://api.deepseek.com",
            key,
            chosen_model or "deepseek-chat",
            system,
            user,
        )
    else:
        raise HTTPException(status_code=400, detail="Choose Gemini, OpenAI, DeepSeek, or Ollama in Settings.")

    mark_style_used(style["id"])
    return {"bid": bid, "style": style["name"]}
