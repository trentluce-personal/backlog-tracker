---
name: feature-dispatch
description: Use when coordinating a feature across multiple agents or dispatching independent UI, API/data, and verification workstreams. Defines ownership, specialist briefs, integration, and independent review.
---

# Feature dispatch

Coordinate one feature with a few focused agents, not several competing full
implementations. Read `AGENTS.md`, relevant README sections, and product/design
context. For app features use `web-feature` as the acceptance and quality guide.

The default `dispatcher` agent is read-only: it plans, assigns, inspects, and
accepts the work. It delegates all edits and runtime checks to workers, including
integration, documentation, fixes, builds, and browser verification. Its edit
restriction must not be bypassed with shell or other tools. Other coordinating
agents may implement only when their own permissions allow it. Workers follow
their scoped brief; they do not re-dispatch because of project-wide guidance.

## 1. Scope and choose workstreams

State observable acceptance criteria, relevant failure cases, and the smallest
useful increment. Inspect the working tree first and record existing changes in
affected files; uncommitted work is not disposable. Keep a short task list with
workstream owners, dependencies, and verification status.

Use one implementer for a small edit or work that cannot be divided cleanly.
For a substantial multi-aspect feature, normally use two implementation
workstreams and one independent review after integration. Add another worker only
for a clearly independent current need. Examples:

- **UI/interaction:** components, styles, accessibility, responsive behavior.
- **API/data:** routes, validation, permissions, transactions, migrations.
- **Focused research:** existing behavior, compatibility, or a specific unknown.
- **Verification/review:** acceptance gaps and regressions in integrated changes.

Use the available `general` agent with a specialist brief for implementation;
`explore` is for research, and `app-reviewer` is read-only. Do not assume agents
added during this session are already loaded. If delegation is unavailable, do
the work sequentially yourself only if your permissions allow it; a read-only
dispatcher reports the missing implementation worker as a blocker. For small
changes, the dispatcher delegates to one implementer with focused checks.

## 2. Establish boundaries before parallel edits

Agree the shared contract first: endpoint and field names, success/error shapes,
permissions, persisted formats, and UI expectations as applicable. Resolve
contract unknowns through focused research or one initial implementation before
starting dependent work. Do not let agents invent incompatible contracts.

Assign each editable file to exactly one writer at a time. Directory ownership
must include exclusions for shared files. The dispatcher controls assignments for
integration files, root manifests/lockfile, common documentation, and shared
contracts; assign their edits explicitly to a worker. An existing worker can
perform integration after the other writers finish, without adding another agent.
Numbered migrations have one owner. Multiple agents may
read the same files; read-only research/review can overlap implementation when
its purpose is clear, but final review uses the integrated result.

Agents share this checkout: their edits are already present, not patches to
cherry-pick. Never reset, stash, clean, or overwrite another worker's or the
user's work. Workers must stop at their ownership boundary and report required
cross-boundary edits. Hand off a file only after its previous writer has finished.
Reconcile contract changes with affected owners before continuing dependent work.

## 3. Send self-contained specialist briefs

Every task invocation must include:

```text
Role and goal: <specific aspect of this feature>
Acceptance criteria: <observable outcomes and relevant failure cases>
Shared contract: <agreed API/data/UI details; dependencies already ready>
Write scope: <exclusive files/directories and explicit exclusions>
Context: <relevant files, existing changes, decisions, and product constraints>
Mode: <implement within scope OR research/review only>
Checks: <use verification for focused commands/scenarios, targets, and evidence>
Coordination: Shared checkout. Preserve existing changes. Do not spawn agents,
commit, push, change dependencies without explicit approved scope, or edit outside scope. Report blockers and
needed cross-boundary changes to the dispatcher.
Return: Changed files, behavior delivered, acceptance-linked verification evidence,
remaining risks/blockers, and integration notes. Distinguish observations from
assumptions; do not claim checks you did not perform.
```

Launch independent tasks together. While agents work, inspect context, review
contracts, and maintain the task list without duplicating their assignments.
Delegate integration, documentation, and runtime checks with exclusive ownership.
When blocked, obtain their current result before reassigning files; never start
a replacement writer while the original may still edit them.

## 4. Integrate and verify

Read worker reports and inspect the actual scoped changes, including new files.
Check both sides of each contract and assign cross-boundary wiring to a worker. Track
partial work as incomplete until integrated and verified. Resolve failures with
the responsible owner or hand ownership to another worker after that writer
finishes. The read-only dispatcher never takes write ownership itself.

The dispatcher coordinates tests, migrations, fixture setup, server changes,
dependency installs, and browser sessions to avoid shared-state collisions.
Workers may run non-mutating scoped checks; give shared-state checks one owner
at a time. Browser reviewers use distinct named sessions and artifact paths,
and close only their own sessions. Run database-mutating verification only
against isolated test data, never the main campaign database. The existing API
runner shares `dndharness_test`, so serialize all suite invocations. Fresh browser
profiles do not isolate persistent writes; use `verification` for target safety.

Load `verification` to select integrated checks and inspect acceptance-linked
worker evidence. Reuse evidence still applicable; delegate only checks needed for
wiring, subsequent edits, failures, or unresolved concerns. Delegate failures with
`regression-debugging`; the dispatcher never executes diagnostics or fixes itself.

## 5. Independent review and completion

For a nontrivial dispatched feature, use one `app-reviewer` pass after integration
when available. Supply acceptance criteria, the exact changed-file scope,
pre-existing-change context, shared contracts, and verification evidence. For
harness changes, explicitly ask for delegation/permission/configuration and
documentation consistency instead of application-specific checks. The reviewer
does not edit or reproduce runtime checks; the dispatcher assigns reproduction
and fixes to workers and inspects the resulting evidence.

Assign material findings and affected checks to workers, inspect their resolution, and use a focused follow-up
only if an unresolved finding warrants it. If no independent reviewer is
available, self-review and disclose it. Summarize the delivered behavior,
workstreams used, checks actually performed, and remaining gaps. Do not equate
agent agreement with correctness. Commits, pushes, and PRs need user instruction.
