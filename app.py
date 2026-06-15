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
from datetime import datetime, timezone
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
STATUSES = ["upcoming", "todo", "awaiting", "done"]
STATUS_LABELS = {
    "upcoming": "Upcoming",
    "todo": "To Do",
    "awaiting": "Awaiting",
    "done": "Done",
}

# Task types. Order is also the "rigour" order — statutory is the strongest.
TYPES = ["client", "statutory", "admin"]
TYPE_LABELS = {"client": "Client", "statutory": "Statutory", "admin": "Admin"}

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
            type        TEXT NOT NULL DEFAULT 'admin',
            urgent      INTEGER NOT NULL DEFAULT 0,
            awaiting_on TEXT,
            position    INTEGER NOT NULL DEFAULT 0,
            section_id  INTEGER REFERENCES sections(id) ON DELETE SET NULL,
            parent_id   INTEGER REFERENCES tasks(id) ON DELETE CASCADE
        );
        """
    )
    # Additive migrations for an existing v0.1-shaped database (see REQUIREMENTS §6).
    _ensure_column(db, "tasks", "urgent", "urgent INTEGER NOT NULL DEFAULT 0")
    _ensure_column(db, "tasks", "awaiting_on", "awaiting_on TEXT")
    _ensure_column(db, "tasks", "position", "position INTEGER NOT NULL DEFAULT 0")
    _ensure_column(db, "tasks", "section_id", "section_id INTEGER REFERENCES sections(id)")
    _ensure_column(db, "tasks", "parent_id", "parent_id INTEGER REFERENCES tasks(id)")
    # Old 'urgent' status rows (if any) become To Do + the urgent flag.
    db.execute("UPDATE tasks SET status='todo', urgent=1 WHERE status='urgent'")
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
        ttype = t.get("type", "admin")
        if ttype not in TYPES:
            ttype = "admin"
        section = t.get("section")
        section = str(section).strip() if section else None
        tasks.append({"stage": stage, "title": title, "type": ttype, "section": section})
    return {"name": data.get("name", filename), "tasks": tasks}


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


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
                lane = (stage, section_id)
                pos = pos_by_lane.get(lane, 0)
                pos_by_lane[lane] = pos + 1
                db.execute(
                    "INSERT INTO tasks (project_id, stage, title, status, type, "
                    "position, section_id) VALUES (?, ?, ?, 'todo', ?, ?, ?)",
                    (project_id, stage, t["title"], t["type"], pos, section_id),
                )
    db.commit()
    return redirect(url_for("board", project_id=project_id))


@app.route("/projects/<int:project_id>")
def board(project_id):
    db = get_db()
    p = get_project_or_404(db, project_id)
    # Layout: 'swimlane' (section bands) or 'grouped' (status columns + bubbles).
    layout = request.args.get("layout") or request.cookies.get("layout") or "swimlane"
    if layout not in ("swimlane", "grouped"):
        layout = "swimlane"
    resp = make_response(render_template(
        "board.html",
        project={
            "id": p["id"],
            "number": p["number"] or "",
            "name": p["name"],
            "current_stage": p["current_stage"],
        },
        stages=build_stages(db, project_id),
        status_labels=STATUS_LABELS,
        type_labels=TYPE_LABELS,
        statuses=STATUSES,
        layout=layout,
    ))
    if request.args.get("layout") in ("swimlane", "grouped"):
        resp.set_cookie("layout", layout, max_age=31536000, samesite="Lax")
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
    db.commit()
    return jsonify(ok=True, current_stage=stage)


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
    ttype = data.get("type", "admin")
    if ttype not in TYPES:
        ttype = "admin"
    section_id = data.get("section_id") or None
    if section_id is not None:
        try:
            section_id = int(section_id)
        except (TypeError, ValueError):
            return jsonify(ok=False, error="Invalid section."), 400
        if not section_in_stage(db, section_id, project_id, stage):
            return jsonify(ok=False, error="Section not in this stage."), 400
    pos = next_position(db, project_id, stage, "todo", section_id)
    cur = db.execute(
        "INSERT INTO tasks (project_id, stage, title, status, type, position, section_id) "
        "VALUES (?, ?, ?, 'todo', ?, ?, ?)",
        (project_id, stage, title, ttype, pos, section_id),
    )
    db.commit()
    row = db.execute("SELECT * FROM tasks WHERE id=?", (cur.lastrowid,)).fetchone()
    html = render_template("_card.html", t=task_to_dict(row),
                           status_labels=STATUS_LABELS, type_labels=TYPE_LABELS,
                           statuses=STATUSES)
    return jsonify(ok=True, task=task_to_dict(row), html=html)


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
    db.commit()
    new_row = db.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    return jsonify(ok=True, task=task_to_dict(new_row))


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
    db.commit()
    new_row = db.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    return jsonify(ok=True, task=task_to_dict(new_row))


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
    db.commit()
    lane = build_lane(cur.lastrowid, title, [])
    return jsonify(ok=True, section={"id": cur.lastrowid, "stage": stage, "title": title},
                   html=render_lane(lane, stage))


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
    db.execute("UPDATE sections SET title=? WHERE id=?", (title, section_id))
    db.commit()
    return jsonify(ok=True, title=title)


@app.route("/api/sections/<int:section_id>/delete", methods=["POST"])
def api_delete_section(section_id):
    db = get_db()
    row = db.execute("SELECT * FROM sections WHERE id=?", (section_id,)).fetchone()
    if row is None:
        return jsonify(ok=False, error="No such section."), 404
    # Orphan the section's tasks to the loose 'General' lane, then delete the section.
    db.execute("UPDATE tasks SET section_id=NULL WHERE section_id=?", (section_id,))
    db.execute("DELETE FROM sections WHERE id=?", (section_id,))
    db.commit()
    return jsonify(ok=True)


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
    db.commit()
    return jsonify(ok=True, moved=moved, to_status=to)


@app.route("/api/tasks/<int:task_id>/delete", methods=["POST"])
def api_delete_task(task_id):
    db = get_db()
    row = db.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if row is None:
        return jsonify(ok=False, error="No such task."), 404
    # Nesting arrives next increment; for now a task has no children.
    db.execute("DELETE FROM tasks WHERE id=?", (task_id,))
    db.commit()
    return jsonify(ok=True)


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #

if __name__ == "__main__":
    init_db()
    app.run(host="127.0.0.1", port=5000, debug=True)
