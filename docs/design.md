# The Forge design guide

This is the canonical UI reference for backlog-tracker. It records the established
direction in the current React/CSS implementation and README; it is not a redesign.
Preserve existing user work and verify uncertain current behavior in source and,
when relevant, an approved running reference before changing it.

Primary sources are [README.md](../README.md), [AGENTS.md](../AGENTS.md),
[styles.css](../apps/web/src/styles.css), and the component files named below.

## Visual direction

**The Forge** is a quiet, local personal workspace for projects and next steps, with
graph and ERD modeling workspaces alongside the Backlog. Its identity combines
steel-gray structure with warm forge-orange accents from the anvil/gear logo. The
result is compact and workmanlike rather than glossy: crisp borders, restrained
shadows, small dense type, generous dark/light neutral fields, and orange reserved
for identity, primary action, selection, and focus.

The two broad workspace types deliberately differ:

- **Backlog** is a readable page flow: branded sidebar, project/task summary,
  search/filter toolbar, three status columns, cards, and a footer. Supportive empty
  states and concise feedback soften the utilitarian structure.
- **Data Modeling and ERD** are denser, viewport-bound tools: compact headers and
  toolstrips, a pan/zoom canvas, and side sheets/panels for stored models and details.
  They reuse the same palette and controls without forcing the Backlog's card grid
  or page scrolling onto a canvas.

Do not replace this with a different brand, typography system, color scheme,
component library, or arbitrary spacing scale. Extend the nearest existing pattern.

## Existing layout and component map

| Area | Established pieces | Implementation reference |
| --- | --- | --- |
| Application shell/navigation | `.app-shell`, sticky `.sidebar`, `.brand`, `.nav-item`, collapsible 72 px navigation, skip link, appearance controls | [App.tsx](../apps/web/src/App.tsx), [styles.css](../apps/web/src/styles.css) |
| Backlog | `.workspace`, `.workspace-header`, `.workspace-summary`, `.toolbar`, `.board`, `.column`, `.task-card`, `.state-panel`, `.workspace-footer` | [App.tsx](../apps/web/src/App.tsx), [TaskBoard.tsx](../apps/web/src/components/TaskBoard.tsx), [styles.css](../apps/web/src/styles.css) |
| Shared forms/dialogs | Native `dialog` with `.dialog`, `.dialog-heading`, labeled fields, `.dialog-actions`, `.form-error`, destructive confirmation | [Dialog.tsx](../apps/web/src/components/Dialog.tsx), [Forms.tsx](../apps/web/src/components/Forms.tsx) |
| Buttons/icons/feedback | `.button`, `.primary`, `.secondary`, `.text-button`, `.icon-button`, `.danger`, `.danger-text`, `.announcement`, `.error-banner` | [styles.css](../apps/web/src/styles.css), [Icon.tsx](../apps/web/src/components/Icon.tsx) |
| Data Modeling | `.modeling`, `.modeling-stage`, graph canvas and grid, node/edge focus styles, model browser, details sheet, schema panels | [DataModeling.tsx](../apps/web/src/components/DataModeling.tsx), [DataModeling.css](../apps/web/src/components/DataModeling.css), [Models.css](../apps/web/src/components/Models.css) |
| ERD | `.erd-designer`, toolbar/toolstrip, table canvas, viewport controls, docked panels and inline editors | [erd.css](../apps/web/src/components/erd/erd.css), [ErDesigner.tsx](../apps/web/src/components/erd/ErDesigner.tsx) |

Before a nontrivial UI change, inspect the nearest relevant screen or an approved
reference artifact. Reuse its control composition, status feedback, spacing, and
responsive behavior; treat the reference as evidence, not permission to copy private
content into artifacts.

## Color system

Root custom properties in `styles.css` are the shared palette. Use the semantic
variable rather than new hex values in component CSS. If a genuinely new token is
needed, define its dark and light values together and check both themes. Existing
component-scoped variables are appropriate for canvas-specific behavior.

### Core neutrals and Forge accent

