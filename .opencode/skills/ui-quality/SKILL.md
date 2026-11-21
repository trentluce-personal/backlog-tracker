---
name: ui-quality
description: Use when implementing or reviewing UI controls, forms, dialogs, navigation, responsive layouts, themes, or animation quality. Apply the approved design guide and focused accessibility/UX checks alongside frontend-review.
---

# UI quality

Read `AGENTS.md`, `docs/design.md`, and the affected UI. Preserve the established
Forge visual direction. Every implementation worker handling appearance or
interaction must load and apply both this skill and `frontend-review`; loading them
only in a dispatcher or reviewer does not guide the implementer. This skill defines
quality criteria, while `frontend-review` owns browser mechanics and evidence. Do
not install a design system, browser engine, accessibility package, or framework
simply to follow these instructions.

## Scope and implementation loop

1. Identify the user's task, changed controls/states, and applicable risks. When
   relevant, inspect an adjacent existing or approved reference screen before
   implementation and derive observable conventions from it. Reuse existing
   components and tokens; classify findings as functional bugs, accessibility/UX
   issues, or optional polish rather than imposing taste.
2. Implement the smallest consistent change. Run the real app and iterate through
   `frontend-review`: DOM snapshots for interaction, screenshots actually read as
   images for appearance, applicable desktop/mobile sizes and both themes,
   keyboard/focus behavior, and console/failed requests.
3. Repair observed issues and repeat the affected scenarios before completion. A
   successful build, saved-but-unviewed screenshot, or DOM snapshot alone is not
   visual verification. Scale unrelated checks away for text-only/low-risk edits,
   but disclose exactly what was not exercised or viewed.
4. A static/read-only reviewer evaluates supplied evidence without claiming it as
   personal execution; the implementation worker still owns this running repair
   loop. If browser mutation or image inspection is blocked, report the limitation.

## Controls and accessibility

- Prefer semantic HTML. Buttons activate actions; links navigate to URLs. Native
  buttons already handle keyboard activation: do not add duplicate clicks.
- Inputs have visible, programmatically associated labels. Icon buttons have
  meaningful accessible names; decorative icons are hidden from assistive tech.
- Verify Tab/Shift+Tab, Enter/Space, visible focus, and focus restoration. No heavy
  pointer focus ring is required, but keyboard focus must remain visible. Retain
  the skip link and access to the main workspace.
- For custom comboboxes, inspect W3C's select-only pattern: distinguish active
  option from committed value, preserve value on Escape, expose expanded/selected
  state, and keep `aria-activedescendant` valid. Test Home/End/arrows and typeahead.
  Use a native select instead when it satisfies the need.
- For dialogs, check initial focus, containment, Escape, close action, and return
  focus. Ensure overflow/zoom does not hide the title, focused field, or action.
- Check touch target size/spacing, contrast in both themes, labels/status beyond
  color, heading order, and access to main content. Measure contrast when unsure;
  do not infer a numeric accessibility pass from screenshots.

## Forms and async states

- Use meaningful input types, names, autocomplete, lengths, and numeric bounds.
  Associate hints/errors with `aria-describedby` when appropriate; mark invalid
  fields and focus the first actionable error. Never block password paste.
- Exercise validation, API failure, loading, empty data, and success where affected.
  Preserve drafts on failure and prevent duplicate requests while pending.
- Announce async results without stealing focus. Avoid stale success messages.
  Keep busy status intelligible; do not make an animated spinner the only feedback.
- For navigation or dismissal during editing, identify what happens to unsaved
  data. Warn or preserve meaningful drafts where loss would surprise the user.
- Confirm destructive changes or provide a real undo path. Project deletion must
  communicate task cascade; model conflict/failure messaging must match what is
  actually retained and what action safely retries or reloads.

## Layout and visual consistency

- Inspect desktop/mobile and both themes for changed styling. Check small/large
  user names, titles, descriptions, empty lists, long errors, and 200% zoom when
  layout risk justifies it. Test touch behavior with emulation when relevant.
- Use the design guide's token/component vocabulary, established type hierarchy,
  restrained elevation, and stable loading layouts. Preserve the Backlog page flow
  versus the viewport-bound modeling/ERD workspaces.
- Menus/overlays must fit the viewport, layer above their surroundings, and not
  cover focused content. Fix the source of overflow rather than hiding the page.
- Preserve readable long user-authored content with wrapping/truncation patterns
  already established for its context; do not silently discard descriptions.
- Meaningful navigation should support reload/back/deep links when required. Do
  not add a router or URL-state dependency for unrelated cosmetic work.

## Motion

- Verify real pointer/keyboard feedback, not just animation declarations. Inspect
  a relevant intermediate state and completed state for motion changes.
- The app's defaults intentionally do not follow OS preferences: dark theme and
  full motion are the missing/invalid-preference defaults. Check this documented
  independence when emulating OS reduced motion, and separately exercise the saved
  app override through **Motion on — reduce motion** / **Enable animations**.
  Media emulation alone does not set `backlog-motion`.
- Actions remain immediate; effects clean up, rapid activation remains usable,
  and animation does not change accessible names or cause layout jumps. Reduced
  app motion switches themes directly and suppresses ornamental ripples.
- Preserve the existing theme reveal's two distinct directions and graceful feature
  detection rather than replacing it with generic fades or repeated pulses.
  Investigate observed jank with traces. Do not claim frame-rate or perceptual
  smoothness based on a still image or successful build.

## Evidence and finish

Use `verification` for applicable checks and acceptance-linked evidence and
`frontend-review` for execution. Use `regression-debugging` for failures. Report
the reference, actual scenarios, screenshots viewed, repairs/rechecks,
and limitations. Do not call a scan a full accessibility audit or emulation a
real-device test.

If reviewing only, report concise findings as:
`severity — path:line — observed issue — user impact — suggested correction`.
Keep optional aesthetic suggestions separate from defects. If there are no
actionable findings, say so and identify checks and remaining gaps.

## Primary references

Consult the relevant pattern when implementing a custom widget; these are source
references, not instructions to apply every external convention verbatim.

- https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
- https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- https://github.com/vercel-labs/web-interface-guidelines
- https://playwright.dev/docs/accessibility-testing
- https://web.dev/articles/animations-guide
