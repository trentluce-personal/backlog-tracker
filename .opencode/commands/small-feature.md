---
description: Build the smallest useful increment using this repository's established patterns and focused verification.
agent: dispatcher
---

Implement this feature: $ARGUMENTS

Load feature-dispatch. As the read-only dispatcher, delegate this increment to
one scoped implementation worker and review its result and focused checks.
Delegate any integration edits or runtime verification; do not edit yourself.

Read AGENTS.md and README.md first. Load the web-feature skill for its proportional
acceptance-to-verification workflow. Choose the smallest working implementation
that satisfies the request. Reuse existing React components, API routes, storage
patterns, stable IDs, and semantics; do not introduce speculative infrastructure.
Confirm major architecture or dependency choices before adding them. Preserve
unrelated work, update documentation when usage changes, and require the documented
checks appropriate to the change.

For frontend appearance and interaction work, the implementation worker's delegated
brief—not merely your own instructions—must explicitly require reading
docs/design.md and loading and applying both ui-quality and frontend-review.
Include inspection of an adjacent/approved reference before editing when relevant,
use of existing tokens and components, and the complete running-browser loop:
DOM-driven interaction, screenshots actually read as images for appearance,
changed controls at applicable desktop/mobile sizes and both themes, keyboard/focus
and console/failed-request checks, then repair and recheck. Require
[Browser verification](../../README.md#browser-verification): use only the
user's already-running app at its actual URL, with nonpersisting interactions.
Report missing prerequisites and write-dependent scenarios as blocked; never
launch a review target. Scale checks for genuinely low-risk or text-only edits,
but never call a build, an unread screenshot, or a DOM snapshot alone visual verification.
Report the result and any verification gaps.
