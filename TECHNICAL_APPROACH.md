# Technical Approach

Lesson Script Studio is intentionally a small full-stack prototype. React/Vite handles the configuration form and a dense script workspace; FastAPI owns the PDF and orchestration workflow.

The backend preserves page boundaries through PyMuPDF, normalizes extraction artifacts, and classifies non-instructional content before concept extraction. Concepts become a measurable checklist. A time-budgeted outline then supplies only relevant source context to each generation beat. Rows retain page references, so grounding is visible rather than asserted.

Validation computes coverage percentage, groundedness percentage, readability grade, word count, and estimated duration. The final screen exposes these metrics beside the script and retains a pipeline trace. Row-level regeneration is intentionally scoped to a single row, preserving the rest of the draft.

Known limitations: scanned PDFs require OCR, the demo fallback is deterministic rather than an LLM, readability is currently a fixed demo value, and the duration adjustment function is a documented extension point rather than a full retry loop. These are deliberate prototype boundaries; the interfaces support adding an Ollama/Groq/Gemini provider and a bounded validation retry without changing the UI contract.
