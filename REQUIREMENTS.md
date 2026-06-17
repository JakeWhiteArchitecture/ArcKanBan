# ArcKanban — Requirements

*Arc + Kanban — the arc of a job traced across the RIBA Plan of Work.*

**A project tracker for a sole-trader architectural practice.** Every job moves through the eight RIBA stages; each stage holds its own small Kanban. New projects are laid out instantly from a template. Local-first, single-file database, no cloud.

**Status:** v0.9 specification. A v0.1 prototype (Flask + SQLite) is referenced as the foundation but is **not present in this repository** — see *Repository state* below. This document specifies the build from that foundation forward.

> **Revision note (v0.9):** status changes now log uniformly as *"JW set "X" to "Status""*; a Done→undone **round‑trip within 10 minutes auto‑omits both** log entries (events gained a `task_id`); and the background is now a gentle **animated** drifting/pulsing glow. Still queued: the **email generator** (compose box + task table + `.eml` + JSON) and **redo**. Full deltas in §11.

> **Revision note (v0.8):** the board is now **Status‑only** (the Sections/Status toggle is removed; the swimlane layout is retired from the UI). The **RIBA spine is centred on the page** with the **focused stage's name beneath it**, and a **star** to its right marks and sets the current stage (filled = current; click to set) — replacing the "you are here" tag and "Current stage" badge. **Hide‑done** now hides done *cards* but keeps the Done **column** as a drop target. Full deltas in §11.

> **Revision note (v0.7):** stable external **`uid`s** (UUIDs) on projects/sections/tasks — the foundation for the share loop and `.md` linking (avoids integer-id collision/reuse across databases & backups); **per-project RIBA-stage scope** so stages outside the appointment can be disabled (greyed in the spine, skipped in paging); and **Phase 7 — Share & collaborate** specified (`.eml` export/import + role-scoped viewer). Full deltas in §11.

> **Revision note (v0.6):** adds an **activity log** — a persisted `events` table rendered as a right-hand **narrative drawer** (person → action → task/section, with date & time; e.g. *“JW completed ‘Measured survey’ · 15 Jun 2026 · 14:32”*), structured for future local `.md` export; **undo** of the last action via right-click on empty space; and a fix so the drag **slide (FLIP) animation** runs reliably. Full deltas in §11.

> **Revision note (v0.5):** the section view is now a **toggle** (titleblock) between two renderings of the same data — **Sections** (swimlanes, section-primary) and **Status** (status-primary columns with section *bubbles*). In the Status view, dragging a card to another column changes status and **auto-regroups it into its section's bubble** (never dumped loose); **clicking a card links its section across columns** (highlight + dim); section is reassigned via the **chip bar** (select a card, click a section chip). A status-drag never changes section. Full deltas in §11.

> **Revision note (v0.4):** adds **sections of work** — an optional grouping between stage and task (**Stage → Section → Task → child**). Sections render as **glass swimlanes** stacked within a stage (pan = stages, scroll = sections, columns = status); loose tasks live in an always-present **"General"** lane. **Drag is implemented**: a task can be dragged to any **section × status cell within its stage** (never across stages) and reordered — persisting `status`, `section_id`, `position`; the ‹ › steppers stay as the click/touch fallback. New `sections` table + `tasks.section_id`. Full deltas in §11.

