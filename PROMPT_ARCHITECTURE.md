# Prompt Architecture

The production provider should use one small prompt per stage rather than one mega-prompt:

1. **Classification:** label each page as instructional, analogy/hook, or assessment, returning a label and rationale.
2. **Concept extraction:** return a checklist of teachable claims with page references.
3. **Planning:** order concepts into hook, teaching beats, transitions, and close with a seconds budget.
4. **Generation:** write one four-column section from only its concept and source chunks; return source tags with every row.
5. **Grounding review:** compare each claim against the supplied source chunks and mark unsupported claims.
6. **Grade review:** assess vocabulary and sentence complexity against the selected grade.

The backend keeps these boundaries as Python functions so provider calls remain replaceable and intermediate JSON can be inspected during a demo.
