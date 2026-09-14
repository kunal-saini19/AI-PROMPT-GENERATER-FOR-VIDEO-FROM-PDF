# Architecture Notes

## Why stages

The pipeline keeps extraction, classification, concept selection, planning, generation, validation, and duration control separate. Each stage can be logged, tested, and explained in an interview. Generation receives only the source context for a planned beat, reducing hallucination risk compared with dumping the whole PDF into one prompt.

## Key tradeoffs

- **PyMuPDF:** fast local extraction with page boundaries; scanned PDFs need OCR as a production follow-up.
- **Heuristic classifier:** cheap and inspectable for the prototype; ambiguous activity-vs-quiz cases should use a second classifier pass.
- **Local fallback:** makes the demo reproducible without credentials. An Ollama, Gemini, or Groq adapter can implement the same section-generation interface.
- **Word count:** duration is estimated at 135 words/minute and revalidated after adjustment. A production version would use a bounded trim/expand retry loop.

## Differentiation checks

The UI exposes source tags, numeric metrics, intermediate stages, and row-level regeneration. The intended evaluation fixture is the Grade 2 MY BODY lesson at 2:20 with Tara as the narrative frame. A second fixture should assert that a kite activity used as a teaching analogy is retained while a graded exercise is excluded.
