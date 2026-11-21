---
name: verification
description: Use when selecting checks or reporting completion evidence for a change. Maps acceptance criteria to focused commands and scenarios, safe targets, results, and limitations.
---

# Verification

Own check selection and evidence here; `web-feature` defines domain coverage,
`ui-quality` defines UI criteria, and `frontend-review` owns browser mechanics.
Scale to the change: a focused edit needs focused inspection, not every check below.
Skills grant no tools or permissions; read-only agents delegate execution.

## Procedure

1. Inspect scope and pre-existing changes. Map each acceptance criterion to the
   smallest meaningful command or observable scenario. Check available runtimes,
   dependencies, services, and target first; use installed pinned tools. Capture
   a baseline when needed to distinguish existing failures from regressions.
2. Select only commands that exist in this repository:
   - API integration: from the repository root, `npm test` or `npm run test:api`.
     Both run the native Node test suite in `apps/api/test/`; they are equivalent,
     not additional independent coverage. Use Node.js 24.13 or newer. Do not run
     the API suite through the production Compose container.
   - Frontend implementation: `npm run build --workspace apps/web` for the focused
     frontend typecheck/bundle, or root `npm run build` for both workspaces. There
     is currently no separate frontend test script or component runner. Appearance
     and interaction also need `frontend-review` and `ui-quality`; a build is not
     runtime or visual proof.
   - API compile only: `npm run build --workspace apps/api` when a focused static
     check is sufficient.
   - Startup regressions: build first, then `npm run test:startup`. Its documented
     fixtures isolate their database/model paths and exercise development and
     production startup; use it only when relevant to the change.
   - Browser: `npm run browser -- ...` invokes the pinned `@playwright/cli` 0.1.22
     with installed Chrome. Follow `frontend-review` and README's browser section;
     do not add a browser dependency/tool or download another browser.
   - Docs/harness/manifests: inspect scoped diffs and all new files, validate local
     references and frontmatter/JSON as applicable, and run `git diff --check`.
     If already installed, `opencode debug config` checks resolved configuration
     without a model request; do not download/update tools or expose resolved
     credentials. Inspect only necessary non-secret fields.
3. Confirm isolation before any mutation. Native API/startup tests allocate fresh
   temporary SQLite and model paths for their own children; they do not redirect
   an already-running development or Compose API. Normal development and Compose
   traffic use the user's actual local data. Compose defines one `app` service;
   its named SQLite volume persists and `./data/models` is a shared host bind.
4. For browser mutations, follow README's **Browser verification** recipe: create
   a fresh per-session temporary directory, set `BACKLOG_DB_PATH` to a SQLite file
   inside it and `BACKLOG_MODEL_PATH` to a model file directly inside that same
   dedicated directory, and start your own app on verified-free alternate `PORT`
   and `BACKLOG_WEB_PORT` values. The dedicated parent directory is required to
   isolate named-model siblings as well as the singleton model. Verify these paths
   and the target URL before creating, editing, saving, or deleting anything.
   A fresh or temporary browser profile isolates browser identity/state only; it
   is never persistent-data isolation. If a verified isolated target is unavailable,
   mark mutation scenarios **blocked** rather than using live data.
5. Never seed or delete live projects/tasks/models, truncate data, or use
   `docker compose down -v` to make verification possible. Do not stop a user's
   existing server or mutate shared model files to create a test target. Do not
   invent an unverified isolation recipe.
6. Run selected checks and inspect actual output and relevant images. Use ignored
   `artifacts/` or `.playwright-cli/` for non-private screenshots, traces, and
   browser logs; exclude credentials and personal content. Saving an artifact is
   not inspecting it. For failures load `regression-debugging`; make the minimal
   repair and repeat the failed scenario plus affected checks before completion.
   Add meaningful regression coverage for consequential behavior when practical,
   not a new runner for a reversible low-impact edit.
7. Reuse worker/baseline evidence only while its target and relevant code still
   match. Repeat relevant checks after integration edits, failures, or unresolved
   concerns. Optional diagnostics are not universal completion gates.

## Completion evidence

Use a compact table or equivalent, one row per acceptance criterion/check:

`Acceptance → command/scenario → target/environment → status → artifact/result + limitations`

- **pass**: executed and observed the expected result; include counts where useful.
- **fail**: executed and did not meet expectations; identify baseline versus
  introduced failure, exact failing case, and remaining impact without weakening
  the check.
- **blocked**: could not execute; name the missing prerequisite and unverified scope.
- **static inspection**: code/docs/config examined only; state the conclusion and
  do not present it as runtime proof. Label supplied worker/reviewer evidence
  separately from your own execution.

Include exact changed files, evidence provenance, and remaining gaps. For UI work,
identify the actual DOM interactions, screenshots viewed as images, viewport/theme
states, console/request inspection, and repair/recheck performed. Explain omitted
checks briefly when relevant (for example, no application code changed). New or
edited OpenCode agents, commands, or skills require quitting and restarting;
debug inspection does not reload this session. Never claim a check, image review,
or runtime load not done.
