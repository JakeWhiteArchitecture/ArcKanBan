# ArcKanban — Requirements

*Arc + Kanban — the arc of a job traced across the RIBA Plan of Work.*

**A project tracker for a sole-trader architectural practice.** Every job moves through the eight RIBA stages; each stage holds its own small Kanban. New projects are laid out instantly from a template. Local-first, single-file database, no cloud.

**Status:** v0.2 specification. A v0.1 prototype (Flask + SQLite) is referenced as the foundation but is **not present in this repository** — see *Repository state* below. This document specifies the build from that foundation forward.

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

The board is an **accordion of the eight RIBA stages**. Each stage collapses to a one-line summary with counts, and expands to a **four-column Kanban** (see §3.4) for the tasks in that stage. A horizontal **stage spine** across the top marks where the job currently sits and doubles as navigation.

It is **not** a single board where cards are dragged *between* RIBA stages. A Stage 3 task does not become a Stage 4 task — tasks don't migrate across the Plan of Work, so that interaction was rejected as the wrong metaphor. Movement happens *within* a stage, along the status columns. This decision is recorded here so it isn't relitigated.

Templates do the structural work: a template is a set of stages each with a standard task list, and creating a project from one pre-fills every task. Author once, reuse on every job of that type.

---

## 3. Functional requirements

### 3.1 Projects
- Create a project with a **job number** (four-digit convention, free text) and **name**.
- **Edit** a project's job number and name after creation.
- A project records its **current RIBA stage** (the "you are here" pointer).
- Projects are listed on the home register, **newest first** (`ORDER BY id DESC` — avoids relying on text-date sorting), each showing job no., name, a mini stage spine, and current stage.
- Delete a project (with confirmation) removes it and all its tasks. Deletion is performed by an **explicit cascade in the route** (and `PRAGMA foreign_keys = ON` per connection), so it cannot silently no-op — SQLite does not enforce foreign keys by default.

### 3.2 Templates
- Templates are plain **JSON files** in `templates_lib/`, discovered automatically and offered in the new-project picker.
- Each template has a display `name` and a list of tasks: `{ "stage": <0-7>, "title": <str>, "type": <client|statutory|admin> }`.
- Creating a project from a template copies its tasks in (all as *To Do*, all *not urgent*), assigning `position` by **array order within each stage/column**. A broken template file must not crash the app — **fail soft**: skip the unreadable file, flash a notice, still offer the rest.
- A "Blank" option creates a project with no tasks.
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
- A task belongs to one project and one stage, and carries a **title**, a **type**, a **status**, an **urgent flag**, a **position** (sort order), and an optional **parent** (see §3.7).
- **Title** is editable inline.
- **Type** in {client, statutory, admin}. Type is structural, not cosmetic: it encodes whose duty the task is, and statutory tasks (the ones with legal teeth — planning, Building Regs, party wall, CDM) must be visually unmistakable. It drives the card's left margin rule (see §5).
  - Type is **editable**, but changing a task **away from `statutory`** (statutory → client/admin) requires a **confirmation warning** — you are removing a legal-duty marker. Promoting *to* statutory is silent (it only adds rigour).
- **Status** is one of **four** columns, left to right:

  | Status | Meaning |
  |--------|---------|
  | **Upcoming** | Not yet live — queued for later in this stage |
  | **To Do** | Actionable now, on the list |
  | **Awaiting** | Blocked on a third party (client sign-off, planning officer, Building Control, consultant) |
  | **Done** | Complete |

  *Awaiting* is the quiet workhorse: so much architectural work stalls on someone else's desk, and giving "blocked on others" its own column surfaces it at a glance. **Status is not a linear pipeline** — tasks move freely in any direction (To Do ↔ Awaiting, back out of Done, round and round) until they settle in Done.

- **Urgent is a flag, not a column** — an independent boolean on the card, orthogonal to status. This is the change from v0.1: a task can now be **Awaiting *and* urgent** (blocked *and* on fire — the single most important quadrant for triage), which the old urgent-column model could not express. Urgent renders in **redline** (§5) and is toggled on the card.
- Add an ad-hoc task to any stage (title + type), appended as *To Do*, not urgent.
- Delete a task.

### 3.5 Per-stage Kanban
- Each expanded stage shows the four columns: **Upcoming · To Do · Awaiting · Done**.
- The collapsed summary shows live counts per status (e.g. *2 upcoming · 3 to do · 2 awaiting · 4 done*) plus a separate **redline urgent tally** (e.g. *· 1 urgent*) when any top-level card is flagged — urgency is orthogonal, so it is counted separately, not inside a status. All counts are **top-level cards only** (children excluded). Zero-count pips may be hidden to keep the summary clean.
- Stages are **independently collapsible** (not a strict one-open accordion); the **current stage auto-expands** on load.