> **Revision note (v0.3):** the board is now a **dark, glassy, floating-frame** UI on deep navy — the drawing-office instrument identity (titleblock, spine, mono register, redline/ochre/sage semantics) rendered in glass. Stages are **paged horizontally** (one stage's four-column Kanban fills the screen; flip with arrows / the spine / a swipe / the ←→ keys) rather than stacked in a vertical accordion. The top **spine carries the RIBA Plan of Work stage colours** (0→7). This reverses the earlier light "paper" palette. Full deltas in §11.

> **Revision note (v0.2 → from v0.1):** un-nesting now returns a child to the **parent's column** (not always To Do); deleting a parent **prompts** (delete children vs explode out); the **Urgent column is removed** and urgency becomes an independent **flag**, leaving four status columns; type is **editable** with a statutory-downgrade warning; the stage spine **no longer sets the current stage on click** (navigation only) — a new **stage-advancement nudge** offers it instead; `position` scope and the migration set are pinned down; the design language (§5) is expanded. Full deltas in §11.

> **Repository state:** This repo currently contains no prototype code. The "DONE / proven / (Met.)" claims below describe a prototype that lived outside this repository and could not be verified here. Treat **Phase 1 as work to (re)establish in this repo** before Phases 2–5 — either import the prototype or scaffold it fresh against §6/§7.

---

## 1. Purpose

A sole practitioner has no PM looking over the work. The tool's one job is to answer, at a glance: *where is this job, what's on fire, what's blocked, and what's still owed* — across both **client deliverables** and **statutory duties** (planning, Building Regs, CDM, the Building Regulations Principal Designer role). It is admin infrastructure, not a hobby. It must be faster to use than a notebook or it has failed.

Guiding constraints:

- **Local and sovereign.** Runs on the practitioner's own machine. One SQLite file, easy to snapshot and back up. No cloud dependency, no external runtime calls, no telemetry.
- **No build step.** Plain Flask + Jinja + vanilla JS. Any third-party JS is vendored locally (no CDN at runtime).
- **Refined, not decorative.** The design is a first-class requirement — see §5. It should read as a drawing-office instrument, not a generic SaaS board.

---

## 2. Core concept (and one thing it deliberately is *not*)

The board **pages horizontally through the eight RIBA stages** — one stage fills the screen, and you flip between stages with floating arrows, the spine, a swipe, or the ←/→ keys. A horizontal **stage spine** across the top, coloured by the RIBA Plan of Work, marks where the job currently sits and doubles as navigation.

Within a stage, tasks group into optional **sections of work** (§3.11) — glass swimlanes you scroll through; each section's tasks still flow across the four status columns (§3.4). So the board reads on three axes: **pan = stages, scroll = sections, columns = status**, with the hierarchy **Stage → Section → Task → child**.

It is **not** a single board where cards are dragged *between* RIBA stages. A Stage 3 task does not become a Stage 4 task — tasks don't migrate across the Plan of Work, so that interaction was rejected as the wrong metaphor. Movement happens *within* a stage, along the status columns. This decision is recorded here so it isn't relitigated.

Templates do the structural work: a template is a set of stages each with a standard task list, and creating a project from one pre-fills every task. Author once, reuse on every job of that type.

---

## 3. Functional requirements

### 3.1 Projects
- Create a project with a **job number** (four-digit convention, free text) and **name**.
- **Edit** a project's job number and name after creation.
- A project records its **current RIBA stage** (the "you are here" pointer).
- Projects are listed on the home register, **newest first** (`ORDER BY id DESC` — avoids relying on text-date sorting), each showing job no., name, a mini stage spine, and current stage.
- **Project-level management lives on the register** (not the board's ⋯ menu): each project card carries **Delete** (with confirmation; explicit route cascade + `PRAGMA foreign_keys = ON`, so it cannot silently no-op) and a **Scope** popover. The board's ⋯ More menu now holds only the export actions (Save as template, Export full log).
- **Stable URLs:** page URLs address a project by its short random-hex **`uid`** (6 hex chars, e.g. `/projects/30fa25`), not the reusable integer id — so a link survives a project being deleted and another created (the int id could be reused). The uid is assigned with a uniqueness check (retried on the rare clash), so the short length never collides. Internal API calls still use the id (not user-visible); sections/tasks keep a long uid for the share/merge loop.
- A project has an **appointment scope** — the subset of RIBA stages it covers. Out-of-scope stages are **disabled**: greyed in the spine, skipped by paging, and shown as an "outside the appointment scope" placeholder (their tasks are retained, just hidden, until re-enabled). The **current stage always stays in scope**. Default: all eight. Edited via the **Scope** popover on the register card (`projects.stages` — CSV of enabled indices; NULL = all); a disabled-stage placeholder on the board still offers a one-click "Add to scope".

### 3.2 Templates
- Templates are plain **JSON files** in `templates_lib/`, discovered automatically and offered in the new-project picker.
- Each template has a display `name` and a list of tasks: `{ "stage": <0-7>, "title": <str>, "type": <client|statutory|admin> }`.
- Creating a project from a template copies its tasks in (all as *To Do*, all *not urgent*), assigning `position` by **array order within each stage/column**. A broken template file must not crash the app — **fail soft**: skip the unreadable file, flash a notice, still offer the rest.
- A "Blank" option creates a project with no tasks.
- **Upload a template** — the picker offers "⬆ Upload a template…": choose a JSON you saved earlier (via *Save as template*), name it in a popup, and it's **sanitised and stored in `templates_lib/`** (slugged filename, de-duplicated) so it's offered on every future project. Validated client- and server-side (must contain valid tasks); the name is the only thing the popup asks for.
- Ships with at least one authored template: **Residential Extension** (see Appendix A).

### 3.3 RIBA stages
The eight stages of the RIBA Plan of Work 2020, fixed:

| # | Stage |
|---|-------|
| 0 | Strategic Definition |
| 1 | Preparation and Briefing |
| 2 | Concept Design |
| 3 | Spatial Coordination |
| 4 | Technical Design |
| 5 | Manufacturing and Construction |
| 6 | Handover |
| 7 | Use |

### 3.4 Tasks, statuses, and the urgent flag
- A task belongs to one project and one stage, and carries a **title**, a **type**, a **status**, an **urgent flag**, an optional **awaiting-on** note, a **position** (sort order), and an optional **parent** (see §3.7).
- **Title** is editable inline.
- **Category** in {**statutory · recommended · process · decision**}. It encodes the nature of the task and drives the card's left‑margin colour (§5): **statutory** = legal teeth (planning, Building Regs, party wall, CDM — redline, unmistakable), **recommended** (blue), **process** (violet), **decision** (ochre). A **decision** task carries a **responsible person** (who must decide) — shown on the card in **any** column (the same field/mechanism as the Awaiting "who/what", reused), and a decision can sit in any status. *(Replaces the old client/statutory/admin; migration maps client→recommended, admin→process.)*
  - Type is **editable**, but changing a task **away from `statutory`** (statutory → client/admin) requires a **confirmation warning** — you are removing a legal-duty marker. Promoting *to* statutory is silent (it only adds rigour).
- **Status** is one of **four** columns, left to right:

  | Status | Meaning |
  |--------|---------|
  | **Backlog** | The long tail — not soon; keeps "Upcoming" from scrolling forever |
  | **Upcoming** | Coming up — queued for soon in this stage |
  | **To Do** | Actionable now, on the list |
  | **Awaiting** | Blocked on a third party (client sign-off, planning officer, Building Control, consultant) |
  | **Done** | Complete |

  *Awaiting* is the quiet workhorse: so much architectural work stalls on someone else's desk, and giving "blocked on others" its own column surfaces it at a glance. **Status is not a linear pipeline** — tasks move freely in any direction (To Do ↔ Awaiting, back out of Done, round and round) until they settle in Done.

- **Urgent is a flag, not a column** — an independent boolean on the card, orthogonal to status. This is the change from v0.1: a task can now be **Awaiting *and* urgent** (blocked *and* on fire — the single most important quadrant for triage), which the old urgent-column model could not express. Urgent renders in **redline** (§5) and is toggled on the card.
- **Awaiting — who/what.** A task carries an optional short free-text noting who or what it's blocked on (*planning officer*, *client sign-off*, *Building Control*). It is shown on the card when the task is in **Awaiting** (and editable inline there); hidden but retained otherwise. This turns the Awaiting column from a count into an actionable chase-list.
- Add an ad-hoc task to any stage (title + type), appended as *To Do*, not urgent.
- Delete a task.

### 3.5 Per-stage Kanban
- Each stage shows the six columns: **Backlog · Upcoming · To Do · In Progress · Awaiting · Done** (In Progress = actively being worked, between To Do and Awaiting).
- The collapsed summary shows live counts per status (e.g. *2 upcoming · 3 to do · 2 awaiting · 4 done*) plus a separate **redline urgent tally** (e.g. *· 1 urgent*) when any top-level card is flagged — urgency is orthogonal, so it is counted separately, not inside a status. All counts are **top-level cards only** (children excluded). Zero-count pips may be hidden to keep the summary clean.
- The board **pages horizontally** — one stage at a time fills the screen; on load it opens on the **current stage**. Navigate by the floating ‹ › arrows, the spine, swipe, or ←/→ keys.

### 3.6 Drag — reorder, re-status, re-section *(implemented)*
- Drag a card to **any section × status cell within its stage** — changing its **status** (column), its **section** (lane, §3.11), or both — and **reorder** within a cell. It persists `status`, `section_id`, and `position` (the destination column is renumbered `0..n`).
- **Drag never crosses stages.** Sections are stage-bound and each stage is its own page, so there is no cross-stage drag (a hard non-goal, §9) and no cross-stage tension.
- Implemented with the browser's **native drag-and-drop** — no library, no CDN, in keeping with sovereignty. A grabbed card lifts (handle = ⠿, or grab the card body), the target cell highlights, and the drop settles without a reload.
- **Click / touch fallback:** each card's **‹ ›** buttons step it across the four status columns (staying in its section). Drag is an enhancement, not the only path. *(Native DnD is mouse/desktop; the steppers cover status on touch — moving sections on touch is a known gap, and keyboard DnD / SortableJS-for-nesting are candidates for the nesting increment.)*

### 3.7 Nesting — parent/child tasks
The headline new interaction: **drag one card onto another and the target becomes its parent.**

- **Single level only.** A child cannot itself have children in v1. Dragging a parent onto a card, or a card onto a child, is disallowed (snap back).
- **Drop *onto* a card → nest; drop *between* cards → reorder.** This gesture distinction is the central UX risk (§10). The target card must reveal a labelled **"nest here"** drop zone while a card is dragged over its body, so the two outcomes are never ambiguous. If hover lands in the gap between cards, it reorders; only a drop within the card's nest zone nests. **If the whole-body zone proves ambiguous in use, fall back to a dedicated nest target** rather than overloading the card body (see §5 and §10).
- **Children render as an indented checklist inside the parent card** — each child a single line with its type badge, a done toggle, and a **promote** control (↥).
- Children **have no column of their own** (this avoids the incoherence of "what status is a child whose parent is in a different column"). A child's only state is **done / not done** via its checkbox.
- **Children belong to the parent's column.** When promoted (↥) or dragged back out, a child becomes an ordinary top-level card **in the parent's current column, inheriting the parent's status** — *not* reset to To Do. A child that was ticked *done* lands in **Done**.
- A parent card may show a small roll-up (e.g. *2/3 done*) but its own status is set independently by the practitioner — children do **not** auto-advance the parent in v1.
- Children are excluded from the stage's column count pips (only top-level cards count).
- **Deleting a parent prompts** the practitioner: **Delete children** (remove the whole subtree) or **Explode out** (promote every child to a top-level card in the parent's column), plus Cancel. Children are never silently destroyed.

Recommended implementation: **SortableJS, vendored locally** (no CDN). Note that the "always-present nest list inside every card" technique can itself *cause* the drop-onto-vs-between ambiguity; **prototype this one gesture in isolation before committing**, and prefer an explicit, clearly-bounded nest zone (or a dedicated affordance) over a whole-card drop target. Library-agnostic alternatives are acceptable provided the gesture spec above holds.

### 3.8 The stage spine
- A horizontal register of stages 0–7 across the top of the board, the **signature element** (§5).
- **Clicking a stage navigates** — it expands that stage and scrolls to it. Clicking the spine **does not change the project's current stage**; exploring a future (or past) stage must never silently advance the "you are here" pointer.
- Setting the current stage is an **explicit action**: a "Set as current stage" control in the expanded stage header, or accepting the nudge (§3.9).
- The current stage is highlighted in the spine. On the home register, each project shows a compact read-only spine.

### 3.9 Stage-advancement nudge
The practitioner often starts working ahead before formally "moving" the job. The tool watches for this and *offers* to advance — it never advances on its own.

- **Trigger (either signal):**
  - **Activity** — the practitioner has changed the status of **≥ 3 distinct tasks** in some stage *S* where *S > current_stage* (since load or since the last dismissal); **or**
  - **Completion** — the current stage's top-level tasks are **≥ 80% Done** *and* at least one task has had activity in a later stage.
- **Behaviour:** a single, **dismissible**, non-modal prompt appears in the titleblock naming the highest qualifying stage — *"Working in Stage 4 (Technical Design) — set as current? [Set] [Dismiss]."* **Set** updates `current_stage` (animating the spine, §5). **Dismiss** suppresses the prompt for that stage until further activity occurs there. No timers, no background polling, no machine learning.

### 3.10 Triage filters
Quiet toggles in the titleblock that narrow what the whole board shows, for fast triage of §1's questions — **Urgent only**, **Statutory only**, **Hide done**. Filters apply across all expanded stages, are **client-side** (no server round-trip), and may be **remembered** in `localStorage` (still sovereign — nothing leaves the machine). "Hide done" hides Done cards (and may collapse the Done column); the type/urgent filters narrow to matching cards. Filters never alter data — only the view, and an active filter is always visibly indicated so the board is never silently partial.

### 3.11 Sections of work
An optional grouping between a stage and its tasks: **Stage → Section → Task → child.** "Measured Building Survey" is a section; "Site survey" a task within it. Tasks need not belong to a section.

- A **section belongs to one stage** — no cross-stage sections, no cross-stage tension. It carries a title and a `position`.
- Sections render as **glass swimlanes** stacked down a stage; each lane runs the four status columns through *its own* tasks. Loose (un-sectioned) tasks live in an always-present **"General"** lane, shown last — so there is always somewhere to add or drop a loose task.
- Each lane shows a **roll-up** (done/total + an urgent tally) and is **collapsible** to its header.
- Create a section (per stage), **rename** it inline, and **delete** it — **deleting a section orphans its tasks to General** (it never destroys them).
- Drag (§3.6) moves a task between lanes (sets `section_id`); add-task is per-lane.
- Stage count pips (§3.5) and the urgent tally count **all top-level tasks in the stage**, across every lane.

**Layout — Status (status-primary).** *(v0.8: this is now the single layout; the earlier "Sections" swimlane was retired from the UI, code dormant.)* Four full-height columns, cards grouped into section **bubbles** (+ a loose area). **Clicking a card links its section across columns** (highlights its bubbles, dims the rest); **dragging a card to another column changes status and auto-regroups it into its section's bubble** (never loose); a task's **section** is reassigned via the chip bar or right-click — a status-drag never changes section. **Drag a section by its bubble header** to bulk-move all its tasks to another status (they glue onto that section's tasks already there). **Hide-done** hides done cards but keeps the Done column as a drop target.

### 3.12 Activity log & undo
- Every change is recorded as an **event** (person → action → task/section) in an `events` table — the **full audit trail**, *nothing is dropped*. Each event carries an `important` flag splitting the log in two:
  - **Visible drawer (curated narrative):** a tight, readable story — only **a task being added** (anywhere), **status set to Awaiting or Done**, and **a decision being made**. Everything else (Backlog/Upcoming/To Do/In Progress moves, section/type tweaks, urgent flips, deletes, restores, scope/stage edits, project created) is **not** shown. The verb filter is applied at query time, so it also tidies events logged before these rules.
  - **Decisions are credited to the decision-maker:** a confirmed decision reads *"Client decided “Wall colour” → Red"* (actor = the "decision by?" assignee), not the practitioner.
  - **Full log (audit):** every event including the minor moves, exported as JSON via **More → Export full log** (`/projects/<uid>/activity.json`). This is the trail intended to be handed to an agent later for practice automation.
  - **Done-then-undone within 10 min:** the "completed" line is **retracted from the visible drawer** (kept in the full log), so a quick mis-tick leaves no false milestone.
- Events are **structured** (actor, verb, target, detail, timestamp, important) so they can feed local `.md` / JSON files later. Actor defaults to `ARCKANBAN_ACTOR` ("JW"); decision events use the assignee.
- **Create-task widget:** a **＋ Task** popover in the titleblock controls — name, type, section, and **status (defaults to To Do, but settable on creation)** — so a task can be born straight into Awaiting/Backlog/etc. **Save** keeps the popover open for rapid multi-add; **Save & close** files the last one and dismisses it.
- **Right-click** a card → assign it to a section / break it out to General. **Right-click empty space** → Actions → **Undo {last action}** (covers move, urgent, type, add, delete-via-restore, section reassignment, bulk section move). Single most-recent action for now; more actions / multi-level later.

### 3.13 Decisions & the decision register
- A **Decision** task (one of the four types) carries, under its **decision-by** assignee: a list of candidate **options** and a single confirmed **outcome**.
- **Add options** inline on the card ("+ option", keep typing to add several). Options persist in a `decision_options` table.
- **Confirm a choice** by the ✓ on an option, or via **right-click → Confirm decision** (lists the options + **Other…** once there's more than one). Decisions rarely land on a listed option, so **Other…** lets you type the real outcome — which is also recorded as an option, so the register shows the chosen item. The confirmed outcome shows as a green **✓ Decided** banner; it can be **reopened** (cleared).
- **Automation:** options can be added before a decision-maker is set, **but a decision cannot be confirmed until the “decision by?” assignee is set**. On confirming, the decision is **stamped with the date and auto-moved to Done**. Confirmed ⟺ Done: **reopening a decision sends it back to To Do**, and **dragging/stepping a decision out of Done auto-unconfirms it** (outcome + date cleared). Confirming logs a **curated milestone** (*"JW decided “Choose feature wall colour” → RAL 9010"*).
- The **decision register** is a second view of each project (**Decisions** button, top-right of the board → `/projects/<id>/decisions`): a styled table of every decision — **# · description · decision-by · outcome · decided date · stage** — with an **Add task** action per row that spawns a task **linked back to the decision** (`from_decision_id`, logged), so the provenance of work is recoverable later (process analysis / AI). Downloadable as JSON (`/projects/<id>/decisions.json`).

---

## 4. Screens

**Home / Register.** New-project form (job no., name, template) above a grid of project cards. Each card: job no. (mono), name, mini spine (progress arc), current-stage label. Inline edit of job no./name.

**Board.** Slim sticky **glass** titleblock strip — identity + the RIBA-coloured stage spine in one collapsible row (§5), the **triage filter toggles** (§3.10), the urgent tally, and a guarded delete-project. The stage-advancement nudge floats below it when triggered. Below: a **horizontally-paged** track — one stage's four-column Kanban per screen (floating ‹ › arrows to flip), each with draggable cards, the urgent flag, the awaiting-on note on Awaiting cards, nested children, an add-task row, and a "Set as current stage" control.

---

## 5. Design language *(first-class requirement — no compromise)*

The board is a **dark, glassy, floating-frame instrument** — deep navy under an ambient glow, frosted-glass panels and cards, soft floating shadows — fused with the practice's own world (the Plan of Work graphic, the drawing titleblock, redline markup, the drafting register). The instrument identity carries through the dark skin: the titleblock, the RIBA-coloured spine, mono register figures, and the redline / ochre / sage semantics. Refined, not decorative — an instrument, not a toy. *(v0.3 reverses the earlier light "paper" aesthetic.)*

### Palette (named tokens)

| Role | Token | Value | Use |
|------|-------|-------|-----|
| Background | `--bg` | `#070A14` | App canvas — deep navy, under an ambient blue/violet glow |
| Glass | `--glass` | `rgba(255,255,255,.045)` | Frosted panels and cards (with `backdrop-filter` blur) |
| Glass border | `--glass-border` | `rgba(255,255,255,.10)` | Hairline edges on glass |
| Ink | `--ink` | `#E9EDF8` | Primary text |
| Ink-soft | `--ink-soft` | `#98A2BC` | Secondary text, captions |
| Blue | `--blue` | `#5B8DEF` | Accent, primary actions, focus, active-stage ring |
| Redline | `--redline` | `#FF6B5C` | **Statutory** type, **Urgent** flag, destructive actions |
| Ochre | `--ochre` | `#E6AE4D` | "Awaiting" accent |
| Sage | `--sage` | `#5FB87E` | "Done" accent |
| RIBA 0–7 | `--riba-0…7` | spectrum | **Stage spine colours** — approximate the RIBA Plan of Work progression; swap for official brand hexes |

Boldness lives in the spine (RIBA colour + glow) and the ambient background; every glass surface stays quiet. **Contrast:** keep text in Ink / Ink-soft; the accent colours are for borders, glows, and small marks, not body text — verify WCAG AA on dark.

### Column treatment
Four floating glass columns; restrained tint so the board reads calmly and the eye still lands where it should:

- **Upcoming** — recessed: the faintest glass, dimmed heading; reads as "not yet."
- **To Do** — neutral glass; the default working column.
- **Awaiting** — an inner ochre glow + ochre heading; warm "on hold / pending" tone.
- **Done** — an inner sage glow + sage heading; settled, titles dimmed.

(There is no Urgent column — urgency is a flag carried *on* the card, so it shows up wherever the work actually is.)

### Card anatomy
- A **left margin rule** (3px) encodes type — redline (statutory), blue (client), graphite (admin) — like the margin of a drawing. Type label in small mono caps.
- **Statutory emphasis:** beyond the redline margin, statutory cards carry a small redline mono tag (e.g. `STATUTORY`) so the legal-duty cards are unmistakable at a glance.
- **Urgent flag:** the card's `!` button **is** the marker — grey `!` when off; when toggled on it **expands to a red outline + red "Urgent" label** (the button itself, no whole-card red ring). A card that is *both* statutory and urgent reads as a red type-margin **and** a red flag. Clicking again returns it to the grey `!`. (Earlier the whole card carried a red outline + corner triangle; that was removed in v0.10 so the signal lives on the control.)
- **Awaiting note:** on an Awaiting card, a quiet ochre `⧖ <who/what>` line names who it's blocked on (§3.4), editable inline — the chase-list at a glance.
- Title in body; a quiet drag handle (drafting-dot grip, visible on hover); **‹ ›** status steppers.
- Nested children indented beneath, connected by a thin hairline **leader line** (like a dimension leader), each with a done checkbox, type badge, and promote (↥). Parent roll-up shown as a mono fraction (*2/3*) with a thin sage progress underline.

### Typography
Two self-hostable, open-source faces (sovereignty — no Google Fonts CDN; ship the woff2 files):

- **Display / UI / body:** a precise neo-grotesque with a little warmth — **Hanken Grotesk** (or Inter as a safe fallback). Clear scale (e.g. 12 / 14 / 16 / 20 / 28); headings carry weight, body stays calm.
- **Data / register:** a monospace — **IBM Plex Mono** — for job numbers, stage numbers, counts, and dates. Use **tabular figures** so columns of numbers align like a drafting register. The mono is what gives the drawing-register feel; use it wherever a number is an identifier, not prose.

### Signature — the titleblock strip & the RIBA spine
A single slim, **sticky**, **glass** strip across the top. **Left:** job number and project name in ruled glass cells, like the corner block of a drawing sheet. **Right (filling the row):** the eight-cell **stage spine**, mono numerals, each cell tinted with its **RIBA Plan of Work stage colour** (`--riba-0…7`).

The spine reads as both progression and navigation:

- **Future** stages: dim, a faint RIBA colour-bar beneath the numeral.
- **Current** stage (the project's "you are here"): the cell **filled in its RIBA colour** with a matching glow.
- **Active** stage (the one currently on screen): a blue focus ring — deliberately distinct from "current," since you can browse a stage without advancing the job.

Clicking a cell **pages** to that stage (§3.8); it does not set the current stage. The strip is **collapsible**: a chevron drops it to a hairline showing job no. + current stage number **+ the redline urgent tally** (so "what's on fire" survives the collapse). The **triage filter toggles** (§3.10) sit in the strip as quiet controls; an active filter shows a small redline dot, so a filtered board is never mistaken for an empty one.

### Layout — horizontal stage paging
One RIBA stage's four-column Kanban **fills the screen**; stages are laid out left→right and **paged** between (0→7 mirrors how the Plan of Work is drawn). Flip with the floating **‹ ›** glass arrows, the spine, a touch **swipe** (CSS scroll-snap), or the **←/→** keys. The board opens on the current stage; columns scroll internally when a stage holds many cards.

### Nest-here zone
While a card is dragged over a valid parent, reveal a clearly-bounded **dashed rectangle on blue tint** labelled *"nest here"* — dashed like a drawing's area-of-work hatch, obviously a drop target and obviously distinct from the between-card insertion line. The zone fades in only during an over-card drag.

### Spatial & motion
- 8px baseline grid; generous, disciplined whitespace; the board runs **full-bleed** (the home register stays ~1100px). Frosted-glass panels (`backdrop-filter` blur) over the ambient glow give the floating depth.
- Motion is restrained and purposeful: smooth **stage paging** (scroll-snap); card lift on drag; cards / columns / nudge ease in; the "nest here" zone fades only during an over-card drag. **Respect `prefers-reduced-motion`** (instant paging, no transitions).

### Quality floor (non-negotiable)
Responsive to mobile (within a stage the four columns stack to one and scroll vertically; stages flip by **swipe**; ‹ › steppers and the promote control are the primary movement path on touch); visible **drafting-blue keyboard focus** on every control; every movement reachable without drag (status via ‹ ›, nesting/promote via controls); empty states that direct rather than decorate — per column (*"nothing here"*, faint dashed), per empty stage (*"No tasks in this stage — add one below"*), and the home register (*"No projects yet — create one to lay out its RIBA stages"*).

---

## 6. Data model

```
projects(
  id            INTEGER PK,
  uid           TEXT UNIQUE,                   -- stable external id (UUID; share loop + .md links)
  number        TEXT,
  name          TEXT NOT NULL,
  template      TEXT,
  current_stage INTEGER NOT NULL DEFAULT 0,
  stages        TEXT,                          -- appointment scope: CSV of enabled stages; NULL = all
  created_at    TEXT NOT NULL                  -- ISO-8601; ordering uses id DESC
)

sections(                                      -- "sections of work" (optional grouping)
  id         INTEGER PK,
  uid        TEXT UNIQUE,                      -- stable external id (UUID)
  project_id INTEGER NOT NULL  -> projects.id (cascade delete),
  stage      INTEGER NOT NULL,                 -- 0..7 (a section lives in one stage)
  title      TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0
)

tasks(
  id          INTEGER PK,
  uid         TEXT UNIQUE,                     -- stable external id (UUID); used by the share/merge loop
  project_id  INTEGER NOT NULL  -> projects.id (cascade delete),
  stage       INTEGER NOT NULL,                -- 0..7
  title       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'todo',    -- backlog | upcoming | todo | awaiting | done
  type        TEXT NOT NULL DEFAULT 'recommended',  -- statutory | recommended | process | decision
  urgent      INTEGER NOT NULL DEFAULT 0,      -- 0/1 flag, orthogonal to status
  awaiting_on TEXT NULL,                       -- optional: who/what an Awaiting task is blocked on
  position    INTEGER NOT NULL DEFAULT 0,      -- sort order WITHIN one list (see below)
  section_id  INTEGER NULL  -> sections.id,    -- swimlane; ON DELETE SET NULL → 'General'
  parent_id   INTEGER NULL  -> tasks.id        -- nesting (single level)
)

events(                                        -- activity log (narrative drawer; future .md export)
  id         INTEGER PK,
  project_id INTEGER NOT NULL  -> projects.id (cascade delete),
  actor      TEXT NOT NULL,                    -- person (single-user for now; ARCKANBAN_ACTOR)
  verb       TEXT NOT NULL,                    -- added | completed | moved | flagged | deleted | …
  target     TEXT,                             -- task/section name snapshot
  detail     TEXT,                             -- e.g. 'to Awaiting', 'into "Planning"'
  created_at TEXT NOT NULL                     -- ISO-8601
)
```

**`position` scope.** `position` orders a card *within a single list*, where a "list" is:
- for a **top-level** card: the tuple `(project_id, stage, section_id, status)` — i.e. one column of one section's swimlane;
- for a **child**: its siblings under one `parent_id`.

Positions are not global. On every drop/step, **renumber the affected list `0,1,2,…`** — at this scale (see §9) nothing fancier (fractional ranks, gap strategies) is warranted.

**Migrations.** From the v0.1 schema, this build adds — each as an **additive, idempotent migration** (`ALTER TABLE … ADD COLUMN` guarded by a column-exists check, never destructive):
1. `tasks.parent_id`;
2. `tasks.urgent`;
3. `tasks.awaiting_on`;
4. `tasks.position` *(if v0.1 lacks it)*;
5. the **status value set** changes to `upcoming | todo | awaiting | done` — any existing `'urgent'` status rows are migrated to `status='todo', urgent=1`;
6. the **`sections`** table + **`tasks.section_id`** (`ON DELETE SET NULL` → orphaned tasks fall back to the loose 'General' lane).

(This corrects the v0.1 doc's claim that `parent_id` was the only schema change.) Enable `PRAGMA foreign_keys = ON` per connection; perform project/parent deletes explicitly in the route regardless. Stable **`uid`s** are additive columns **auto-filled by `AFTER INSERT` triggers** (and backfilled once for existing rows, with unique indexes); **`projects.stages`** is additive (NULL ⇒ all stages in scope).

---

## 7. Tech stack
- **Backend:** Python 3, Flask, Jinja templates.
- **Database:** SQLite, single file (`arckanban.db`) in the app folder, created on first run.
- **Frontend:** vanilla JS, no framework, no bundler. **Drag uses the browser's native drag-and-drop** — no library, no CDN (the CDNs are blocked in the build environment anyway, and native keeps it sovereign). SortableJS may be vendored later for the nesting gesture + touch support.
- **Persistence of drag/steps:** small JSON endpoints (`fetch`) that update status / position / section_id / parent_id / urgent / type and return ok; no page reload. **Mutating endpoints check the `Origin` header (same-origin)** — a localhost service is otherwise reachable by any page in the user's browser; cheap insurance, on-brand for a sovereign tool.
- **Run:** `pip install flask` → `python app.py` → `http://127.0.0.1:5000`.

---

## 8. Build phases (for incremental agent build)

**Phase 1 — Foundation.** Projects (create/edit/delete), templates, RIBA accordion, per-stage Kanban, add/delete task, set current stage, status moves, the spine. SQLite, Flask, the Residential Extension template. *Must be (re)established in this repo* — see *Repository state*.
*Acceptance:* create a project from template → 28 tasks laid across stages 0–7; expand a stage, move and add tasks, set current stage.

**Phase 2 — Four statuses + urgent flag + drag.** Status set = Upcoming · To Do · Awaiting · Done. Add the `urgent` flag and its redline rendering + count tally. Vendor SortableJS. Drag to reorder within a column (persist `position`) and across columns (persist `status`). ‹ › steppers as the click/touch path. Spine click navigates only; add "Set as current stage"; add the §3.9 nudge; add the **awaiting-on** note (§3.4) and the **triage filters** (§3.10).
*Acceptance:* four columns render; urgent flag toggles and survives reload; reorder survives reload; cross-column drag and ‹ › both change status; an Awaiting card can be urgent; awaiting-on persists and shows on Awaiting cards; triage filters narrow the board client-side without touching data; spine click does **not** change current stage; nudge fires on either signal; no CDN requests.

**Phase 3 — Nesting.** Add `parent_id`. Drop-onto-card nests (single level); children render as an indented checklist with done toggle and promote; nest-here zone on hover; counts exclude children; promote returns the child to the **parent's column**; delete-parent **prompts** (delete vs explode).
*Acceptance:* drag A onto B → A becomes B's child; reload preserves it; promote returns A to a top-level card in **B's column** (B's status); deleting B offers delete-children vs explode-out; B's column count is unaffected by A.

**Phase 4 — Design pass.** Implement §5 in full: dark glass theme + tokens, titleblock + RIBA-coloured spine, horizontal stage paging, vendored Hanken Grotesk + IBM Plex Mono, four-column glass treatment, urgent/statutory card treatment, nest-zone styling, motion, reduced-motion, mobile swipe/stacking, focus states, empty states.
*Acceptance:* matches the design language on desktop and mobile; operable without drag; reduced-motion honoured; AA contrast.

**Phase 5 — Template library.** Author further templates (New Build, Loft Conversion, Garage Conversion, Listed/Conservation) as JSON. Optionally a simple in-app "save current project as template" (with a name/overwrite rule).

**Phase 6 — Sections of work + drag *(done)*.** Add the `sections` table + `tasks.section_id`. Render glass swimlanes within a stage (a 'General' lane for loose tasks); create / rename / delete a section (delete orphans its tasks to General). Native drag of tasks across the **section × status grid within a stage**, persisting `status` / `section_id` / `position`; ‹ › steppers remain the fallback. Templates may declare a `section` per task.
*Acceptance:* template imports sections and assigns tasks; drag a card to another lane or column → survives reload; deleting a section moves its tasks to General (none lost); drag never crosses stages.

**Phase 7 — Share & collaborate *(spec; v2)*.** Send a project to a client/consultant and merge their changes back, staying local and sovereign.
- **Export** a project as **JSON**, wrapped in a generated **`.eml`** (written to disk — no SMTP, no hosting, no external call), carrying a **self-contained, role-scoped viewer** (the JSON embedded in a single HTML file): a **client** viewer permits only **Awaiting → Done** (sign-off); a **consultant** viewer permits **any status on tasks assigned to them** (new `tasks.assignee`).
- The viewer emits a **changeset** back, also as an `.eml`, addressed to the practitioner — so both ends just open-and-send.
- **Import** matches by **`uid`** (within the named project, with provenance: source project uid + exported-at + schema version), is **idempotent** (already-applied = no-op, so prior edits aren't clobbered), opens a **review list** of incoming changes (**Apply all / Cancel**; per-item later), **validates strictly** (only permitted transitions on known uids), and logs each accepted change as an **event** ("Client completed X").
- Model additions: `tasks.assignee`, viewer **roles** (client / consultant). Built on the v0.7 `uid`s.
*Acceptance:* export produces an `.eml` whose viewer enforces its role; a returned changeset imports by uid with a review gate; re-importing the same changeset is a no-op; unknown/stale uids are surfaced, not misapplied.

---

## 9. Non-goals (v1)
No cloud sync, multi-user, or auth (single user; last-write-wins, refresh to reconcile across tabs). No time tracking, fees, or invoicing. No Gantt or calendar. No dragging tasks *between* RIBA stages. No multi-level task nesting. No integrations (CRM, email, drive). **Expected scale:** tens of active projects, ~30 tasks each — do not optimise beyond this. These are explicitly out of scope to keep the tool fast and the build honest.

---

## 10. Open questions & risks
- **Drop-onto vs drop-between (the main UX risk).** The reorder and nest gestures share one drag. Mitigation is the explicit hover-revealed nest zone; if it still feels ambiguous in use, fall back to a dedicated nest affordance (e.g. drag onto a small "+sub" target on the card) rather than overloading the whole card body. **Prototype this gesture before committing the library approach.**
- **Statutory vs urgent, both redline.** Both use redline but differ in *form* (persistent left margin + tag vs corner-flag/badge). If the two still read as muddy together, give urgent a distinct mark (e.g. a redline asterisk) rather than a second red region.
- **Nudge tuning.** The "either signal" thresholds (≥3 task changes; ≥80% current-stage done) are a starting point; loosen/tighten if it nags or under-fires.
- **Parent roll-up.** v1 keeps parent status manual. If "all children done → suggest parent done" proves wanted, add it as an opt-in, not a default.
- **Child type/stage.** Children inherit the parent's stage and column, keep their own type badge, and carry only done/not-done. Nesting a card discards its prior status; promoting yields the parent's column. If children later need full card behaviour, that's a v2 model change.

### Resolved (recorded so they aren't relitigated)
- **Urgent is a flag, not a column** (v0.2). Urgency is orthogonal to progress; modelling it as a flag lets a task be urgent *and* awaiting, which the core purpose (§1) needs. The "drag the hot items into one place" benefit is preserved via the redline marker and a triage filter (Appendix C).
- **Spine click never sets current stage** (v0.2). Exploring ≠ advancing; advancing is explicit or via the nudge.
- **Un-nesting returns to the parent's column** (v0.2), not To Do.
- **Deleting a parent prompts** (delete vs explode) (v0.2).
- **Counts** are top-level cards only; zero-counts may be hidden; the urgent tally is separate.

---

## 11. Changelog — v0.1 → v0.2
1. **Urgent column removed**; urgency is now an independent **flag** (`tasks.urgent`). Four status columns: Upcoming · To Do · Awaiting · Done.
2. **Un-nesting / promote** returns a child to the **parent's column** (inherits status), not To Do.
3. **Delete-parent prompts**: Delete children vs Explode out.
4. **Stage spine click navigates only** — no longer sets current stage. Current stage set via explicit control or the new **stage-advancement nudge** (§3.9, "either signal").
5. **Type is editable**, with a confirmation warning when downgrading away from `statutory`. **Title and project name/number** are editable too.
6. **`position` scope** pinned to `(project_id, stage, status)` for top-level and `parent_id` for children; renumber-on-drop.
7. **Migration set** corrected and enumerated (parent_id, urgent, position, status-values); FK enforcement + explicit cascade noted.
8. **Tasks move freely** among columns (no implied linear pipeline).
9. **Origin-header check** on mutating endpoints; **ordering by `id DESC`**; **expected-scale** note added (anti-over-engineering).
10. **Design language expanded** (§5): ink-over-pencil spine, statutory tag + urgent corner-flag, nest-zone styling, child leader-line + roll-up, tabular figures, contrast guidance, empty states. Speculative ideas moved to **Appendix C**.
11. **Naming** standardised to *ArcKanban* (DB `arckanban.db`); statutory terminology spelled out (Building Regulations Principal Designer). **Repository-state** note added.
12. **Two design proposals promoted** into the spec — **triage filters** (§3.10) and the **awaiting-on** chase-note (§3.4 / §5 / new `tasks.awaiting_on` column).

### v0.2 → v0.3 (design pivot)
13. **Dark glass theme** — deep-navy canvas under an ambient glow, frosted-glass floating panels and cards; replaces the light "paper" palette. New token set (§5). *(Data model and API are unchanged.)*
14. **Horizontal stage paging** — one stage's Kanban fills the screen, flipped by floating arrows / spine / swipe / ←→ keys; replaces the vertical accordion.
15. **RIBA stage colours** on the spine (`--riba-0…7`) — approximate spectrum pending official brand hexes.
16. **Active vs current stage** are now distinct on the spine: a blue focus ring marks the stage you're *viewing*, a filled RIBA-colour glow marks the project's *current* stage.

### v0.3 → v0.4 (sections of work + drag)
17. **Sections of work** — optional grouping (`sections` table + `tasks.section_id`); the hierarchy is now **Stage → Section → Task → child**. Glass swimlanes within a stage + an always-present 'General' lane; create / rename / delete (delete orphans tasks to General).
18. **Drag implemented** (native HTML5 DnD, no dependency): move a task across any section × status cell **within its stage**, with reorder; persists `status` / `section_id` / `position`. Steppers remain the click/touch fallback.
19. **Templates may declare a `section`** per task; the Residential Extension template now ships with sections (Measured Building Survey, Planning Application, Building Regulations, Party Wall, Handover).
20. `position` scope extended to include `section_id`; SortableJS replaced by native drag in §7.

### v0.4 → v0.5 (section view toggle)
21. **Layout toggle** (titleblock, remembered via cookie): **Sections** (swimlanes) ⇄ **Status** (status-primary columns + section bubbles) — two renderings of the same data.
22. **Grouped view**: section **bubbles** within each status column + a loose area; **click-to-link** (highlight a card's section across columns, dim the rest).
23. **Drag auto-regroups**: in the grouped view, dropping a card in another column keeps its section and lands in that section's bubble (created if needed) — never the empty workspace. A status-drag never changes section.
24. **Section reassignment** via the chip bar (select card → click chip); the viewed stage is remembered across reloads/toggles.
25. **Compact cards + sliding reorder**: the per-card status label and footer row are gone (the column states the status); the ‹ › steppers fold into the card's control row; statutory shows as a red type label. Drag reorder now uses a **FLIP** animation — sibling cards slide aside live instead of snapping into place on release (honours `prefers-reduced-motion`).
26. **Right-click a card → section menu**: assign it to any section in the stage, or break it out to General. Works in both layouts (`api_update_task {section_id}`).
27. **Urgent no longer masks the type band**: the type colour band is thicker and keeps its own colour; the red urgent ring sits *outside* it (was: urgent recoloured the whole border).
28. **Drag a whole section across statuses** (grouped view): drag a section by its bubble header into another status column to move *all* its tasks at once; arrivals **glue** onto the section's existing tasks in the destination (`POST /api/sections/<id>/move`).

### v0.5 → v0.6 (activity log, undo, FLIP fix)
29. **Activity log** — persisted `events` table + a right-hand **narrative drawer** ("JW completed “X” · date · time"): person → action → task/section. Logged across the meaningful mutations; structured for future `.md` export. New endpoint `POST /api/projects/<id>/tasks/restore` (used by undo).
30. **Undo** — right-click empty space → Actions → **Undo {last action}** (move, urgent, type, add, delete-via-restore, section reassignment, bulk section move). Reverts the most recent action; multi-level later.
31. **FLIP reorder fix** — the slide animation now freezes in-flight transforms before measuring, so it runs every time instead of occasionally snapping into place.

### v0.6 → v0.7 (stable ids, appointment scope, Phase 7 spec)
32. **Stable `uid`s** (UUIDs via `AFTER INSERT` triggers) on projects / sections / tasks, with unique indexes and a one-time backfill — foundation for the share loop and `.md` linking, immune to integer-id reuse/collision across DBs and backups. `task_to_dict` carries `uid`.
33. **Appointment scope** — `projects.stages` (CSV; NULL = all). Out-of-scope RIBA stages are greyed in the spine, skipped in paging, and shown as an "outside scope" placeholder; edited via the **Scope** popover; the current stage stays in scope (`POST /api/projects/<id>/stages`).
34. **Phase 7 — Share & collaborate** specified (§8): `.eml` export/import, client/consultant viewer roles (`tasks.assignee`), `uid`-based idempotent merge behind a review gate.

### v0.7 → v0.8 (Status-only board, centred spine + star)
35. **Status-only** — the Sections/Status toggle is removed; the server always renders the Status (grouped) layout (swimlane code dormant).
36. **Centred RIBA spine** on the page, with the **focused stage's name** beneath it and a **star** to its right: filled when the focused stage is the current stage, click to set it. Replaces the "you are here" tag, the "Current stage" badge, and the per-slide "Set as current stage" button.
37. **Hide-done fix** — hides done cards/bubbles but keeps the Done column as a drop target so tasks can still be completed.

### v0.8 → v0.9 (log phrasing, auto-omit, living background)
38. **Log phrasing** — status changes read **"JW set "X" to "Status""** (uniform; replaces "completed" / "moved to").
39. **Auto-omit round-trips** — setting a task to Done then back out within 10 minutes removes **both** log entries (events carry a `task_id`; the drawer drops the line live via `omit_last`).
40. **Living background** — two gentle, slow drifting/pulsing glow layers (vibrant on dark); `prefers-reduced-motion` honoured.
41. **Backlog recorded** (§12) and the **redo expiry** decision captured.
42. **Collapsible section bubbles** (grouped) — fold a section (across its columns) via the bubble chevron, persisted per project; and **fixed column scrolling** (`grid-template-rows: minmax(0,1fr)`) so each status column scrolls independently as it fills.
43. **Activity log reads oldest→newest** (latest entries at the bottom); the drawer auto-scrolls to the newest on update and on open.
44. **Bubble cropping fixed** — section bubbles no longer flex-shrink/clip in a scrolling column (always full height, or collapsed).
45. **Four task categories** — **Statutory · Recommended · Process · Decision** (replacing client/statutory/admin; migration maps client→recommended, admin→process). **Decision** carries a responsible person shown in any column (reuses the awaiting-on field) and is movable anywhere. Distinct margin colours (red / blue / violet / ochre).
46. **Animated WebGL background** — a self-contained "Neat"-style domain-warped gradient shader (no npm/library/CDN), rich Prussian palette; reduced-motion + WebGL-absent fallbacks.
47. **Five status columns** — **Backlog · Upcoming · To Do · Awaiting · Done** (split the endless Upcoming into Backlog + Upcoming; existing Upcoming tasks unchanged; Backlog is new).
48. **Scope: current stage can now be disabled** — disabling the in-scope current stage auto-advances `current_stage` to the lowest remaining in-scope stage (was: blocked, so Stage 0 couldn't be turned off).
49. **Background tuned darker & blobbier** — zoomed in, fewer octaves, gentler warp, ~0.4 render scale (soft upscale), darkened palette — sits well within the dark theme.
50. **Save as template (export)** — `GET /projects/<id>/template.json` downloads a sanitized template (tasks · sections · types · **statuses**), **excluding the project name, any people (awaiting/decision-by), urgent flags and ids**. Templates now support a per-task `status` on import. Links on the board and home register. *(Phase 5 "save current project as template" — done as an export.)*

---

## 12. Backlog (outstanding to implement)

Tracked so nothing is lost; ordered roughly by priority.

> **Recently shipped (v0.18):** **task search** — a ⌕ button (and the `/` shortcut) opens a popover that finds tasks by title across every stage; results show stage · section · status, and clicking (or Enter) jumps to the card (paging to its stage, expanding its section, and flashing it). Tasks only.
>
> **Recently shipped (v0.17):** the curated drawer is trimmed to a readable narrative (task added · status→Awaiting/Done · decision made — everything else full-log-only, §3.12), with **decisions credited to the decision-maker** ("Client decided … → Red"); the **auto-hide dock retracts much more slowly** with a long pause (brush it and it stays open); and the **decision register returns you to the board stage you were viewing** (back-link carries `?stage`).
>
> **Recently shipped (v0.16):** an **In Progress** column (now six: Backlog · Upcoming · To Do · In Progress · Awaiting · Done); decision **reopen ⟺ status** (reopen → To Do; drag/step out of Done auto-unconfirms); **uid-based project URLs** (`/projects/<hex>`, stable across delete/recreate) with the durable uid also carried in the decision-register export.
>
> **Recently shipped (v0.15):** **decision automation** — a decision can't be confirmed until its “decision by?” assignee is set, and confirming **stamps the date + auto-moves it to Done** (§3.13); a styled **Decision register page** (Decisions button, top-right) with #/description/assignee/outcome/date and an **Add task** that links spawned tasks back to the decision (`from_decision_id`, logged); and an **identity capsule** (top-left) that keeps the job no. + name visible while the auto-hide header is tucked away.
>
> **Recently shipped (v0.14):** **vendored fonts** — Hanken Grotesk (variable) + IBM Plex Mono woff2 served from `static/fonts/` with OFL.txt (no CDN); the **dormant swimlane layout** code/CSS/template removed (the board is status-primary only now); the auto-hide dock **retracts slowly with a longer pause** so the header stops jumping; **assignee autocomplete** on "decision by?"/awaiting (standard roles + per-project remembered names); and a new project **opens on the first populated stage** so a template's board never looks empty.
>
> **Recently shipped (v0.13):** the inline "Add a task" form was removed — the **＋ Task** header widget is the single add path; the auto-hide dock indicator is now a **fine full-width rail that merges into the centred tab** (one hover zone) that slides the header down on hover.
>
> **Recently shipped (v0.12):** **Decisions & the decision register** (§3.13) — decision tasks gather **options** and a confirmed **outcome** (✓ on an option or right-click → Confirm → Other…), logged as a curated "decided" milestone, exported via **Decision register** (`/projects/<id>/decisions.json`); and the register cards now lead with a **Launch** button + a **⚙ Config** popover (appointment scope, exports, and a tucked-away Delete) — the bare Delete button is gone.
>
> **Recently shipped (v0.11):** Awaiting/Done columns differentiate by coloured **outline + header only** (neutral fill, so the background reads through); **sections moved off the board** into a **Sections** popover (add/rename/delete for the stage in view) with a hidden per-stage data registry behind it; the **board reclaims header space** — fixed header + animated board padding so the Kanban fills up when the dock tucks away and squeezes down (no overlap) when shown/pinned; the **activity log floats** as a rounded panel clear of the header; **project Delete + Scope moved to the register** (board ⋯ menu now export-only); and **template upload** — add a saved template JSON to the library via the picker, named in a popup.
>
> **Recently shipped (v0.10):** two-tier activity log (curated drawer + full-log JSON export, §3.12); **＋ Task** create-widget with on-creation status (§3.12); **auto-hide dock** — the titleblock tucks up for maximum board real-estate, revealed by hovering a top-centre handle (default on; the chevron pins it open); **top-bar declutter** — controls collapsed into **＋ Task / Filter ▾ / Log / ⋯ More** with the filter/scope/template/delete/export items behind popovers; **bigger, more-spaced spine** cells; **more compact sections** (tighter chips, bubbles, cards); **urgent-flag restyle** (red signal now on the button, not a whole-card ring, §3.4); **background** returned to a richer multi-hue palette (violet / green / warm orange / blue) with the lighter areas allowed to lift, still dark mode.

### Core interactions
- **Parent/child nesting** (the original §3.7, still unbuilt): drag a card onto another to nest (single level); children render as an indented checklist with a done toggle + promote (↥); the drop-onto-vs-between gesture; deleting a parent prompts (delete children vs explode out); counts exclude children. *The last structural piece of Stage → Section → Task → child.*
- **Redo + undo rework**: rework undo to apply **in place** (no page reload) so a **Redo** appears after an undo. **Redo stays available until either a new edit / navigation, or the task(s) involved are otherwise changed — whichever comes first.** (Foundation for multi-level undo/redo later.)

### Sharing & collaboration (Phase 7)
- **Public client/consultant build (parallel, not yet started).** A website-hosted variant that **shares this codebase** — ideally only the **landing page differs**, gated by a config flag / distinct entry route (so it's one app run in two modes, not a fork). The public landing shows **no saved projects**: only **(a) start a new temporary project** (held in-browser, downloadable as JSON) or **(b) a drop-zone to import a provided JSON** which generates the board. The shared person can move things freely; on **re-export the JSON comes back to the practice**, and a **`uid`-keyed merge** brings in *new tasks added* and, crucially, **decision confirmations** (the §3.13 outcomes) — making the decision register the round-trip payload. *(Decided foundations are now in place: stable `uid`s, the template/JSON import path, and the decision options/outcome model.)*
- **`tasks.assignee`** field + a small card control — who a task is assigned to (a consultant). Feeds the email table and the consultant viewer.
- **Email generator** — an **Email** action opens a **compose textbox** (cover note), then produces a downloadable **`.eml`** containing: the cover note, an **embedded task table** (task · status · assigned / waiting-on), the **project JSON attached**, and a **viewer link**. *(Open choice when built: ship with a placeholder link first, or build the viewer alongside so the link is live.)*
- **Role-scoped offline viewer** — a self-contained HTML (JSON embedded): **client** = Awaiting→Done only; **consultant** = any status on tasks assigned to them. Emits a changeset back as an `.eml`.
- **Import + merge** — import a returned changeset, match by **`uid`**, idempotent, behind a **review list** (Apply all / Cancel); log each accepted change as an event.

### Design & polish
- **Background** — further morphing/contouring "orb" work (user-led). Live base is the WebGL shader in `static/bg.js` (multi-hue, domain-warped fbm) with the `body::before/::after` CSS glow as the no-WebGL fallback.
- ~~Vendor the fonts~~ **done (v0.14)** — Hanken Grotesk + IBM Plex Mono woff2 in `static/fonts/` (SIL OFL).
- ~~Remove the dormant swimlane layout code~~ **done (v0.14)**.

### Templates (Phase 5)
- Author more templates (New Build, Loft Conversion, Garage Conversion, Listed/Conservation); optional in-app **"save current project as template."**

### Smaller / later
- **Multi-level** undo/redo (current undo reverts only the single most-recent action).
- **Touch drag** (native DnD is desktop; steppers cover status on touch) and **keyboard** reorder/nest paths.
- Appendix C extras: **home grouping by stage**, **print-as-drawing-sheet**, density toggle.

---

## Appendix A — Residential Extension template (reference)
28 tasks across stages 0–7, tagged by type. Highlights: Stage 1 — confirm CDM / Building Regulations Principal Designer appointment *(statutory)*, measured survey, planning pre-app; Stage 3 — coordinated plans, structural coordination, **submit planning application** *(statutory)*; Stage 4 — Building Regs package and submission, **party wall notices** *(statutory)*, tender info; Stage 5 — contractor appointment, Building Control inspections, discharge planning conditions; Stage 6 — completion certificate, snagging, H&S file. Full JSON ships in `templates_lib/residential_extension.json`. (Template tasks start as *To Do*, not urgent.)

## Appendix B — Prototype architecture (target structure)
Single `app.py` (routes + SQLite helpers + RIBA constants); Jinja templates (`base`, `index`, `board`); `static/style.css` + `static/board.js`; `templates_lib/*.json`. DB auto-creates on run. *(This describes the v0.1 prototype's shape and is the intended structure for Phase 1 in this repo — extend it, don't replace it, once it exists here.)*

## Appendix C — Design proposals (for your call)
Tasteful enhancements that fit the language but aren't yet committed — flagged for a yes/no/later. *(Triage filters and the awaiting-on field were promoted into the spec in v0.2; the rest remain candidates.)*

- **Home register grouping** — sort/group projects by current stage ("all my Stage 4 jobs"); the mini-spine already reads as each job's progress arc.
- **Last-updated "revision" line** in the titleblock corner (mono date) — completes the drawing-sheet metaphor.
- **Density toggle** (comfortable / compact) for practitioners who want everything on one screen.
- **Drawing-sheet border** — a thin double-hairline inset around the board edge, like a sheet border. Subtle; use with restraint.
