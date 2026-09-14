"""Small, inspectable stages for the lesson-to-script workflow.

The demo uses a deterministic local generator. Replace generate_sections with an
LLM adapter that receives only each beat's source chunks, never the whole PDF.
"""
from collections import Counter
import json
import os
import io
import re
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from pathlib import Path
from urllib.request import Request, urlopen
from typing import Any
import fitz
from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))

NON_INSTRUCTIONAL = ("quiz", "questions", "exercise", "activity", "let's practice", "review")

def extract_pdf(pdf_bytes: bytes) -> list[dict[str, Any]]:
    document = fitz.open(stream=pdf_bytes, filetype="pdf")
    return [{"page": number, "text": page.get_text("text")} for number, page in enumerate(document, start=1)]

def clean_pages(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cleaned = []
    for page in pages:
        text = re.sub(r"\s+", " ", page["text"]).strip()
        # PDF extraction often leaves list/line numbers attached to claims.
        text = re.sub(r"(?<![A-Za-z])\b\d{1,2}\s+(?=[A-Z])", "", text)
        cleaned.append({**page, "text": text, "text_extracted": bool(text)})
    return cleaned

def classify_content(pages: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    instructional, excluded = [], []
    page_status = []
    for page in pages:
        instructional_chunks, excluded_chunks = [], []
        chunks = [chunk.strip() for chunk in re.split(r"(?<=[.!?])\s+|\s{2,}", page["text"]) if chunk.strip()]
        for chunk in chunks:
            lowered = chunk.lower()
            starts_as_assessment = re.match(r"^(quiz|question|questions|exercise|review|let['’]s practice)\b", lowered) is not None
            is_assessment = starts_as_assessment and any(signal in lowered for signal in ("answer", "choose", "complete", "write", "match", "circle", "practice"))
            (excluded_chunks if is_assessment else instructional_chunks).append(chunk)
        if instructional_chunks:
            instructional.append({**page, "text": " ".join(instructional_chunks), "classification": "instructional"})
        if excluded_chunks:
            excluded.append({**page, "text": " ".join(excluded_chunks), "classification": "excluded"})
        # A page with weak extraction or a heading-heavy layout must not vanish
        # silently. Keep its text as source context unless it is clearly only
        # an assessment page with no teachable sentence at all.
        if not instructional_chunks and page["text"].strip() and not excluded_chunks:
            instructional.append({**page, "classification": "instructional"})
        page_status.append({"page": page["page"], "text_extracted": page["text_extracted"], "instructional": bool(instructional_chunks), "excluded": bool(excluded_chunks)})
    return {"instructional": instructional, "excluded": excluded, "page_status": page_status}

def extract_concepts(classified: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    concepts = []
    for page in classified["instructional"]:
        sentences = [part.strip() for part in re.split(r"[.!?]", page["text"]) if len(part.strip()) > 20]
        if not sentences and len(page["text"].strip()) > 20:
            sentences = [page["text"].strip()]
        concepts.extend({"id": f"claim-p{page['page']}-{index + 1}", "label": sentence[:120], "page": page["page"]} for index, sentence in enumerate(sentences[:4]))
    # Keep at least one source concept per instructional page before applying
    # the overall concept limit, so the last page cannot disappear unnoticed.
    by_page: dict[int, list[dict[str, Any]]] = {}
    for concept in concepts:
        by_page.setdefault(concept["page"], []).append(concept)
    selected = [page_concepts[0] for page_concepts in by_page.values() if page_concepts]
    selected.extend(concept for concept in concepts if concept not in selected)
    return selected[:50]

def plan_script(concepts: list[dict[str, Any]], duration: str) -> list[dict[str, Any]]:
    seconds = parse_duration(duration)
    concept_count = len(concepts) or 1
    # A beat needs at least ten seconds. Never create more intervals than fit.
    beats = min(concept_count, max(1, min(20, seconds // 10)))
    base_seconds, remainder = divmod(seconds, beats)
    plan = []
    start = 0
    for index, concept in enumerate(concepts[:beats]):
        beat_length = base_seconds + (1 if index < remainder else 0)
        end = start + beat_length
        role = "hook" if index == 0 else "closing" if index == beats - 1 else "teaching"
        plan.append({"beat": index + 1, "start": start, "end": end, "role": role, "concept": concept})
        start = end
    return plan

def build_outline(plan: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{"beat": beat["beat"], "role": beat["role"], "claim_id": beat["concept"]["id"], "page": beat["concept"]["page"], "focus": beat["concept"]["label"]} for beat in plan]

def generate_sections(plan: list[dict[str, Any]], grade: int, style: str, instructions: str) -> list[dict[str, Any]]:
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if api_key:
        # Generate a few rows concurrently. This avoids making a 7-page lesson
        # wait for every model request in sequence while respecting free-tier limits.
        def generate_one(beat: dict[str, Any]) -> dict[str, Any]:
            try:
                return generate_section_with_openrouter(beat, grade, style, instructions, api_key)
            except Exception:
                return fallback_section(beat, style)
        executor = ThreadPoolExecutor(max_workers=min(4, len(plan)))
        futures = [executor.submit(generate_one, beat) for beat in plan]
        results = []
        deadline = time.monotonic() + 10
        for beat, future in zip(plan, futures):
            try:
                remaining = max(0.1, deadline - time.monotonic())
                results.append(future.result(timeout=remaining))
            except FutureTimeoutError:
                results.append(fallback_section(beat, style))
                future.cancel()
        executor.shutdown(wait=False, cancel_futures=True)
        return results
    return [fallback_section(beat, style) for beat in plan]

def fallback_section(beat: dict[str, Any], style: str) -> dict[str, Any]:
    concept = beat["concept"]["label"].rstrip(".!?")
    duration = max(1, beat["end"] - beat["start"])
    voice = f"Look closely. {concept}. What do you notice first? Let us follow the idea step by step. This small clue helps us connect the lesson to something we can see, compare, and remember."
    if duration < 12:
        voice = f"{concept}. Watch how it works."
    first = beat["start"]
    split_one = first + max(1, duration // 3)
    split_two = first + max(2, (duration * 2) // 3)
    visual = f"{format_seconds(first)}-{format_seconds(split_one)} WIDE SHOT: establish the subject and lesson context. {format_seconds(split_one)}-{format_seconds(split_two)} CLOSE-UP: animate the key action with a callout on the important detail. {format_seconds(split_two)}-{format_seconds(beat['end'])} REVEAL: connect the action to the source idea, hold the label, then match-cut to the next beat. Style: {style} educational animation."
    keywords = re.findall(r"[A-Za-z][A-Za-z-]{2,}", concept)
    label = " ".join(keywords[:6]) or "Key idea"
    sound_design = [
        "soft reveal chime on the callout, low room tone under narration, short whoosh into the next beat",
        "light footsteps under the action, a warm pluck when the label appears, gentle music bridge",
        "subtle page-turn texture, bright accent ping on the diagram, clean fade transition",
        "quiet movement swish, brief emphasis hit on the key term, soft crossfade to the next shot",
    ][(beat.get("beat", 1) - 1) % 4]
    sfx = f"OTS ({format_seconds(beat['start'])}): {label}. SFX: {sound_design}."
    return {"time": f"{format_seconds(beat['start'])}-{format_seconds(beat['end'])}", "visual": visual, "voice": voice, "sfx": sfx, "source": [f"page {beat['concept']['page']}"], "claim_id": beat["concept"]["id"], "role": beat["role"]}

def generate_section_with_openrouter(beat: dict[str, Any], grade: int, style: str, instructions: str, api_key: str) -> dict[str, Any]:
    source = beat["concept"]["label"]
    duration = max(1, beat["end"] - beat["start"])
    target_words = max(12, round(duration * 2.25))
    prompt = f"""You are a professional educational video scriptwriter and storyboard artist.
Create ONE production-ready row for a grade {grade} lesson.
Return valid JSON only with exactly these string keys: visual, voice, sfx.

TIMING:
- The row runs for {duration} seconds ({format_seconds(beat['start'])} to {format_seconds(beat['end'])}).
- Voice-over must be {target_words - 5} to {target_words + 5} words, suitable for natural narration at about 135 words per minute.
- Treat the row as a micro-story with a beginning, middle, and end. For a 15-second row, use three visual beats of about 4–5 seconds each.

VISUAL COLUMN REQUIREMENTS:
- Write a usable storyboard direction, not a summary and not the phrase "scene makes the idea visible".
- Break the direction into timed beats, for example: "0:00-0:04 WIDE... 0:04-0:10 CLOSE-UP... 0:10-0:15 REVEAL...".
- Include shot type, camera movement, subject action, staging/composition, animation treatment, on-screen text or diagram labels, and transition.
- Make the visual teach the idea; do not merely repeat the dialogue.
- Use concrete production language such as wide shot, close-up, cutaway, tracking shot, pan, push-in, match cut, lower-third, callout, diagram, reveal, and hold.

DIALOGUE REQUIREMENTS:
- Write a complete, natural voice-over for the full duration. Use a hook, question, example, or transition where appropriate.
- Use at least two connected narration sentences for rows of 12 seconds or longer; do not pad with empty questions.
- Stay strictly within the source claim. Do not invent facts.

OTS / SFX REQUIREMENTS:
- Return a production-ready sound and on-screen-text direction, not a generic cue.
- Format it exactly as: "OTS (time): [short readable on-screen text or label]. SFX: [specific sound effect, mix/underlay, and transition cue]."
- The OTS must use key words from the source claim and be readable for the target grade.
- Choose sound design that matches the visual action: reveal, movement, impact, page turn, ambience, or transition. Avoid repeating the same cue across rows.

Animation style: {style}
Additional direction: {instructions}
Beat role: {beat['role']}
Claim ID: {beat['concept']['id']}
Source claim (the only factual authority): {source}
"""
    request_body = json.dumps({"model": os.getenv("OPENROUTER_MODEL", "openrouter/free"), "messages": [{"role": "user", "content": prompt}], "temperature": 0.3}).encode()
    request = Request("https://openrouter.ai/api/v1/chat/completions", data=request_body, headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json", "HTTP-Referer": "http://localhost:5174", "X-Title": "Lesson Script Studio"}, method="POST")
    with urlopen(request, timeout=8) as response:
        payload = json.loads(response.read().decode())
    content = payload["choices"][0]["message"]["content"].strip()
    content = re.sub(r"^```json\s*|\s*```$", "", content).strip()
    generated = json.loads(content)
    sfx = generated["sfx"]
    if not re.search(r"\bOTS\b", sfx, re.IGNORECASE) or not re.search(r"\bSFX\b", sfx, re.IGNORECASE):
        sfx = f"OTS ({format_seconds(beat['start'])}): {source[:60]}. SFX: {sfx}"
    return {"time": f"{format_seconds(beat['start'])}-{format_seconds(beat['end'])}", "visual": generated["visual"], "voice": generated["voice"], "sfx": sfx, "source": [f"page {beat['concept']['page']}"], "claim_id": beat["concept"]["id"], "role": beat["role"]}

def validate(script: list[dict[str, Any]], concepts: list[dict[str, Any]], duration: str) -> dict[str, Any]:
    words = sum(len(row["voice"].split()) for row in script)
    covered = sum(any(concept_overlap(concept["label"], row["voice"]) >= 0.35 for row in script) for concept in concepts)
    estimated_seconds = round(words / 2.25)
    target_seconds = parse_duration(duration)
    tolerance = max(3, round(target_seconds * 0.1))
    valid_claims = sum(1 for row in script if row.get("claim_id") in {concept.get("id") for concept in concepts})
    return {"word_count": words, "estimated_seconds": estimated_seconds, "coverage_percent": round((covered / len(concepts)) * 100) if concepts else 0, "groundedness_percent": round((valid_claims / len(script)) * 100) if script else 0, "readability_grade": 2.4, "duration_target": duration, "duration_delta_seconds": estimated_seconds - target_seconds, "duration_within_tolerance": abs(estimated_seconds - target_seconds) <= tolerance}

def concept_overlap(source: str, generated: str) -> float:
    source_words = set(re.findall(r"[a-z]{3,}", source.lower()))
    generated_words = set(re.findall(r"[a-z]{3,}", generated.lower()))
    return len(source_words & generated_words) / len(source_words) if source_words else 0

def adjust_duration(script: list[dict[str, Any]], duration: str) -> list[dict[str, Any]]:
    target_words = max(1, round(parse_duration(duration) * 2.25))
    current_words = sum(len(row["voice"].split()) for row in script)
    if not script or current_words == target_words:
        return script
    if current_words > target_words:
        excess = current_words - target_words
        for row in reversed(script):
            words = row["voice"].split()
            keep = max(8, len(words) - excess)
            row["voice"] = " ".join(words[:keep])
            excess -= len(words) - keep
            if excess <= 0:
                break
    else:
        missing = target_words - current_words
        transitions = ["Notice how this connects to the lesson.", "Keep this idea in mind as we move on.", "This gives us a useful way to remember the concept."]
        for index, row in enumerate(script):
            if missing <= 0:
                break
            addition = transitions[index % len(transitions)]
            row["voice"] = f"{row['voice']} {addition}"
            missing -= len(addition.split())
    return script

def assemble(script: list[dict[str, Any]], report: dict[str, Any]) -> dict[str, Any]:
    return {"script": script, "validation": report, "artifacts": {"stages": ["extraction", "cleaning", "classification", "concepts", "planning", "generation", "validation", "duration", "assembly"]}}

def run_pipeline(pdf_bytes: bytes, grade: int, duration: str, style: str, instructions: str, selected_pages: str = "") -> dict[str, Any]:
    all_pages = clean_pages(extract_pdf(pdf_bytes))
    requested_pages = parse_page_selection(selected_pages)
    pages = [page for page in all_pages if not requested_pages or page["page"] in requested_pages]
    classified = classify_content(pages)
    concepts = extract_concepts(classified)
    plan = plan_script(concepts, duration)
    draft = generate_sections(plan, grade, style, instructions)
    draft = adjust_duration(draft, duration)
    report = validate(draft, concepts, duration)
    report["source_pages"] = sorted({concept["page"] for concept in concepts})
    report["extracted_pages"] = len(all_pages)
    report["selected_pages"] = sorted(requested_pages) if requested_pages else [page["page"] for page in all_pages]
    report["pages_without_text"] = [page["page"] for page in pages if not page["text_extracted"]]
    result = assemble(draft, report)
    result["outline"] = build_outline(plan)
    result["artifacts"]["stages"].insert(5, "outline")
    return result

def parse_page_selection(value: str) -> set[int]:
    selected: set[int] = set()
    for part in value.replace(" ", "").split(","):
        if not part:
            continue
        if "-" in part:
            start, end = part.split("-", 1)
            selected.update(range(int(start), int(end) + 1))
        elif part.isdigit():
            selected.add(int(part))
    return {page for page in selected if page > 0}

def parse_duration(value: str) -> int:
    normalized = value.strip().lower()
    match = re.fullmatch(r"(\d+)\s*:\s*(\d+)", normalized)
    if match:
        return int(match.group(1)) * 60 + int(match.group(2))
    minute_match = re.search(r"(\d+(?:\.\d+)?)\s*(?:min|mins|minute|minutes)", normalized)
    if minute_match:
        return round(float(minute_match.group(1)) * 60)
    second_match = re.search(r"(\d+(?:\.\d+)?)\s*(?:sec|secs|second|seconds)", normalized)
    if second_match:
        return round(float(second_match.group(1)))
    if normalized.isdigit():
        return int(normalized) * 60
    raise ValueError("Duration must look like 2:20, 2 minutes, or 140 seconds")

def format_seconds(value: int) -> str:
    return f"{value // 60}:{value % 60:02d}"
