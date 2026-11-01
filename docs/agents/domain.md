# Domain docs

Use a single-context layout for the `spatial-memory` web platform. Paths in this document are relative to this repository root; sibling repositories have their own configuration.

## Before exploring

Read the root `GLOSSARY.md` for domain terminology and relevant records in `docs/adr/` for architectural decisions. Follow the existing architecture and reference-document pointers in `AGENTS.md` for the area being changed.

If a `GLOSSARY-MAP.md` is introduced later, use its pointers to select the relevant context glossaries; also read root ADRs and any relevant `src/<context>/docs/adr/` records.

If a glossary or ADR directory does not exist, proceed silently. Do not create empty placeholders during setup. `domain-modeling`, including when reached through `grill-with-docs` or `improve-codebase-architecture`, creates these documents when terminology or decisions are actually resolved.

## Layout

- `GLOSSARY.md`: the shared domain vocabulary for the web platform.
- `docs/adr/`: architectural decisions, including their rationale and trade-offs.

## Vocabulary

Use glossary terms consistently in issue titles, design proposals, hypotheses, and test names. When a needed concept is absent, first check whether the project already has a term for it; pass genuine gaps to `domain-modeling`.

## ADR conflicts

If a proposal contradicts an existing ADR, identify the record and explain the concrete evidence for revisiting it before changing the decision.
