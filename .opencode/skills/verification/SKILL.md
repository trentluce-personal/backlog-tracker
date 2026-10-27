---
name: verification
description: Use when selecting checks or reporting completion evidence for a change. Maps acceptance criteria to focused commands and scenarios, safe targets, results, and limitations.
---

# Verification

Own check selection and evidence here; `web-feature` defines domain coverage,
`ui-quality` defines UI criteria, and `frontend-review` owns browser mechanics.
Scale to the change: a trivial edit needs focused inspection, not every check
below. Skills grant no tools or permissions; read-only agents delegate execution.

## Procedure

1. Inspect scope and pre-existing changes. Map each acceptance criterion to the
   smallest meaningful command or observable scenario. Check available runtimes,
   dependencies, services, and target first; use installed pinned tools. Capture
   a baseline when needed to distinguish existing failures from regressions.
2. Select applicable checks from existing tooling:
   - Web logic: `npm run test:web` uses existing Node tests, not a component runner.
     For a focused case use `node --test apps/web/test/<file>.test.js`.
   - Frontend implementation: `npm run build`. Appearance/interaction also needs
     `frontend-review` and relevant `ui-quality` scenarios; a build is not visual proof.
   - API changes: `docker compose exec -T api npm run test --workspace=@dndharness/api`.
     The wrapper explicitly runs four files, does not forward filter arguments,
     and shares `dndharness_test`. Serialize all suite invocations, including across
     workers; do not claim a filtered run through npm arguments.
   - Docs/harness/manifests: inspect scoped diffs, references, JSON/frontmatter,
     and `git diff --check`. If installed, `opencode debug config` checks resolved
     configuration without a model request; do not download/update tools. Do not
     publish resolved credentials; inspect only needed non-secret fields.
3. Confirm isolation before any mutation. The API wrapper redirects only its test
   child, not the running API. Normal Compose/browser traffic uses campaign data.
   Fresh browser profiles isolate identity, not persistent writes. If an isolated
   browser-mutation environment is unavailable, mark that scenario **blocked**.
   Never seed campaigns, truncate campaign data, or use `docker compose down -v`
   to make verification possible. Do not invent an unverified isolation recipe.
4. Run selected checks and inspect actual output/images. Use ignored `artifacts/`
   for non-private logs/screenshots; exclude credentials and personal campaign
   content. For failures load `regression-debugging`. Add meaningful regression
   coverage for consequential behavior when practical, not tests that mirror code
   or require a new runner for a reversible low-impact edit.
5. Reuse worker/baseline evidence while the target and relevant code still match.
   Repeat only for relevant edits, failures, or unresolved concerns; cover changed
   integration wiring. Optional diagnostics are not universal completion gates.

## Completion evidence

Use a compact table or equivalent, one row per acceptance criterion/check:

`Acceptance → command/scenario → target/environment → status → artifact/result + limitations`

- **pass**: executed and observed the expected result; include counts where useful.
- **fail**: executed and did not meet expectations; identify baseline vs introduced
  failure, exact failing case, and remaining impact without weakening the check.
- **blocked**: could not execute; name the missing prerequisite and unverified scope.
- **static inspection**: code/docs/config examined only; state the conclusion and
  do not present it as runtime proof. Label supplied worker evidence separately.

Include exact changed files, evidence provenance, and remaining gaps. Explain
omitted checks briefly when relevant (e.g. no API/UI change). New/edited OpenCode
skills or agents require quitting and restarting; debug inspection does not reload
this session. Never claim a check, image review, or runtime load not done.
