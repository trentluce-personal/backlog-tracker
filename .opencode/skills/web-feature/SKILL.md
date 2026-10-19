---
name: web-feature
description: Use when implementing a web application feature spanning UI, API, or persistent data, or coordinating a nontrivial change to accounts, characters, campaigns, or saves. Defines a minimal acceptance-to-verification workflow for this monorepo.
---

# Web feature workflow

Read `AGENTS.md` and relevant README sections first. Choose the smallest useful
increment, keep edition data separate from UI/rules, and preserve unrelated work.
Use this proportional workflow; a text/style tweak does not require a schema
plan, formal spec document, or extra agents.

## 1. Establish acceptance criteria

Summarize the observable result, affected users, happy path, and a relevant
failure case. Use facts already supplied rather than asking again. Clarify major
architecture/dependency choices before adding them. When the user is unavailable,
continue independent work and retain genuinely blocking questions for the end.

For a nontrivial feature, keep a short task list. Document durable behavior in
README or a focused document only when it helps future work; avoid speculative plans.

## 2. Trace the vertical slice

Identify the existing component, API endpoint, validation, data model, and checks
affected. Apps live in `apps/`; root npm installs use one lockfile. Extract shared
code into `packages/` only when multiple apps consume it.

For persisted or protected features, consult `docs/product.md` and state relevant invariants:

- Campaign editing/preparation is open to everyone reaching the app; DM is not
  an ownership/privacy boundary. Live host authority uses browser capabilities,
  not display names or accounts. Enforce actual protected operations server-side.
- Preserve unavailable legacy personal data without exposing it. Don't log
  credentials, capability tokens, private PDFs, or personal campaign contents.
- Campaign characters retain the campaign's fixed edition. Edition metadata
  alone does not automate rules; preserve existing sheet formats and HP meaning.
- Checkpoints and complete versions have distinct restore scopes; preserve
  immutable history and require expected revisions without silently rebasing drafts.
- Multi-row mutations are transactional. Use parameterized SQL and validate
  inputs; consider simultaneous requests and rollback behavior when relevant.
- Schema evolution uses a new numbered migration, never rewrites an applied one.
  Preserve existing data and consider compatibility with stored JSON versions.

## 3. Implement with existing pieces

Reuse components and local tokens from `docs/design.md`. Load `ui-quality` and
`frontend-review` for affected frontend controls/appearance. Keep components,
routes, and effects readable; avoid compressed monolithic additions and generic
engines. Extract by responsibility when complexity warrants it.

Relevant React habits: parallelize independent fetches, handle stale/unmounted
responses, clean up timers/listeners, derive simple state during render, and use
functional updates when based on prior state. Avoid blanket memoization, caching,
state libraries, or Next.js-specific rules in this Vite app. Profile actual
performance issues before changing architecture.

## 4. Verify the requested behavior

Load `verification` for commands, safe targets, proportional check selection,
and acceptance-linked evidence. Cover affected domain invariants above, including
failure/conflict and stored-format compatibility where relevant. Use
`regression-debugging` for failed checks or unexpected behavior; UI execution
and criteria remain in `frontend-review` and `ui-quality`.

## 5. Review and finish

Inspect the intended diff, acceptance criteria, verification evidence, and
documentation. Preserve unfamiliar changes as possible user work. Reuse applicable
evidence and report completion using `verification`.

For a nontrivial completed feature affecting accounts, permissions, migrations,
campaign saves, or shared controls, request one independent `app-reviewer` pass
when that agent is available and delegated review is permitted. Supply the scope,
requirements, changed files, and checks already run. Do not spawn a reviewer for
every small edit or launch overlapping implementation agents. If unavailable,
perform the same focused review yourself and state that it was self-review.

Resolve reproduced material findings; treat taste suggestions as optional.
Report what works, checks actually performed, and remaining gaps/questions.
Commits, pushes, and PRs require an explicit user request.

## Sources informing this workflow

- https://playwright.dev/docs/best-practices
- https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices
- https://expressjs.com/en/advanced/best-practice-security.html
- https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

These references support focused engineering practices. They do not authorize
new dependencies, hosted services, or a larger architecture.
