# Architecture notes

System-level overviews of how parts of Wall & Shadow fit together — the
*shape* and the *why*, not a line-by-line description of the code.

These documents are **intentionally orthogonal to the code comments**. Inline
comments explain a specific function; these explain a subsystem: its
boundaries, the decisions behind it, the data flow across files, and the things
a newcomer needs to hold in their head that aren't visible from any single
file. When the two disagree, the code is the source of truth — open an issue or
fix the doc.

Keep each note short and durable. Prefer explaining a decision and its
trade-off over enumerating current field names (those drift; the rationale
doesn't).

| Document | Covers |
| --- | --- |
| [ephemeral-state.md](ephemeral-state.md) | The ephemeral (in-memory, never-persisted) collaboration layer: presence and live overlays (scribbles / rulers) |

See also `docs/REPLATFORM.md` for the overall stack and deployment
architecture, and `docs/EPHEMERAL_WS.md` for the original (now partly
superseded) design notes on ephemeral WebSocket messages.
