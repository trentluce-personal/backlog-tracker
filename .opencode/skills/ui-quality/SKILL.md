---
name: ui-quality
description: Use when implementing or reviewing UI controls, forms, dialogs, navigation, responsive layouts, themes, or animation quality. Apply the approved design guide and focused accessibility/UX checks alongside frontend-review.
---

# UI quality

Read `AGENTS.md`, `docs/design.md`, and the affected UI. Preserve the user's
approved visual direction. This skill defines review criteria; load
`frontend-review` for browser execution. Do not install a design system, browser
engine, accessibility package, or framework simply to follow these instructions.

## Scope the pass

Identify the user's task and the controls/states that changed. Reuse existing
components and tokens. Review the relevant items below, not the whole app for
every small edit. Classify observations as functional bugs, accessibility/UX
issues, or optional polish. Ground findings in code or reproduced behavior.

## Controls and accessibility

- Prefer semantic HTML. Buttons activate actions; links navigate to URLs.
  Native buttons already handle keyboard activation: do not add duplicate clicks.
- Inputs have visible, programmatically associated labels. Icon buttons have
  meaningful accessible names; decorative icons are hidden from assistive tech.
- Verify keyboard Tab/Shift+Tab, Enter/Space, visible focus, and focus restoration.
  No heavy pointer focus ring is required, but keyboard focus must remain visible.
- For custom comboboxes, inspect W3C's select-only pattern: distinguish active
  option from committed value, preserve value on Escape, expose expanded/selected
  state, and keep `aria-activedescendant` valid. Test Home/End/arrows and typeahead.
- For dialogs, check initial focus, containment, Escape, close action, and return
  focus. Ensure overflow/zoom doesn't hide the title, focused field, or action.
- Check touch target size/spacing, contrast in both themes, labels/status beyond
  color, heading order, and access to main content. Measure contrast when unsure;
  don't infer a numeric accessibility pass from screenshots.

## Forms and async states

- Meaningful input types, names, autocomplete, lengths, and numeric bounds.
  Associate hints/errors with `aria-describedby` when appropriate; mark invalid
  fields and focus the first actionable error. Never block password paste.
- Exercise validation, API failure, loading, empty data, and success where affected.
  Preserve drafts on failure and prevent duplicate requests while pending.
- Announce async results without stealing focus. Avoid stale success messages.
  Keep busy status intelligible; don't make an animated spinner the only feedback.
- For navigation or dismissal during editing, identify what happens to unsaved
  data. Warn or preserve meaningful drafts where loss would surprise the user.
- Confirm destructive changes or provide a real undo path. A restore explanation
  must match what the API actually replaces and what it preserves.

## Layout and visual consistency

- Inspect desktop/mobile and both themes for changed styling. Check small/large
  user names, titles, descriptions, empty lists, long errors, and 200% zoom when
  layout risk justifies it. Test touch behavior with emulation when relevant.
- Use the design guide's token/component vocabulary, adequate line lengths,
  legible text, sensible visual hierarchy, and stable loading layouts.
- Menus/overlays must fit the viewport, layer above their surroundings, and not
  cover focused content. Fix the source of overflow rather than hiding the page.
- Meaningful navigation should support reload/back/deep links when required.
  Do not add a router or URL-state dependency for unrelated cosmetic work.

## Motion

- Verify real pointer/keyboard feedback, not just animation declarations.
  Inspect a relevant intermediate state and completed state for motion changes.
- Test the system reduced-motion default AND the saved app motion override;
  use **Enable animations / Motion on** rather than assuming media emulation wins.
- Actions remain immediate; effects clean up, rapid activation remains usable,
  and animation doesn't change accessible names or cause layout jumps.
- Prefer transforms/opacity, explicit transitions, and graceful feature detection.
  Investigate observed jank with traces. Do not claim frame-rate or perceptual
  smoothness based on a still image or successful build.

## Evidence and finish

Use `verification` for applicable checks and acceptance-linked evidence, and
`frontend-review` for browser execution. Use `regression-debugging` for failures.
Don't call a scan a full accessibility audit or emulation a real-device test.

If reviewing only, report concise findings as:
`severity — path:line — observed issue — user impact — suggested correction`.
Keep optional aesthetic suggestions separate from defects. If there are no
actionable findings, say so and identify the checks and remaining gaps.

## Primary references

Consult the relevant pattern when implementing a custom widget; these are source
references, not instructions to apply every external convention verbatim.

- https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
- https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- https://github.com/vercel-labs/web-interface-guidelines
- https://playwright.dev/docs/accessibility-testing
- https://web.dev/articles/animations-guide