### 3.6 Drag — reorder and re-status
- **Reorder within a column** by dragging a card up/down; the new order persists (via `position`).
- **Move across columns** by dragging a card into another column; this changes its status and persists. Movement is unrestricted in either direction.
- Drag must feel precise: a card lifts on grab (shadow + slight scale), columns show a clear insertion point, drop settles without a full-page reload.
- **Click fallback (and the primary path on touch):** each card carries **‹ ›** buttons that step it left/right across the four status columns with a single click. (These move a task between *status columns* — never between RIBA stages, which is a hard non-goal.) Drag is an enhancement, not the only path.

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

---

## 4. Screens

**Home / Register.** New-project form (job no., name, template) above a grid of project cards. Each card: job no. (mono), name, mini spine (progress arc), current-stage label. Inline edit of job no./name.

**Board.** Slim sticky titleblock strip — identity + horizontal stage spine in one collapsible row (§5), with the stage-advancement nudge surfacing here when triggered → eight stage accordions. Expanded stage: four-column Kanban with draggable cards, the urgent flag, nested children, an add-task row, and a "Set as current stage" control. Footer: delete-project (guarded).

---

## 5. Design language *(first-class requirement — no compromise)*

The instrument should feel like it belongs on a drawing board, drawn from the practice's own world — the Plan of Work graphic, the drawing titleblock, redline markup, the drafting register. Deliberately **avoid** the current AI-design defaults: no cream-and-serif-with-terracotta, no near-black-with-acid-green, no broadsheet-hairline pastiche.

### Palette (named roles, fixed hex)

| Role | Hex | Use |
|------|-----|-----|
| Paper | `#F6F5F1` | App canvas — warm drafting off-white |
| Panel | `#FFFFFF` | Cards, surfaces |
| Ink | `#16181D` | Primary text — warm graphite |
| Ink-soft | `#5B5F6B` | Secondary text, captions |
| Hairline | `#D8D6CD` | Rules, borders (titleblock lines) |
| Drafting blue | `#2C4A7C` | Accent, current stage, primary actions |
| Blue tint | `#EAEFF6` | Current-stage backing, nest-zone backing |
| Redline | `#B23A2E` | **Statutory** type, **Urgent** flag, destructive actions |
| Redline tint | `#F7E9E6` | Faint urgent/destructive backing |
| Ochre | `#B8842B` | "Awaiting" column accent |
| Sage | `#4A7355` | "Done" column accent, roll-up progress |

Spend boldness in one place (the spine/titleblock); keep everything else quiet. **Contrast:** ochre and sage are *accent/rule* colours, not body-text colours — keep text in Ink / Ink-soft, and verify all text meets WCAG AA against its backing (especially dimmed "Done" titles and any tinted backings).

### Column treatment
Four columns, restrained accents so the board reads calmly and the eye still lands where it should:

- **Upcoming** — recessed: faint backing, ink-soft heading; reads as "not yet."
- **To Do** — neutral panel; the default working column.
- **Awaiting** — ochre/amber backing; warm "on hold / pending" tone.
- **Done** — sage backing; settled, titles dimmed, a thin sage check in the card margin.

(There is no Urgent column — urgency is a flag carried *on* the card, so it shows up wherever the work actually is.)

### Card anatomy
- A **left margin rule** (3px) encodes type — redline (statutory), blue (client), graphite (admin) — like the margin of a drawing. Type label in small mono caps.
- **Statutory emphasis:** beyond the redline margin, statutory cards carry a small redline mono tag (e.g. `STATUTORY`) so the legal-duty cards are unmistakable at a glance.
- **Urgent flag:** a redline marker distinct in *form* from the statutory margin — a folded-corner "flag" (top-right) or a bold redline `!` badge — so a card that is *both* statutory and urgent reads as red margin **and** red flag (correctly, the hottest card on the board). Toggled by a control on the card.
- Title in body; a quiet drag handle (drafting-dot grip, visible on hover); **‹ ›** status steppers.
- Nested children indented beneath, connected by a thin hairline **leader line** (like a dimension leader), each with a done checkbox, type badge, and promote (↥). Parent roll-up shown as a mono fraction (*2/3*) with a thin sage progress underline.

### Typography
Two self-hostable, open-source faces (sovereignty — no Google Fonts CDN; ship the woff2 files):

- **Display / UI / body:** a precise neo-grotesque with a little warmth — **Hanken Grotesk** (or Inter as a safe fallback). Clear scale (e.g. 12 / 14 / 16 / 20 / 28); headings carry weight, body stays calm.
- **Data / register:** a monospace — **IBM Plex Mono** — for job numbers, stage numbers, counts, and dates. Use **tabular figures** so columns of numbers align like a drafting register. The mono is what gives the drawing-register feel; use it wherever a number is an identifier, not prose.

