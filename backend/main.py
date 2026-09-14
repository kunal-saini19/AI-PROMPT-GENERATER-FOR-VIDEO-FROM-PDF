from pathlib import Path
import os
import re
from fastapi import FastAPI, File, Form, UploadFile
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from pipeline import generate_section_with_openrouter, run_pipeline

app = FastAPI(title="Lesson Script Studio API", version="0.1.0")
frontend_origin = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
app.add_middleware(CORSMiddleware, allow_origins=[frontend_origin], allow_methods=["*"], allow_headers=["*"])

class RegenerateRequest(BaseModel):
    time: str
    source: str
    grade: int = 2
    style: str = "2D"
    instructions: str = ""

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "pipeline": "ready"}

@app.post("/api/generate")
async def generate_script(file: UploadFile = File(...), grade: int = Form(...), duration: str = Form(...), style: str = Form(...), instructions: str = Form(""), pages: str = Form("")):
    pdf_bytes = await file.read()
    return run_pipeline(pdf_bytes, grade=grade, duration=duration, style=style, instructions=instructions, selected_pages=pages)

@app.post("/api/regenerate")
def regenerate_row(request: RegenerateRequest):
    start, end = re.split(r"[-–]", request.time)
    def seconds(value: str) -> int:
        minutes, remainder = value.split(":")
        return int(minutes) * 60 + int(remainder)
    beat = {"start": seconds(start), "end": seconds(end), "role": "teaching", "concept": {"id": "regenerated-claim", "label": request.source, "page": request.source}}
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        return {"time": request.time, "visual": f"{request.style} treatment of {request.source}", "voice": f"Let us explore {request.source}.", "sfx": "Light transition", "source": [request.source]}
    return generate_section_with_openrouter(beat, request.grade, request.style, request.instructions, api_key)
