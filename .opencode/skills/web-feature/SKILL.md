---
name: web-feature
description: Use when implementing or coordinating a backlog-tracker web feature spanning React UI, the Node/SQLite API, projects, tasks, or persisted data models. Defines a minimal acceptance-to-verification workflow for this monorepo.
---

# Web feature workflow

Read `AGENTS.md` and relevant README sections first. Choose the smallest useful
increment and preserve unrelated work. Use this proportional workflow; a text or
style tweak does not require a schema plan, formal spec document, or extra agents.

## 1. Establish acceptance criteria

Summarize the observable result, happy path, and relevant failure cases. Use facts
already supplied rather than asking again. Clarify major architecture or dependency
choices before adding them. When the user is unavailable, continue independent work
and retain genuinely blocking questions for the end.

For a nontrivial feature, keep a short task list. Document durable behavior in
README or a focused existing document only when it helps future work; avoid
speculative plans.

## 2. Trace the vertical slice

Identify the existing component, API endpoint, validation, storage, and checks
affected. The workspaces are `apps/web` (React, TypeScript, Vite) and `apps/api`
(TypeScript, Node HTTP, SQLite); one root lockfile manages both. Reuse these
workspaces and root scripts rather than inventing services, packages, or commands.

For persisted or request-guarded features, read the corresponding README sections
and state relevant invariants:

- This is a local-only personal projects/tasks and data-modeling app with no
  accounts or cloud service. Preserve loopback binding and host/origin/mutation
  guards; do not invent remote hosting or user-ownership rules.
- The default SQLite database and model JSON are separate stores. Native and
  Compose paths differ, while Compose also bind-mounts the repository model
  directory. Automated native tests write only to their own isolated fixtures;
  browser verification is read-only.
- Project deletion permanently cascades to its tasks; confirmation and feedback
  must describe that impact accurately. Failed project/task operations must not
  leave misleading local success state.
- Model create/update/delete operations use server-managed revisions and expected
  revision checks. Preserve user graphs and drafts on validation, conflict, or I/O
  failure; never silently rebase over a newer stored model. Named-model identity
  is its exact lowercase UUID filename, independent of its display name.
- Preserve canonical stored-schema compatibility and atomic same-directory model
  publication. Validate bounds and relationships before writing. A single API
  writer is required per model file because cross-process locking is not provided.
- For project/task SQLite changes, preserve transactional behavior, parameterized
  queries, input validation, and persistence across restart. Schema evolution must
  preserve existing local data and stored JSON compatibility.

## 3. Implement with existing pieces

For affected frontend controls or appearance, read `docs/design.md`, and load and
apply both `ui-quality` and `frontend-review` in the implementation worker's own
context. When relevant, inspect an adjacent or approved reference screen before
editing and record which reference guided the work. Reuse established tokens,
components, layout, interaction, and feedback patterns rather than introducing a
redesign. Delegated workers must receive these requirements explicitly; loading
skills only in a dispatcher or reviewer is insufficient.

Keep components, routes, and effects readable; avoid compressed monolithic additions
and generic engines. Extract by responsibility when complexity warrants it.
Relevant React habits: parallelize independent fetches, handle stale/unmounted
responses, clean up timers/listeners, derive simple state during render, and use
functional updates when based on prior state. Avoid blanket memoization, caching,
state libraries, or Next.js-specific rules in this Vite app. Profile actual
performance issues before changing architecture.

## 4. Verify the requested behavior

Load `verification` for actual package commands, safe targets, proportional check
selection, and acceptance-linked evidence. Cover affected domain invariants,
failure/conflict behavior, and stored-format compatibility where relevant. Use
`regression-debugging` for failed checks or unexpected behavior.

For frontend appearance/interaction work, follow
[Browser verification](../../../README.md#browser-verification) and close the
browser loop on the user's already-running app at its actual URL. Ask the owner
to start it or provide the URL as needed, or report the review as blocked. Use
fresh DOM snapshots for nonpersisting interactions and read non-private screenshots
as images for appearance. Exercise applicable desktop/mobile sizes and both themes;
inspect keyboard/focus, console, and failed requests; repair and recheck observed
issues. Mark write-dependent scenarios as blocked without creating another target.
Preserve proportionality for genuinely text-only or low-risk edits without treating
an unread screenshot, successful build, or DOM snapshot alone as visual proof.

## 5. Review and finish

Inspect the intended diff, acceptance criteria, verification evidence, and
documentation. Preserve unfamiliar changes as possible user work. Reuse applicable
evidence and report completion using `verification`.

For a nontrivial completed feature affecting request guards, persistence,
project/task deletion, model saves, or shared controls, request one independent
`app-reviewer` pass when available and delegated review is permitted. Supply the
scope, requirements, changed files, checks already run, and relevant artifact
paths. Ask it to view supplied screenshots as images. The reviewer remains static
and read-only, and supplied runtime evidence is not its own execution. Do not
spawn a reviewer for every small edit or launch overlapping implementation agents.
If unavailable, perform the same focused review yourself and state that it was
self-review.

Resolve reproduced material findings; treat taste suggestions as optional. Report
what works, checks actually performed, and remaining gaps/questions. Commits,
pushes, and PRs require an explicit user request.

## Sources informing this workflow

- https://playwright.dev/docs/best-practices
- https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices
- https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

These references support focused engineering practices. They do not authorize new
dependencies, hosted services, or a larger architecture.