### Signature — the titleblock strip
A single slim, **sticky** strip across the top — the titleblock and the stage spine merged into one row, not stacked. **Left:** job number and project name in ruled cells, like the corner block of a drawing sheet. **Right (filling the row):** the eight-cell **stage spine**, mono numerals, the horizontal Plan-of-Work timeline that answers "where am I" at a glance.

**Spine as ink-over-pencil** — lean into the product name (*the arc of a job traced across the Plan of Work*):

- **Future** stages: faint "pencil" grey.
- **Current** stage: filled solid drafting blue.
- **Past** stages: inked but muted blue, with a thin blue baseline traced beneath — the arc drawn in so far.

When the current stage advances (§3.9), the new cell **inks in** with a short draw-in animation (~250ms, reduced-motion honoured). Each cell may carry a hairline-thin done/total fill so the spine doubles as a progress sparkline; the home-register mini-spine uses the same treatment as a compact "arc."

The strip is **collapsible**: a chevron drops it to a hairline showing only job no. + current stage number **+ the redline urgent tally** (so "what's on fire" survives the collapse), reclaiming nearly all the vertical space; sticky positioning keeps it in view as cards scroll.

The spine stays **horizontal by design** — 0→7 reads left-to-right as progression, mirroring how the Plan of Work is drawn. *Optional, wide-screen only:* the strip may flip to a vertical left rail (recorded as an alternative, not the default — it competes with the columns for width and forces rotated type).

### Nest-here zone
While a card is dragged over a valid parent, reveal a clearly-bounded **dashed rectangle on blue tint** labelled *"nest here"* — dashed like a drawing's area-of-work hatch, obviously a drop target and obviously distinct from the between-card insertion line. The zone fades in only during an over-card drag.

### Spatial & motion
- 8px baseline grid; generous, disciplined whitespace; hairline rules echoing titleblock divisions; max content width ~1100px.
- Motion is restrained and purposeful: accordion expand ~180ms ease; card lift on drag; the "nest here" zone and the spine ink-in fade/draw only when relevant. **Respect `prefers-reduced-motion`** (no draw-in, instant state).

### Quality floor (non-negotiable)
Responsive to mobile (the four columns stack to one column; ‹ › steppers and the promote control become the primary movement path on touch); visible **drafting-blue keyboard focus** on every control; every movement reachable without drag (status via ‹ ›, nesting/promote via controls); empty states that direct rather than decorate — per column (*"nothing here"*, faint dashed), per empty stage (*"No tasks in this stage — add one below"*), and the home register (*"No projects yet — create one to lay out its RIBA stages"*).

---

## 6. Data model

```
projects(
  id            INTEGER PK,
  number        TEXT,
  name          TEXT NOT NULL,
  template      TEXT,
  current_stage INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL                  -- ISO-8601; ordering uses id DESC
)

tasks(
  id         INTEGER PK,
  project_id INTEGER NOT NULL  -> projects.id (cascade delete),
  stage      INTEGER NOT NULL,                 -- 0..7
  title      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'todo',     -- upcoming | todo | awaiting | done
  type       TEXT NOT NULL DEFAULT 'admin',    -- client | statutory | admin
  urgent     INTEGER NOT NULL DEFAULT 0,       -- 0/1 flag, orthogonal to status
  position   INTEGER NOT NULL DEFAULT 0,       -- sort order WITHIN one list (see below)
  parent_id  INTEGER NULL  -> tasks.id         -- nesting (single level)
)
```

**`position` scope.** `position` orders a card *within a single list*, where a "list" is:
- for a **top-level** card: the tuple `(project_id, stage, status)` — i.e. one column of one stage;
- for a **child**: its siblings under one `parent_id`.

Positions are not global. On every drop/step, **renumber the affected list `0,1,2,…`** — at this scale (see §9) nothing fancier (fractional ranks, gap strategies) is warranted.

**Migrations.** From the v0.1 schema, this build adds — each as an **additive, idempotent migration** (`ALTER TABLE … ADD COLUMN` guarded by a column-exists check, never destructive):
1. `tasks.parent_id`;
2. `tasks.urgent`;
3. `tasks.position` *(if v0.1 lacks it)*;
4. the **status value set** changes to `upcoming | todo | awaiting | done` — any existing `'urgent'` status rows are migrated to `status='todo', urgent=1`.

