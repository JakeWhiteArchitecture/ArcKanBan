<div align="center">

<img src="ArcKanBan.png" alt="ArcKanban" width="440">

### An architectural project management tool based on the RIBA Plan of Work

A local-first project tracker for a sole-trader architectural practice —
**one SQLite file, one Flask app**. No cloud, no accounts, no build step.

<p>
  <img alt="Python" src="https://img.shields.io/badge/Python-3.9%2B-3776AB?logo=python&logoColor=white">
  <img alt="Flask" src="https://img.shields.io/badge/Flask-3.x-000000?logo=flask&logoColor=white">
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-single%20file-003B57?logo=sqlite&logoColor=white">
  <img alt="Local-first" src="https://img.shields.io/badge/local--first-no%20cloud-2e7d32">
  <img alt="Zero build" src="https://img.shields.io/badge/build%20step-none-blueviolet">
</p>

</div>

---

**ArcKanban** organises a building project the way an architect actually runs one —
along the **RIBA Plan of Work**. Each of the eight work stages gets its own Kanban
board page, every key choice is captured in a **decision register**, and the whole
thing runs from a single file on your own machine.

> Built for one person's workflow — a practising architect — rather than a team SaaS.
> There are no logins; reaching the app means full access, so keep it on your own
> machine or a private network. See **[DEPLOY.md](DEPLOY.md)**.

## Why it exists

Generic Kanban tools don't know what a building project *is*. ArcKanban is shaped
around the **RIBA Plan of Work 2020**, so the structure of the tool matches the
structure of the job:

- The project is a **horizontal pager** — one page per RIBA stage. You move along the
  plan of work with the `‹ ›` arrows (or `←` / `→`).
- Each page is a focused **Kanban** for that stage, with a star marking the *current*
  stage and a gentle nudge when a stage fills up and it's time to move on.
- Design-heavy stages (3 Spatial Coordination, 4 Technical Design) can be split into
  **sub-stages** — `4a / 4b / 4c` — each its own page.
- Decisions aren't just tasks — they carry options, an outcome, a decision-maker and a
  date, and roll up into a register you can email as meeting minutes.

| Stage | Name | | Stage | Name |
|:---:|---|---|:---:|---|
| **0** | Strategic Definition | | **4** | Technical Design |
| **1** | Preparation and Briefing | | **5** | Manufacturing and Construction |
| **2** | Concept Design | | **6** | Handover |
| **3** | Spatial Coordination | | **7** | Use |

A project's **appointment scope** decides which stages are in play — out-of-scope
stages are greyed and skipped.

## Features

### 🗂 The board
- **One page per stage** (several for a split stage), navigated with the pager or arrow keys.
- Six status columns: **Stage goals · Upcoming · To Do · In Progress · Awaiting · Done**.
- **Task types** — Statutory, Recommended, Process, Decision — each colour-coded down the card's edge.
- **Urgent** flag, **Awaiting-on** notes (who/what a task is waiting for), and **sections of work** to group cards within a stage.
- **Drag-and-drop** within a page (across sections and status columns), plus one-click status steppers.
- **Triage filters** (urgent / statutory / hide-done) and **search** (`/`) to jump to any task.
- Right-click a card for quick actions, including a **Move to section** fly-out.

### ✅ Decision register
- Every Decision task becomes a numbered row: **options considered**, the **confirmed outcome**, **decision-maker**, **date**, **rationale**, and the **tasks generated** from it.
- **Confirm** a decision inline (pick an option or type "Other…") and **assign** the decision-maker — without leaving the register.
- A confirmed decision is locked on the board (no accidental switching — clear it first to revisit).
- **Backdate** older decisions from a project's Config, for recording history on live jobs.

### 📤 Reports & sharing
- **Progress report** and **decisions table** export as `.eml` files — open in your mail client, ready to send as minutes.
- Full **JSON** export of the decision register and the activity log (an audit trail of every change).

### ⚙ Configuration
- **Appointment scope** — tick which RIBA stages are in play.
- **Sub-stages** — split stages 3 & 4 into up to three parts.
- **Archive** finished projects into a separate section; **reset** a project's activity log; delete with a confirm.
- **Templates** — save any project as a reusable JSON template, or start a new one from the library.

## Quickstart

```bash
pip install -r requirements.txt
python serve.py          # → http://127.0.0.1:5000
```

`serve.py` runs the app under **Waitress** and creates the database on first run, so a
fresh checkout just works. For hacking, `python app.py` starts Flask's dev server with
auto-reload. Host/port and LAN/VPN access are covered in **[DEPLOY.md](DEPLOY.md)**.

> All data lives in a single `arckanban.db` next to the code — back it up by copying that file.

## Screenshots

A one-command generator boots the app with realistic demo data and captures the main
views. It uses **Playwright Chromium**, so run it where a browser can be installed
(i.e. locally — not every CI sandbox allows the download):

```bash
pip install playwright && playwright install chromium
python tools/screenshots.py        # writes docs/img/{home,board,decisions}.png
```

It captures three views: the **register** (project cards + archived section), a **stage
board** (cards across the status columns), and the **decision register**.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `/` | Search tasks |
| `←` / `→` | Previous / next stage page |
| `Enter` / `Space` | Activate the focused control |
| `Esc` | Close any popup, menu or selection |

## Project structure

```
app.py            # the whole backend: routes, SQLite schema + migrations, helpers
serve.py          # production entrypoint (Waitress); python app.py is the dev server
templates/        # Jinja templates — board, decisions register, home/register
static/           # board.js · decisions.js · home.js · style.css · logo + fonts
templates_lib/    # reusable project templates (JSON)
tools/            # demo-data seeder + screenshot generator
REQUIREMENTS.md   # the living specification (every increment is logged here)
DEPLOY.md         # how to run it for real, and how to reach it safely
```

## How it's built

- **Single-file Flask backend** (`app.py`) over **SQLite** — no ORM, no migrations
  framework; the schema is created and additively migrated on startup.
- **Server-rendered** Jinja with small vanilla-JS enhancers — no framework, no bundler.
- Stable **UUIDs** on projects, sections and tasks, so exports and links survive id reuse.
- The full, versioned specification lives in **[REQUIREMENTS.md](REQUIREMENTS.md)** — it's
  the source of truth and records every change as a numbered changelog.

---

<div align="center">
<sub>ArcKanban · local-first project management for architects · built around the RIBA Plan of Work</sub>
</div>
