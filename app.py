"""
ArcKanban — a project tracker for a sole-trader architectural practice.

Single-file Flask app over SQLite. Local-first, no cloud, no build step.
See REQUIREMENTS.md for the full specification. This module covers projects,
templates, the horizontally-paged RIBA board, section swimlanes, the four-column
per-stage Kanban, the urgent flag, awaiting-on notes, triage filters, the
stage-advancement nudge, status moves via the steppers, and drag (within a
stage, across sections and status columns).

Parent/child task nesting arrives in the next increment.
"""

import json
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from flask import (
    Flask,
    flash,
    g,
    jsonify,
    make_response,
    redirect,
    render_template,
    request,
    url_for,
)

# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(APP_DIR, "arckanban.db")
TEMPLATES_LIB = os.path.join(APP_DIR, "templates_lib")

# The eight stages of the RIBA Plan of Work 2020 (fixed, index 0..7).
RIBA_STAGES = [
    "Strategic Definition",
    "Preparation and Briefing",
    "Concept Design",
    "Spatial Coordination",
    "Technical Design",
    "Manufacturing and Construction",
    "Handover",
    "Use",
]

# Status columns, left to right. Order matters: the ‹ › steppers walk this list.
STATUSES = ["backlog", "upcoming", "todo", "awaiting", "done"]
STATUS_LABELS = {
    "backlog": "Backlog",
    "upcoming": "Upcoming",
    "todo": "To Do",
    "awaiting": "Awaiting",
    "done": "Done",
}

# Task categories. 'decision' carries a responsible person (like Awaiting's
# who/what) shown in any column; 'statutory' is the legal-teeth one (redline).
TYPES = ["statutory", "recommended", "process", "decision"]
TYPE_LABELS = {"statutory": "Statutory", "recommended": "Recommended", "process": "Process", "decision": "Decision"}

# The person credited in the activity log. Single-user for now; override with
# ARCKANBAN_ACTOR. (Will become per-user when the .md-file linking lands.)
ACTOR = os.environ.get("ARCKANBAN_ACTOR", "JW")

app = Flask(__name__)
# Local single-user app: a fixed dev key is sufficient (only used for flash()).
app.secret_key = "arckanban-local"


# --------------------------------------------------------------------------- #
# Database
# --------------------------------------------------------------------------- #

def get_db():
    """Return the per-request SQLite connection (foreign keys enforced)."""
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        # SQLite does not enforce foreign keys unless asked, per connection.
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def _columns(db, table):
    # PRAGMA table_info columns: (cid, name, type, ...) — name is index 1.
    return {row[1] for row in db.execute(f"PRAGMA table_info({table})")}


def _ensure_column(db, table, name, ddl):
    """Additive, idempotent migration — add a column only if it's missing."""
    if name not in _columns(db, table):
        db.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")


