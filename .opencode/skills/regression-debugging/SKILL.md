---
name: regression-debugging
description: Use when investigating a regression, failing check, or unexpected behavior. Reproduces expected versus actual behavior, tests causal hypotheses, and verifies a minimal fix.
---

# Regression debugging

Use `verification` for check selection, safe targets, and completion evidence.
Respect existing permissions and ownership: a read-only dispatcher delegates
diagnostics and fixes; a read-only reviewer supplies reproduction steps only.

1. **Reproduce.** Record expected/actual behavior, exact command or user steps,
   input shape, runtime/version, target URL or test database, and relevant timing
   or browser identity. Inspect current changes and baseline evidence to separate
   pre-existing failures. If reproduction is blocked, report it rather than guess.
2. **Collect scoped diagnostics.** Read the failing assertion, stack, relevant
   code path, requests, or console output. Capture only what discriminates causes;
   exclude credentials, cookies/tokens, private PDFs, and personal campaign data.
   Use isolated fixtures for mutations and `frontend-review` for browser mechanics.
3. **Test a hypothesis.** State a likely cause and choose the smallest check that
   distinguishes it from alternatives. Change one relevant variable at a time.
   For races, inspect ordering, revisions, cancellation, and shared state; use
   condition-based waits or controlled scheduling, not retries/sleeps that hide it.
4. **Guard and fix.** When practical, establish a meaningful failing-before test
   or reproducible scenario, make the smallest causal fix, then demonstrate
   passing-after on the same case. Cover behavior rather than implementation.
   If automated coverage or before/after evidence is impractical, disclose why
   and the remaining gap. Preserve unrelated work; do not weaken assertions,
   skip failures, blindly update baselines, replace real behavior with mocks to
   hide defects, use destructive Git operations, or expand permissions.
5. **Verify integration.** Run the focused regression and applicable integrated
   checks from `verification`. Reuse still-valid evidence; broaden only when the
   fix or unresolved concern warrants it. Report cause, minimal fix, before/after
   evidence, baseline failures, and limitations using its evidence format.