(This corrects the v0.1 doc's claim that `parent_id` was the only schema change.) Enable `PRAGMA foreign_keys = ON` per connection; perform project/parent deletes explicitly in the route regardless.

---

## 7. Tech stack
- **Backend:** Python 3, Flask, Jinja templates.
- **Database:** SQLite, single file (`arckanban.db`) in the app folder, created on first run.
- **Frontend:** vanilla JS, no framework, no bundler. SortableJS vendored into `static/` for drag.
- **Persistence of drag/steps:** small JSON endpoints (`fetch`) that update status / position / parent_id / urgent / type and return ok; no page reload. **Mutating endpoints check the `Origin` header (same-origin)** — a localhost service is otherwise reachable by any page in the user's browser; cheap insurance, on-brand for a sovereign tool.
- **Run:** `pip install flask` → `python app.py` → `http://127.0.0.1:5000`.

---

## 8. Build phases (for incremental agent build)

**Phase 1 — Foundation.** Projects (create/edit/delete), templates, RIBA accordion, per-stage Kanban, add/delete task, set current stage, status moves, the spine. SQLite, Flask, the Residential Extension template. *Must be (re)established in this repo* — see *Repository state*.
*Acceptance:* create a project from template → 28 tasks laid across stages 0–7; expand a stage, move and add tasks, set current stage.

**Phase 2 — Four statuses + urgent flag + drag.** Status set = Upcoming · To Do · Awaiting · Done. Add the `urgent` flag and its redline rendering + count tally. Vendor SortableJS. Drag to reorder within a column (persist `position`) and across columns (persist `status`). ‹ › steppers as the click/touch path. Spine click navigates only; add "Set as current stage"; add the §3.9 nudge.
*Acceptance:* four columns render; urgent flag toggles and survives reload; reorder survives reload; cross-column drag and ‹ › both change status; an Awaiting card can be urgent; spine click does **not** change current stage; nudge fires on either signal; no CDN requests.

**Phase 3 — Nesting.** Add `parent_id`. Drop-onto-card nests (single level); children render as an indented checklist with done toggle and promote; nest-here zone on hover; counts exclude children; promote returns the child to the **parent's column**; delete-parent **prompts** (delete vs explode).
*Acceptance:* drag A onto B → A becomes B's child; reload preserves it; promote returns A to a top-level card in **B's column** (B's status); deleting B offers delete-children vs explode-out; B's column count is unaffected by A.

**Phase 4 — Design pass.** Implement §5 in full: titleblock header, ink-over-pencil spine, vendored Hanken Grotesk + IBM Plex Mono, palette tokens, four-column treatment, urgent/statutory card treatment, nest-zone styling, motion, reduced-motion, mobile stacking, focus states, empty states.
*Acceptance:* matches the design language on desktop and mobile; operable without drag; reduced-motion honoured; AA contrast.

**Phase 5 — Template library.** Author further templates (New Build, Loft Conversion, Garage Conversion, Listed/Conservation) as JSON. Optionally a simple in-app "save current project as template" (with a name/overwrite rule).

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

---

## Appendix A — Residential Extension template (reference)
28 tasks across stages 0–7, tagged by type. Highlights: Stage 1 — confirm CDM / Building Regulations Principal Designer appointment *(statutory)*, measured survey, planning pre-app; Stage 3 — coordinated plans, structural coordination, **submit planning application** *(statutory)*; Stage 4 — Building Regs package and submission, **party wall notices** *(statutory)*, tender info; Stage 5 — contractor appointment, Building Control inspections, discharge planning conditions; Stage 6 — completion certificate, snagging, H&S file. Full JSON ships in `templates_lib/residential_extension.json`. (Template tasks start as *To Do*, not urgent.)

## Appendix B — Prototype architecture (target structure)
Single `app.py` (routes + SQLite helpers + RIBA constants); Jinja templates (`base`, `index`, `board`); `static/style.css` + `static/board.js`; `templates_lib/*.json`. DB auto-creates on run. *(This describes the v0.1 prototype's shape and is the intended structure for Phase 1 in this repo — extend it, don't replace it, once it exists here.)*

## Appendix C — Design proposals (for your call)
Tasteful enhancements that fit the language but aren't yet committed — flagged for a yes/no/later:

- **Triage filters** in the titleblock — quiet toggles: *Urgent only*, *Statutory only*, *Hide done*. Directly serves §1 ("what's on fire / what's owed") and recovers the "see all hot items at once" benefit lost with the urgent column. *(Strong candidate.)*
- **"Awaiting — who/what"** — an optional free-text on an Awaiting card naming who it's blocked on (*"⧖ planning officer"*), shown on the card. Turns the Awaiting column from a count into an actionable chase-list. *(Strong candidate.)*
- **Home register grouping** — sort/group projects by current stage ("all my Stage 4 jobs"); the mini-spine already reads as each job's progress arc.
- **Last-updated "revision" line** in the titleblock corner (mono date) — completes the drawing-sheet metaphor.
- **Density toggle** (comfortable / compact) for practitioners who want everything on one screen.
- **Drawing-sheet border** — a thin double-hairline inset around the board edge, like a sheet border. Subtle; use with restraint.