def init_db():
    """Create tables on first run; apply additive migrations otherwise."""
    db = sqlite3.connect(DB_PATH)
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS projects (
            id            INTEGER PRIMARY KEY,
            number        TEXT,
            name          TEXT NOT NULL,
            template      TEXT,
            current_stage INTEGER NOT NULL DEFAULT 0,
            created_at    TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sections (
            id         INTEGER PRIMARY KEY,
            project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            stage      INTEGER NOT NULL,
            title      TEXT NOT NULL,
            position   INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS tasks (
            id          INTEGER PRIMARY KEY,
            project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            stage       INTEGER NOT NULL,
            title       TEXT NOT NULL,
            status      TEXT NOT NULL DEFAULT 'todo',
            type        TEXT NOT NULL DEFAULT 'recommended',
            urgent      INTEGER NOT NULL DEFAULT 0,
            awaiting_on TEXT,
            position    INTEGER NOT NULL DEFAULT 0,
            section_id  INTEGER REFERENCES sections(id) ON DELETE SET NULL,
            parent_id   INTEGER REFERENCES tasks(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS events (
            id         INTEGER PRIMARY KEY,
            project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            actor      TEXT NOT NULL,
            verb       TEXT NOT NULL,
            target     TEXT,
            detail     TEXT,
            created_at TEXT NOT NULL,
            important  INTEGER NOT NULL DEFAULT 1
        );
        """
    )
    # Additive migrations for an existing v0.1-shaped database (see REQUIREMENTS §6).
    _ensure_column(db, "tasks", "urgent", "urgent INTEGER NOT NULL DEFAULT 0")
    _ensure_column(db, "tasks", "awaiting_on", "awaiting_on TEXT")
    _ensure_column(db, "tasks", "position", "position INTEGER NOT NULL DEFAULT 0")
    _ensure_column(db, "tasks", "section_id", "section_id INTEGER REFERENCES sections(id)")
    _ensure_column(db, "tasks", "parent_id", "parent_id INTEGER REFERENCES tasks(id)")
    # Stable external UUIDs (for the future share loop + .md linking) and the
    # per-project RIBA-stage scope (which stages are in the appointment).
    _ensure_column(db, "projects", "uid", "uid TEXT")
    _ensure_column(db, "sections", "uid", "uid TEXT")
    _ensure_column(db, "tasks", "uid", "uid TEXT")
    _ensure_column(db, "projects", "stages", "stages TEXT")  # CSV of enabled stage indices; NULL = all
    _ensure_column(db, "events", "task_id", "task_id INTEGER")  # link an event to its task (dedup + .md export)
    # Two-tier log: the table is the full audit trail; important=1 marks the
    # curated milestones shown in the drawer (created / completed / deleted),
    # while minor moves (backlog→upcoming, section/type tweaks) stay important=0.
    _ensure_column(db, "events", "important", "important INTEGER NOT NULL DEFAULT 1")
    for tbl in ("projects", "sections", "tasks"):
        db.execute("UPDATE %s SET uid = lower(hex(randomblob(16))) WHERE uid IS NULL OR uid = ''" % tbl)
    db.executescript(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_uid ON projects(uid);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_sections_uid ON sections(uid);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_uid ON tasks(uid);
        CREATE TRIGGER IF NOT EXISTS projects_uid AFTER INSERT ON projects WHEN NEW.uid IS NULL
          BEGIN UPDATE projects SET uid = lower(hex(randomblob(16))) WHERE id = NEW.id; END;
        CREATE TRIGGER IF NOT EXISTS sections_uid AFTER INSERT ON sections WHEN NEW.uid IS NULL
          BEGIN UPDATE sections SET uid = lower(hex(randomblob(16))) WHERE id = NEW.id; END;
        CREATE TRIGGER IF NOT EXISTS tasks_uid AFTER INSERT ON tasks WHEN NEW.uid IS NULL
          BEGIN UPDATE tasks SET uid = lower(hex(randomblob(16))) WHERE id = NEW.id; END;
        """
    )
    # Old 'urgent' status rows (if any) become To Do + the urgent flag.
    db.execute("UPDATE tasks SET status='todo', urgent=1 WHERE status='urgent'")
    # Map old categories to the new set (client→recommended, admin→process); unknown → recommended.
    db.execute("UPDATE tasks SET type='recommended' WHERE type='client'")
    db.execute("UPDATE tasks SET type='process' WHERE type='admin'")
    db.execute("UPDATE tasks SET type='recommended' WHERE type NOT IN ('statutory','recommended','process','decision')")
    db.commit()
    db.close()


# --------------------------------------------------------------------------- #
# Templates library (JSON files in templates_lib/)
# --------------------------------------------------------------------------- #

def list_templates():
    """Discover template files. Fail soft — a broken file is skipped."""
    found = []
    if not os.path.isdir(TEMPLATES_LIB):
        return found
    for fn in sorted(os.listdir(TEMPLATES_LIB)):
        if not fn.endswith(".json"):
            continue
        try:
            with open(os.path.join(TEMPLATES_LIB, fn), encoding="utf-8") as fh:
                data = json.load(fh)
            found.append({"file": fn, "name": data.get("name", fn)})
        except (OSError, ValueError):
            # Broken template must not crash the app.
            continue
    return found


def load_template(filename):
    """Return a validated template dict, or None if unreadable/invalid."""
    if not filename or "/" in filename or "\\" in filename:
        return None
    path = os.path.join(TEMPLATES_LIB, filename)
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return None
    tasks = []
    for t in data.get("tasks", []):
        try:
            stage = int(t["stage"])
            title = str(t["title"]).strip()
        except (KeyError, TypeError, ValueError):
            continue
        if not title or not (0 <= stage <= 7):
            continue
        ttype = t.get("type", "recommended")
        if ttype not in TYPES:
            ttype = "recommended"
        section = t.get("section")
        section = str(section).strip() if section else None
        status = t.get("status")
        status = status if status in STATUSES else "todo"
        tasks.append({"stage": stage, "title": title, "type": ttype, "section": section, "status": status})
    return {"name": data.get("name", filename), "tasks": tasks}


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def format_event(e):
    """Render one event row/dict as a plain-English line + timestamp."""
    parts = [e["actor"], e["verb"]]
    if e["target"]:
        parts.append("“" + e["target"] + "”")
    if e["detail"]:
        parts.append(e["detail"])
    try:
        when = datetime.fromisoformat(e["created_at"]).strftime("%d %b %Y · %H:%M")
    except (ValueError, TypeError):
        when = e["created_at"]
    return {"text": " ".join(parts), "when": when, "iso": e["created_at"]}


def log_event(db, project_id, verb, target=None, detail=None, task_id=None, important=True):
    """Record one activity event (person → action → task/section). The events
    table is the FULL audit trail (every change, for later agent use); the
    `important` flag marks the curated milestones surfaced in the drawer.
    Returns the rendered event when important (so the endpoint can hand it to
    the drawer), or None when it's full-log-only."""
    ts = now_iso()
    db.execute(
        "INSERT INTO events (project_id, actor, verb, target, detail, created_at, task_id, important) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (project_id, ACTOR, verb, target, detail, ts, task_id, 1 if important else 0),
    )
    if not important:
        return None
    return format_event({"actor": ACTOR, "verb": verb, "target": target,
                         "detail": detail, "created_at": ts})


def log_status(db, row, new_status):
    """Log a status change. Reaching Done is a curated milestone ('completed');
    every other move (backlog→upcoming, etc.) is full-log-only. If a task leaves
    Done within 10 minutes of being completed, retract the 'completed' line from
    the visible log (it stays in the full audit trail).
    Returns (event_or_None, omitted_bool)."""
    old = row["status"]
    if new_status == old:
        return None, False
    if old == "done" and new_status != "done":
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat(timespec="seconds")
        prev = db.execute(
            "SELECT id FROM events WHERE task_id=? AND verb='completed' AND important=1 "
            "AND created_at>=? ORDER BY id DESC LIMIT 1",
            (row["id"], cutoff),
        ).fetchone()
        if prev:
            db.execute("UPDATE events SET important=0 WHERE id=?", (prev["id"],))   # keep in full log, hide from drawer
            log_event(db, row["project_id"], "set", row["title"],
                      'to “%s”' % STATUS_LABELS[new_status], task_id=row["id"], important=False)
            return None, True
    if new_status == "done":
        ev = log_event(db, row["project_id"], "completed", row["title"], task_id=row["id"])
    else:
        ev = log_event(db, row["project_id"], "set", row["title"],
                       'to “%s”' % STATUS_LABELS[new_status], task_id=row["id"], important=False)
    return ev, False


def task_update_event(db, row, data):
    """Pick the single most meaningful event for a task update.
    Returns (event_or_None, omitted_bool)."""
    pid, title, tid = row["project_id"], row["title"], row["id"]
    if "status" in data and data["status"] != row["status"]:
        return log_status(db, row, data["status"])
    if "section_id" in data:
        sid = data["section_id"] or None
        try:
            sid = int(sid) if sid is not None else None
        except (TypeError, ValueError):
            sid = None
        if sid != row["section_id"]:
            if sid is None:
                return log_event(db, pid, "moved", title, "out to General", task_id=tid, important=False), False
            nm = db.execute("SELECT title FROM sections WHERE id=?", (sid,)).fetchone()
            return log_event(db, pid, "moved", title, "into “%s”" % (nm["title"] if nm else "section"), task_id=tid, important=False), False
    if "urgent" in data and bool(data["urgent"]) != bool(row["urgent"]):
        ev = (log_event(db, pid, "flagged", title, "as urgent", task_id=tid, important=False) if data["urgent"]
              else log_event(db, pid, "unflagged", title, task_id=tid, important=False))
        return ev, False
    if "type" in data and data["type"] != row["type"]:
        return log_event(db, pid, "retagged", title, "as " + TYPE_LABELS[data["type"]], task_id=tid, important=False), False
    return None, False


def next_position(db, project_id, stage, status, section_id, parent_id=None):
    """Next sort position at the end of one list (project, stage, section, status)."""
    row = db.execute(
        """SELECT COALESCE(MAX(position) + 1, 0) AS p FROM tasks
           WHERE project_id=? AND stage=? AND status=? AND section_id IS ? AND parent_id IS ?""",
        (project_id, stage, status, section_id, parent_id),
    ).fetchone()
    return row["p"]


def task_to_dict(row):
    return {
        "id": row["id"],
        "uid": row["uid"],
        "stage": row["stage"],
        "title": row["title"],
        "status": row["status"],
        "type": row["type"],
        "urgent": bool(row["urgent"]),
        "awaiting_on": row["awaiting_on"] or "",
        "position": row["position"],
        "section_id": row["section_id"],
        "parent_id": row["parent_id"],
    }


def section_in_stage(db, section_id, project_id, stage):
    """True if section_id is None, or a section of this project in this stage."""
    if section_id is None:
        return True
    row = db.execute(
        "SELECT 1 FROM sections WHERE id=? AND project_id=? AND stage=?",
        (section_id, project_id, stage),
    ).fetchone()
    return row is not None


def enabled_stages(project_row):
    """Set of RIBA stages in the project's appointment scope (NULL/empty = all)."""
    raw = project_row["stages"] if "stages" in project_row.keys() else None
    if not raw:
        return set(range(8))
    try:
        out = {int(x) for x in raw.split(",") if x.strip() != ""}
    except ValueError:
        return set(range(8))
    return out or set(range(8))


def get_project_or_404(db, project_id):
    row = db.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    if row is None:
        from werkzeug.exceptions import NotFound

        raise NotFound()
    return row


def build_lane(section_id, title, stage_rows):
    """One swimlane: a section's (or the loose 'General' lane's) status columns."""
    columns = {s: [] for s in STATUSES}
    urgent = done = total = 0
    for r in stage_rows:
        if r["section_id"] != section_id:
            continue
        columns[r["status"]].append(task_to_dict(r))
        total += 1
        if r["urgent"]:
            urgent += 1
        if r["status"] == "done":
            done += 1
    return {
        "id": section_id,
        "title": title,
        "columns": columns,
        "counts": {"urgent": urgent, "done_n": done, "total": total},
    }


def build_stages(db, project_id):
    """Build both layouts per stage: section swimlanes AND status-primary
    columns-with-section-bubbles. The chosen layout is picked in the template."""
    sections = db.execute(
        "SELECT * FROM sections WHERE project_id=? ORDER BY stage, position, id",
        (project_id,),
    ).fetchall()
    rows = db.execute(
        """SELECT * FROM tasks WHERE project_id=? AND parent_id IS NULL
           ORDER BY stage, position, id""",
        (project_id,),
    ).fetchall()
    by_stage = {}
    for s in sections:
        by_stage.setdefault(s["stage"], []).append(s)

    stages = []
    for idx, name in enumerate(RIBA_STAGES):
        stage_rows = [r for r in rows if r["stage"] == idx]
        secs = by_stage.get(idx, [])

        # Swimlane layout: section lanes (+ loose 'General'), each with 4 columns.
        lanes = [build_lane(s["id"], s["title"], stage_rows) for s in secs]
        lanes.append(build_lane(None, None, stage_rows))

        # Grouped layout: 4 status columns, each grouping cards into section bubbles.
        pos_of = {s["id"]: i for i, s in enumerate(secs)}
        grouped = {}
        for st in STATUSES:
            bubbles = []
            for s in secs:
                tl = [task_to_dict(r) for r in stage_rows
                      if r["section_id"] == s["id"] and r["status"] == st]
                if tl:
                    bubbles.append({"id": s["id"], "title": s["title"],
                                    "pos": pos_of[s["id"]], "tasks": tl})
            loose = [task_to_dict(r) for r in stage_rows
                     if r["section_id"] is None and r["status"] == st]
            grouped[st] = {"bubbles": bubbles, "loose": loose,
                           "count": len(loose) + sum(len(b["tasks"]) for b in bubbles)}

        # Section meta (for the grouped section bar): per-section roll-up.
        sec_meta = []
        for i, s in enumerate(secs):
            st_rows = [r for r in stage_rows if r["section_id"] == s["id"]]
            sec_meta.append({"id": s["id"], "title": s["title"], "pos": i,
                             "total": len(st_rows),
                             "done": sum(1 for r in st_rows if r["status"] == "done")})

        counts = {st: sum(len(l["columns"][st]) for l in lanes) for st in STATUSES}
        counts["urgent"] = sum(l["counts"]["urgent"] for l in lanes)
        stages.append({"idx": idx, "name": name, "lanes": lanes, "grouped": grouped,
                       "sections": sec_meta, "counts": counts})
    return stages


def render_lane(lane, stage_idx):
    """Render one swimlane partial (used when a section is created)."""
    return render_template(
        "_lane.html", lane=lane, stage_idx=stage_idx,
        status_labels=STATUS_LABELS, type_labels=TYPE_LABELS, statuses=STATUSES,
    )


def build_template_export(db, project_id, name="Untitled template"):
    """A reusable template from a project's structure — tasks, sections, types
    and statuses only. Excludes the project name and any people (awaiting/
    decision-by), urgent flags and ids — so it's a clean, shareable starting point."""
    secs = {r["id"]: r["title"] for r in
            db.execute("SELECT id, title FROM sections WHERE project_id=?", (project_id,))}
    rows = db.execute(
        "SELECT * FROM tasks WHERE project_id=? AND parent_id IS NULL ORDER BY stage, position, id",
        (project_id,),
    ).fetchall()
    tasks = []
    for r in rows:
        t = {"stage": r["stage"], "title": r["title"], "type": r["type"], "status": r["status"]}
        if r["section_id"] and r["section_id"] in secs:
            t["section"] = secs[r["section_id"]]
        tasks.append(t)
    return {"name": name, "tasks": tasks}


def mini_spine(current_stage):
    """Read-only spine cells for the home register."""
    cells = []
    for i in range(8):
        state = "current" if i == current_stage else ("past" if i < current_stage else "future")
        cells.append({"idx": i, "state": state})
    return cells


# --------------------------------------------------------------------------- #
# Security: reject cross-origin writes (cheap insurance for a localhost service)
# --------------------------------------------------------------------------- #

@app.before_request
def block_cross_origin_writes():
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        origin = request.headers.get("Origin")
        if origin and urlparse(origin).netloc != request.host:
            return ("Cross-origin request refused.", 403)
    return None


# --------------------------------------------------------------------------- #
# Page routes
# --------------------------------------------------------------------------- #

@app.route("/")
def index():
    db = get_db()
    rows = db.execute("SELECT * FROM projects ORDER BY id DESC").fetchall()
    projects = []
    for r in rows:
        projects.append(
            {
                "id": r["id"],
                "number": r["number"] or "",
                "name": r["name"],
                "current_stage": r["current_stage"],
                "current_stage_name": RIBA_STAGES[r["current_stage"]],
                "spine": mini_spine(r["current_stage"]),
            }
        )
    return render_template("index.html", projects=projects, templates=list_templates())


@app.route("/projects", methods=["POST"])
def create_project():
    db = get_db()
    number = (request.form.get("number") or "").strip()
    name = (request.form.get("name") or "").strip()
    template_file = request.form.get("template") or ""
    if not name:
        flash("A project needs a name.")
        return redirect(url_for("index"))

    cur = db.execute(
        "INSERT INTO projects (number, name, template, current_stage, created_at) "
        "VALUES (?, ?, ?, 0, ?)",
        (number, name, template_file or None, now_iso()),
    )
    project_id = cur.lastrowid

    log_event(db, project_id, "created project", name)
    if template_file and template_file != "__blank__":
        tpl = load_template(template_file)
        if tpl is None:
            flash("That template could not be read — created a blank project instead.")
        else:
            section_ids = {}      # (stage, name) -> section id
            sec_pos = {}          # stage -> next section position
            pos_by_lane = {}      # (stage, section_id) -> next task position
            for t in tpl["tasks"]:
                stage, sname = t["stage"], t.get("section")
                section_id = None
                if sname:
                    key = (stage, sname)
                    if key not in section_ids:
                        p = sec_pos.get(stage, 0)
                        sec_pos[stage] = p + 1
                        cur2 = db.execute(
                            "INSERT INTO sections (project_id, stage, title, position) "
                            "VALUES (?, ?, ?, ?)",
                            (project_id, stage, sname, p),
                        )
                        section_ids[key] = cur2.lastrowid
                    section_id = section_ids[key]
                lane = (stage, section_id, t["status"])
                pos = pos_by_lane.get(lane, 0)
                pos_by_lane[lane] = pos + 1
                db.execute(
                    "INSERT INTO tasks (project_id, stage, title, status, type, "
                    "position, section_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (project_id, stage, t["title"], t["status"], t["type"], pos, section_id),
                )
    db.commit()
    return redirect(url_for("board", project_id=project_id))


@app.route("/projects/<int:project_id>")
def board(project_id):
    db = get_db()
    p = get_project_or_404(db, project_id)
    layout = "grouped"  # status-primary is the only layout
    en = enabled_stages(p)
    stages = build_stages(db, project_id)
    for s in stages:
        s["enabled"] = s["idx"] in en
    ev_rows = db.execute(
        "SELECT * FROM events WHERE project_id=? AND important=1 ORDER BY id DESC LIMIT 200", (project_id,)
    ).fetchall()
    resp = make_response(render_template(
        "board.html",
        project={
            "id": p["id"],
            "number": p["number"] or "",
            "name": p["name"],
            "current_stage": p["current_stage"],
        },
        stages=stages,
        status_labels=STATUS_LABELS,
        type_labels=TYPE_LABELS,
        statuses=STATUSES,
        layout=layout,
        events=[format_event(e) for e in reversed(ev_rows)],  # oldest→newest (latest at bottom)
        enabled=sorted(en),
        riba=RIBA_STAGES,
    ))
    return resp


@app.route("/projects/<int:project_id>/template.json")
def export_template(project_id):
    """Download the project as a reusable template JSON (no names/people)."""
    db = get_db()
    get_project_or_404(db, project_id)
    data = build_template_export(db, project_id)
    resp = make_response(json.dumps(data, indent=2, ensure_ascii=False))
    resp.headers["Content-Type"] = "application/json"
    resp.headers["Content-Disposition"] = 'attachment; filename="arckanban-template.json"'
    return resp


@app.route("/projects/<int:project_id>/activity.json")
def export_activity(project_id):
    """Download the FULL activity log — every event, including the minor moves
    (backlog→upcoming, section/type tweaks) hidden from the drawer. This is the
    audit trail meant to be handed to an agent later for practice automation."""
    db = get_db()
    get_project_or_404(db, project_id)
    rows = db.execute(
        "SELECT * FROM events WHERE project_id=? ORDER BY id ASC", (project_id,)
    ).fetchall()
    data = {
        "project_id": project_id,
        "exported_at": now_iso(),
        "count": len(rows),
        "events": [{
            "actor": r["actor"], "verb": r["verb"], "target": r["target"],
            "detail": r["detail"], "at": r["created_at"], "task_id": r["task_id"],
            "important": bool(r["important"]), "text": format_event(r)["text"],
        } for r in rows],
    }
    resp = make_response(json.dumps(data, indent=2, ensure_ascii=False))
    resp.headers["Content-Type"] = "application/json"
    resp.headers["Content-Disposition"] = 'attachment; filename="arckanban-activity.json"'
    return resp


@app.route("/projects/<int:project_id>/delete", methods=["POST"])
def delete_project(project_id):
    db = get_db()
    get_project_or_404(db, project_id)
    # Explicit deletes — don't rely solely on cascade (see REQUIREMENTS §3.1).
    db.execute("DELETE FROM tasks WHERE project_id=?", (project_id,))
    db.execute("DELETE FROM projects WHERE id=?", (project_id,))
    db.commit()
    flash("Project deleted.")
    return redirect(url_for("index"))


# --------------------------------------------------------------------------- #
# JSON API (fetch endpoints — return ok, no page reload)
# --------------------------------------------------------------------------- #

@app.route("/api/projects/<int:project_id>", methods=["POST"])
def api_update_project(project_id):
    db = get_db()
    get_project_or_404(db, project_id)
    data = request.get_json(silent=True) or {}
    fields, values = [], []
    if "number" in data:
        fields.append("number=?")
        values.append((data["number"] or "").strip())
    if "name" in data:
        name = (data["name"] or "").strip()
        if not name:
            return jsonify(ok=False, error="Name cannot be empty."), 400
        fields.append("name=?")
        values.append(name)
    if fields:
        values.append(project_id)
        db.execute(f"UPDATE projects SET {', '.join(fields)} WHERE id=?", values)
        db.commit()
    return jsonify(ok=True)


@app.route("/api/projects/<int:project_id>/current_stage", methods=["POST"])
def api_set_current_stage(project_id):
    db = get_db()
    get_project_or_404(db, project_id)
    data = request.get_json(silent=True) or {}
    try:
        stage = int(data["stage"])
    except (KeyError, TypeError, ValueError):
        return jsonify(ok=False, error="Invalid stage."), 400
    if not 0 <= stage <= 7:
        return jsonify(ok=False, error="Stage out of range."), 400
    db.execute("UPDATE projects SET current_stage=? WHERE id=?", (stage, project_id))
    ev = log_event(db, project_id, "set current stage", None, "to %d · %s" % (stage, RIBA_STAGES[stage]))
    db.commit()
    return jsonify(ok=True, current_stage=stage, event=ev)


@app.route("/api/projects/<int:project_id>/stages", methods=["POST"])
def api_set_stages(project_id):
    """Set the project's RIBA-stage scope (which stages are in the appointment)."""
    db = get_db()
    p = get_project_or_404(db, project_id)
    data = request.get_json(silent=True) or {}
    raw = data.get("stages")
    if not isinstance(raw, list):
        return jsonify(ok=False, error="Invalid scope."), 400
    try:
        stages = sorted({int(x) for x in raw if 0 <= int(x) <= 7})
    except (TypeError, ValueError):
        return jsonify(ok=False, error="Invalid scope."), 400
    if not stages:
        return jsonify(ok=False, error="At least one stage must stay in scope."), 400
    # If the current stage falls out of scope, move it to the lowest in-scope stage.
    new_current = p["current_stage"]
    if new_current not in stages:
        new_current = stages[0]
        db.execute("UPDATE projects SET current_stage=? WHERE id=?", (new_current, project_id))
    db.execute("UPDATE projects SET stages=? WHERE id=?",
               (",".join(str(s) for s in stages), project_id))
    ev = log_event(db, project_id, "updated appointment scope", None, "(%d of 8 stages)" % len(stages), important=False)
    db.commit()
    return jsonify(ok=True, stages=stages, current_stage=new_current, event=ev)


@app.route("/api/projects/<int:project_id>/tasks", methods=["POST"])
def api_add_task(project_id):
    db = get_db()
    get_project_or_404(db, project_id)
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify(ok=False, error="A task needs a title."), 400
    try:
        stage = int(data.get("stage"))
    except (TypeError, ValueError):
        return jsonify(ok=False, error="Invalid stage."), 400
    if not 0 <= stage <= 7:
        return jsonify(ok=False, error="Stage out of range."), 400
    ttype = data.get("type", "recommended")
    if ttype not in TYPES:
        ttype = "recommended"
    status = data.get("status", "todo")
    if status not in STATUSES:
        status = "todo"
    section_id = data.get("section_id") or None
    if section_id is not None:
        try:
            section_id = int(section_id)
        except (TypeError, ValueError):
            return jsonify(ok=False, error="Invalid section."), 400
        if not section_in_stage(db, section_id, project_id, stage):
            return jsonify(ok=False, error="Section not in this stage."), 400
    pos = next_position(db, project_id, stage, status, section_id)
    cur = db.execute(
        "INSERT INTO tasks (project_id, stage, title, status, type, position, section_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (project_id, stage, title, status, ttype, pos, section_id),
    )
    ev = log_event(db, project_id, "added", title, "to " + STATUS_LABELS[status], task_id=cur.lastrowid)
    db.commit()
    row = db.execute("SELECT * FROM tasks WHERE id=?", (cur.lastrowid,)).fetchone()
    html = render_template("_card.html", t=task_to_dict(row),
                           status_labels=STATUS_LABELS, type_labels=TYPE_LABELS,
                           statuses=STATUSES)
    return jsonify(ok=True, task=task_to_dict(row), html=html, event=ev)


@app.route("/api/projects/<int:project_id>/tasks/restore", methods=["POST"])
def api_restore_task(project_id):
    """Re-create a deleted task from its captured fields (used by Undo)."""
    db = get_db()
    get_project_or_404(db, project_id)
    d = request.get_json(silent=True) or {}
    title = (d.get("title") or "").strip()
    try:
        stage = int(d.get("stage"))
    except (TypeError, ValueError):
        return jsonify(ok=False, error="Invalid stage."), 400
    if not title or not 0 <= stage <= 7:
        return jsonify(ok=False, error="Nothing to restore."), 400
    ttype = d.get("type") if d.get("type") in TYPES else "recommended"
    status = d.get("status") if d.get("status") in STATUSES else "todo"
    urgent = 1 if d.get("urgent") else 0
    awaiting_on = (d.get("awaiting_on") or "").strip() or None
    section_id = d.get("section_id") or None
    if section_id is not None:
        try:
            section_id = int(section_id)
        except (TypeError, ValueError):
            section_id = None
        if section_id is not None and not section_in_stage(db, section_id, project_id, stage):
            section_id = None
    pos = next_position(db, project_id, stage, status, section_id)
    cur = db.execute(
        "INSERT INTO tasks (project_id, stage, title, status, type, urgent, awaiting_on, position, section_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (project_id, stage, title, status, ttype, urgent, awaiting_on, pos, section_id),
    )
    ev = log_event(db, project_id, "restored", title, task_id=cur.lastrowid)
    db.commit()
    row = db.execute("SELECT * FROM tasks WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify(ok=True, task=task_to_dict(row), event=ev)


@app.route("/api/tasks/<int:task_id>", methods=["POST"])
def api_update_task(task_id):
    db = get_db()
    row = db.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if row is None:
        return jsonify(ok=False, error="No such task."), 404
    data = request.get_json(silent=True) or {}
    fields, values = [], []

    if "title" in data:
        title = (data["title"] or "").strip()
        if not title:
            return jsonify(ok=False, error="Title cannot be empty."), 400
        fields.append("title=?")
        values.append(title)

    if "type" in data:
        ttype = data["type"]
        if ttype not in TYPES:
            return jsonify(ok=False, error="Invalid type."), 400
        fields.append("type=?")
        values.append(ttype)

    if "urgent" in data:
        fields.append("urgent=?")
        values.append(1 if data["urgent"] else 0)

    if "awaiting_on" in data:
        fields.append("awaiting_on=?")
        values.append((data["awaiting_on"] or "").strip() or None)

    # Status and/or section change → reposition once at the end of the target column.
    new_status, new_section, reposition = row["status"], row["section_id"], False
    if "status" in data:
        if data["status"] not in STATUSES:
            return jsonify(ok=False, error="Invalid status."), 400
        new_status = data["status"]
        fields.append("status=?"); values.append(new_status); reposition = True
    if "section_id" in data:
        sid = data["section_id"] or None
        if sid is not None:
            try:
                sid = int(sid)
            except (TypeError, ValueError):
                return jsonify(ok=False, error="Invalid section."), 400
            if not section_in_stage(db, sid, row["project_id"], row["stage"]):
                return jsonify(ok=False, error="Section not in this stage."), 400
        new_section = sid
        fields.append("section_id=?"); values.append(new_section); reposition = True
    if reposition:
        fields.append("position=?")
        values.append(next_position(db, row["project_id"], row["stage"], new_status, new_section))

    if not fields:
        return jsonify(ok=True)

    values.append(task_id)
    db.execute(f"UPDATE tasks SET {', '.join(fields)} WHERE id=?", values)
    ev, omit = task_update_event(db, row, data)
    db.commit()
    new_row = db.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    return jsonify(ok=True, task=task_to_dict(new_row), event=ev, omit_last=omit)


@app.route("/api/tasks/<int:task_id>/move", methods=["POST"])
def api_move_task(task_id):
    """Drag: set status + section, then renumber the destination column 0..n."""
    db = get_db()
    row = db.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if row is None:
        return jsonify(ok=False, error="No such task."), 404
    data = request.get_json(silent=True) or {}
    status = data.get("status")
    if status not in STATUSES:
        return jsonify(ok=False, error="Invalid status."), 400
    section_id = data.get("section_id") or None
    if section_id is not None:
        try:
            section_id = int(section_id)
        except (TypeError, ValueError):
            return jsonify(ok=False, error="Invalid section."), 400
    # Sections live within a stage — a task never moves stage by drag.
    if not section_in_stage(db, section_id, row["project_id"], row["stage"]):
        return jsonify(ok=False, error="Section not in this stage."), 400
    try:
        index = int(data.get("index", 0))
    except (TypeError, ValueError):
        index = 0

    db.execute("UPDATE tasks SET status=?, section_id=? WHERE id=?", (status, section_id, task_id))
    siblings = [r["id"] for r in db.execute(
        """SELECT id FROM tasks WHERE project_id=? AND stage=? AND status=? AND section_id IS ?
           AND parent_id IS NULL AND id<>? ORDER BY position, id""",
        (row["project_id"], row["stage"], status, section_id, task_id),
    )]
    index = max(0, min(index, len(siblings)))
    siblings.insert(index, task_id)
    for i, tid in enumerate(siblings):
        db.execute("UPDATE tasks SET position=? WHERE id=?", (i, tid))
    ev, omit = None, False
    if status != row["status"]:
        ev, omit = log_status(db, row, status)
    elif section_id != row["section_id"]:
        if section_id is None:
            ev = log_event(db, row["project_id"], "moved", row["title"], "out to General", task_id=task_id, important=False)
        else:
            nm = db.execute("SELECT title FROM sections WHERE id=?", (section_id,)).fetchone()
            ev = log_event(db, row["project_id"], "moved", row["title"], "into “%s”" % (nm["title"] if nm else "section"), task_id=task_id, important=False)
    db.commit()
    new_row = db.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    return jsonify(ok=True, task=task_to_dict(new_row), event=ev, omit_last=omit)


@app.route("/api/projects/<int:project_id>/sections", methods=["POST"])
def api_add_section(project_id):
    db = get_db()
    get_project_or_404(db, project_id)
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify(ok=False, error="A section needs a title."), 400
    try:
        stage = int(data.get("stage"))
    except (TypeError, ValueError):
        return jsonify(ok=False, error="Invalid stage."), 400
    if not 0 <= stage <= 7:
        return jsonify(ok=False, error="Stage out of range."), 400
    p = db.execute(
        "SELECT COALESCE(MAX(position)+1,0) AS p FROM sections WHERE project_id=? AND stage=?",
        (project_id, stage),
    ).fetchone()["p"]
    cur = db.execute(
        "INSERT INTO sections (project_id, stage, title, position) VALUES (?, ?, ?, ?)",
        (project_id, stage, title, p),
    )
    ev = log_event(db, project_id, "created section", title, important=False)
    db.commit()
    lane = build_lane(cur.lastrowid, title, [])
    return jsonify(ok=True, section={"id": cur.lastrowid, "stage": stage, "title": title},
                   html=render_lane(lane, stage), event=ev)


@app.route("/api/sections/<int:section_id>", methods=["POST"])
def api_update_section(section_id):
    db = get_db()
    row = db.execute("SELECT * FROM sections WHERE id=?", (section_id,)).fetchone()
    if row is None:
        return jsonify(ok=False, error="No such section."), 404
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify(ok=False, error="Title cannot be empty."), 400
    ev = log_event(db, row["project_id"], "renamed section", title, "(was “%s”)" % row["title"], important=False)
    db.execute("UPDATE sections SET title=? WHERE id=?", (title, section_id))
    db.commit()
    return jsonify(ok=True, title=title, event=ev)


@app.route("/api/sections/<int:section_id>/delete", methods=["POST"])
def api_delete_section(section_id):
    db = get_db()
    row = db.execute("SELECT * FROM sections WHERE id=?", (section_id,)).fetchone()
    if row is None:
        return jsonify(ok=False, error="No such section."), 404
    # Orphan the section's tasks to the loose 'General' lane, then delete the section.
    ev = log_event(db, row["project_id"], "deleted section", row["title"], important=False)
    db.execute("UPDATE tasks SET section_id=NULL WHERE section_id=?", (section_id,))
    db.execute("DELETE FROM sections WHERE id=?", (section_id,))
    db.commit()
    return jsonify(ok=True, event=ev)


@app.route("/api/sections/<int:section_id>/move", methods=["POST"])
def api_move_section(section_id):
    """Move a whole section's tasks from one status to another (bulk), gluing
    them onto any of the section's tasks already in the destination status."""
    db = get_db()
    row = db.execute("SELECT * FROM sections WHERE id=?", (section_id,)).fetchone()
    if row is None:
        return jsonify(ok=False, error="No such section."), 404
    data = request.get_json(silent=True) or {}
    frm, to = data.get("from_status"), data.get("to_status")
    if frm not in STATUSES or to not in STATUSES:
        return jsonify(ok=False, error="Invalid status."), 400
    if frm == to:
        return jsonify(ok=True, moved=[])
    moved = [r["id"] for r in db.execute(
        "SELECT id FROM tasks WHERE section_id=? AND status=? AND parent_id IS NULL "
        "ORDER BY position, id", (section_id, frm))]
    if not moved:
        return jsonify(ok=True, moved=[])
    existing = [r["id"] for r in db.execute(
        "SELECT id FROM tasks WHERE section_id=? AND status=? AND parent_id IS NULL "
        "ORDER BY position, id", (section_id, to))]
    db.executemany("UPDATE tasks SET status=? WHERE id=?", [(to, t) for t in moved])
    for i, tid in enumerate(existing + moved):     # glue: existing first, arrivals after
        db.execute("UPDATE tasks SET position=? WHERE id=?", (i, tid))
    ev = log_event(db, row["project_id"], "moved section", row["title"],
                   "to %s (%d tasks)" % (STATUS_LABELS[to], len(moved)), important=False)
    db.commit()
    return jsonify(ok=True, moved=moved, to_status=to, event=ev)


@app.route("/api/tasks/<int:task_id>/delete", methods=["POST"])
def api_delete_task(task_id):
    db = get_db()
    row = db.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if row is None:
        return jsonify(ok=False, error="No such task."), 404
    deleted = task_to_dict(row)
    deleted["awaiting_on"] = row["awaiting_on"] or ""
    ev = log_event(db, row["project_id"], "deleted", row["title"], task_id=task_id)
    # Nesting arrives next increment; for now a task has no children.
    db.execute("DELETE FROM tasks WHERE id=?", (task_id,))
    db.commit()
    return jsonify(ok=True, event=ev, task=deleted)


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #

if __name__ == "__main__":
    init_db()
    app.run(host="127.0.0.1", port=5000, debug=True)