| Token | Dark | Light | Established role |
| --- | --- | --- | --- |
| `--background` | `#10121b` | `#f1f2f3` | Main page/workspace field |
| `--surface` | `#22252e` | `#ffffff` | Cards, dialogs, toolbars, elevated panels |
| `--sidebar` | `#171922` | `#e8eaed` | Navigation rail |
| `--control` | `#2b2e38` | `#f1f2f4` | Inputs, selects, secondary hover/control fields |
| `--column` | `#1a1d26` | `#e4e6e9` | Board columns and canvas-adjacent regions |
| `--text` | `#f1f1f2` | `#22252c` | Primary text |
| `--muted` | `#b7bac2` | `#565c66` | Secondary text and quiet icons |
| `--accent` | `#ff9a42` | `#a84208` | Forge-orange action, selection, focus |
| `--accent-hover` | `#ffb36b` | `#883504` | Primary/text accent hover |
| `--accent-active` | `#f18026` | `#702b03` | Primary pressed state |
| `--on-accent` | `#21130b` | `#ffffff` | Text/icons on primary accent fill |
| `--selected` | `#3c2b23` | `#fbe9dc` | Accent-tinted selected/navigation background |
| `--line` | `#40434d` | `#cdd0d5` | Dividers and ordinary surface borders |
| `--control-border` | `#858994` | `#777d87` | Interactive field/dialog outlines |
| `--badge` | `#32353f` | `#d9dce1` | Counts and quiet icon-button hover |

Dark and light palettes retain the same structure; they are not separate layouts.
The root also sets the matching `color-scheme`, native `accent-color`, option colors,
initial background, and browser theme color.

### Status, feedback, and overlays

| Token group | Dark values | Light values | Use |
| --- | --- | --- | --- |
| Status | `--status: #8db9c9`; `--backlog-status: #b7bac2` | `#356b7d`; `#686e78` | Progress, graph links, completed/status indication |
| Priority/project dots | `--dot-purple: #c1a8ca`; `--dot-gold: #edc478`; `--dot-blue: #8db9c9` | `#795c85`; `#79550e`; `#356b7d` | Existing repeated project/status distinctions |
| Warning | `--warning: #edc478`; `--warning-bg: #3d3321` | `#79550e`; `#f9edcf` | In-progress and medium-priority treatment |
| Error | `--error: #ffb5a6`; `--error-bg: #402a29`; `--error-border: #a7695f` | `#a02e24`; `#fce9e5`; `#bb756c` | Validation, API errors, overdue/high-priority treatment |
| Danger | `--danger: #ffb5a6`; `--danger-hover: #ffc9bd`; `--on-danger: #3c1715` | `#a02e24`; `#81241c`; `#ffffff` | Confirmed destructive primary action |
| Elevation | `--shadow: #00000026`; `--dialog-shadow: #00000066`; `--backdrop: #080a10b3` | `#1519230c`; `#15192340`; `#15192380` | Small card/control shadow, modal shadow, modal backdrop |

These semantic colors already have jobs. Do not turn warnings, errors, or every
interactive surface orange. Status must also remain understandable through text,
shape, position, or an accessible name rather than color alone.

Data Modeling has an intentional domain palette scoped to `.modeling` for
classification fills (`--modeling-transactional`, `--modeling-master`,
`--modeling-reference`, `--modeling-metadata`, and internal/external references),
plus `--node-fill`, `--node-text`, and `--node-outline`. Preserve those semantic
classifications instead of substituting the global Forge accent. Draft and solid
outlines have theme-specific values in `DataModeling.css`; canvas grid, selection,
and focus continue to use shared tokens.

## Typography, icons, shape, and density

- The application stack is `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
  The brand wordmark alone uses Georgia serif; its small “The” is orange italic.
  Do not introduce a font dependency.
- Backlog's `h1` is `clamp(26px, 2.5vw, 34px)`, weight 650, with tight tracking and
  wrapping for long project names. Dialog headings are 22 px; dense section/card
  labels generally range from 10–14 px. Uppercase orange eyebrows use wide letter
  spacing. Follow the nearest existing hierarchy rather than enlarging everything.
- Use the existing `lucide-react` icons through `Icon`: default 18 px, stroke 1.75,
  `aria-hidden` and unfocusable because the surrounding control supplies the name.
  Some compact text/status icons are 14 px. The logo is `/forge-logo.svg`.
  Icon-only buttons need explicit accessible names and, where established, titles.
- Controls inherit the application font. Shared controls use a 7 px radius; common
  surfaces use 8–10 px (cards, toolbar, columns), dialogs 14 px, and the theme toggle
  a 22 px pill. Borders are normally 1 px. Elevation stays subtle except for dialogs.
- Spacing is density-dependent, not a new universal grid. Copy the adjacent header,
  panel, field, and card spacing. Use flexible gaps and `min-width: 0` within grid/flex
  children. Long names and errors use the existing anywhere-wrapping or local
  ellipsis/title pattern rather than forcing layout width.
- Forty-four-pixel targets recur for close/icon actions, dialogs, appearance controls,
  and modeling tools; the baseline `.button` is 41 px and dense board controls are
  smaller. Preserve equivalent local sizing and inspect touch risk rather than
  applying a blanket resize that breaks an established dense layout.

## Controls and interaction conventions

- **Primary buttons** use `--accent`/`--on-accent` and a small shadow; secondary
  buttons use surface fill with `--control-border` and move to `--control` on hover.
  Text buttons are orange, borderless, and underline on hover. Destructive text and
  confirmed danger buttons are distinct from ordinary primary actions.
- Disabled controls retain their native semantics and become quiet through opacity;
  buttons use `not-allowed`. Pending work also needs a textual or exposed busy state,
  not appearance alone. Prevent duplicate submissions and preserve drafts on error.
- Inputs/selects/textareas use `--control`, `--text`, and `--control-border`; labels
  remain visible and associated. Optional hints and validation errors reuse existing
  `.label-hint`, `.form-error`, and alert patterns. Placeholder text never replaces
  a label.
- The global keyboard focus indicator is a 3 px accent outline with 3 px offset.
  Dense canvases/panels sometimes use a local 2 px/inset treatment so it remains
  visible without clipping. Do not remove it. The “Skip to workspace” link becomes
  visible on focus.
- Use native buttons for actions and native selects where they meet the need. Keep
  pointer and keyboard activation equivalent, without duplicate synthetic clicks.
- Shared dialogs use `Dialog.tsx`: native modal semantics, labelled title, intentional
  initial focus, Tab containment, Escape/close handling, dirty-change confirmation,
  disabled dismissal while busy, and focus restoration. Reuse it instead of creating
  a visually similar overlay without those behaviors.
- Notices use the existing live `.announcement`; actionable failures use
  `.error-banner`, `.form-error`, or the local panel error pattern. Do not steal focus
  for ordinary success. Deleting a project must retain explicit cascade confirmation.
- Empty/loading/error states use `.state-panel`, existing symbols, short headings,
  and relevant recovery actions. Loading and resolving states should avoid large
  layout jumps and should not erase meaningful user input.

## Responsive conventions

The Backlog has a 320 px minimum body width and a centered `.workspace` capped at
1700 px. Its standard shell columns are 248 px plus a flexible main region; the main
padding begins at 46 px 42 px and increases slightly above 1450 px.

Existing breakpoints are behavioral references, not a request to rewrite them:

- **At 1150 px and below:** the sidebar narrows to 210 px, main gutters contract,
  board gaps tighten, and search takes a full toolbar row above three filters.
- **At 850 px and below:** the shell uses a 180 px sidebar, the header stacks, board
  columns become one outer column, and each column's task list can use two cards per
  row. Collapsed navigation uses the existing icon-only 72 px pattern.
- **At 600 px and below:** the shell becomes a vertical flow with static navigation,
  project items condense, full-width header actions and single-card task lists apply,
  dialogs reduce padding, and form grids/actions wrap as already defined.
- **Modeling/ERD have their own constraints.** Modeling sheets become native modal
  top-layer panels at 800 px and its header/tools adapt at 600 px. ERD stacks its
  stage and dock at 700 px and limits the dock's height. Preserve `100dvh`, internal
  overflow, focused-control reachability, and canvas minima rather than making these
  workspaces inherit Backlog page scrolling.

Choose verification widths around the CSS actually changed. Desktop/mobile checks
commonly use 1280×900 and 390×844; add an intermediate size when a 600/700/800/850/
1150 px transition or a container query affects the work. Test zoom and long content
when the change creates that risk.

## Theme and motion behavior

Theme and motion are application preferences, not OS-mirroring switches:

- Missing or invalid storage defaults to **dark** and **full motion**, independently
  of OS dark-mode or reduced-motion settings. Keys are `backlog-theme` (`dark` or
  `light`) and `backlog-motion` (`full` or `reduce`). Storage failure still leaves
  controls working for the current page.
- The inline bootstrap applies both preferences before styles/React load. Theme
  changes update `data-theme`, native `color-scheme`, and the browser theme color.
  The visible **Light / Dark** button names the next theme and exposes that action
  with `Switch to light/dark mode` for assistive technology.
- **Motion on — reduce motion** saves reduced motion; **Enable animations** restores
  full motion. Reduced app motion switches themes directly and suppresses ornamental
  ripples. OS reduced-motion emulation does not replace testing this app control.
- Full motion includes 160 ms control color/transform transitions, a small primary
  button press scale, and a 580 ms ripple from the pointer contact point (or keyboard
  activation point) on `.button`, `.icon-button`, and `.nav-item`. Effects are hidden
  from assistive technology and cleaned up when cancelled or removed.
- Supported browsers reveal a new palette from the theme button's center using one
  sweep over an inert old-palette copy while the live page remains interactive.
  Light→dark is a 2,200 ms charcoal/inky shadow with broad irregular penumbra;
  dark→light is a 1,800 ms ivory/champagne bloom with soft halos and restrained rays.
  These are intentionally different directions, not generic repeated pulses.
- A new pointer/keyboard action or resize skips the reveal. Unsupported animated
  custom properties, masks, or animation APIs fall back to an immediate palette
  switch. Effects must not submit forms, block controls, duplicate accessible content,
  or leave an overlay behind. Clear the `backlog-motion` key to restore the default.

## UI copy and content

Follow the root preference exactly: **avoid unrequested descriptive or helper UI
prose, especially in panels. Concise labels and actions suffice.** Do not add
marketing paragraphs, explanations of obvious controls, or decorative panel copy.

Preserve user-authored project names, task titles/descriptions, model names, and
property descriptions. Preserve validation errors, destructive consequences,
required status announcements, and accessibility names/descriptions. Existing
Backlog terminology is **Backlog**, **In Progress**, and **Done**; priorities are
low/medium/high and due dates are optional. Avoid hiding or rewriting user content
merely to make a panel tidier.

## Delivery and visual verification

For relevant appearance or interaction work, apply `ui-quality` and
`frontend-review` in the implementation worker's own context:

1. Inspect the adjacent/approved reference, implement with the pieces above, and run
   the actual app with `npm run dev` (or the appropriate built app).
2. Before mutations, follow README's isolated browser environment: fresh temporary
   SQLite/model directory and alternate ports. A fresh browser profile alone is not
   persistent-data isolation.
3. Use only the pinned CLI through `npm run browser --`. Use fresh DOM snapshots for
   interaction and screenshots **read as images** for appearance; snapshots alone
   cannot verify visuals. Keep screenshots/traces in ignored `artifacts/` or
   `.playwright-cli/`.
4. Exercise changed controls at applicable desktop/mobile sizes and in both themes.
   Check keyboard/focus behavior, pointer interaction, console errors, and failed
   requests; add affected states and motion checks where relevant.
5. Repair observed issues and recheck the failed scenario plus affected visual and
   interaction states before reporting completion. A successful build, a saved but
   unviewed screenshot, or a DOM snapshot alone is not visual verification.

Scale this to risk: non-UI text/config work may need only static checks, and a small
copy edit may need a focused rendering rather than every application state. Never
invent broad evidence that was not collected; report skipped runtime, viewport,
theme, image, or real-device coverage explicitly.
