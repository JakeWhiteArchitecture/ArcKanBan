/* ArcKanban — decision register page.
   Shares the board's header. Pages the register by RIBA stage (‹ ›), defaults to
   the current stage, toggles to "All stages", and can email a decisions table.
   Each decision row can still spawn a linked task, and the rationale is editable
   inline — both unchanged. No reload anywhere. */
(function () {
  "use strict";

  var RIBA = [
    "Strategic Definition", "Preparation and Briefing", "Concept Design",
    "Spatial Coordination", "Technical Design", "Manufacturing and Construction",
    "Handover", "Use",
  ];

  var tb = document.getElementById("titleblock");
  var projectUid = tb ? tb.dataset.projectUid : "";
  var current = tb ? Number(tb.dataset.currentStage) : 0;
  var enabled = ((tb && tb.dataset.stages) || "0,1,2,3,4,5,6,7").split(",").map(Number);
  function isEnabled(n) { return enabled.indexOf(Number(n)) >= 0; }
  function nextEnabled(from, dir) { for (var i = Number(from) + dir; i >= 0 && i <= 7; i += dir) if (isEnabled(i)) return i; return null; }

  var rows = [].slice.call(document.querySelectorAll(".dr-row"));
  var none = document.querySelector(".dr-none");
  var LS = "arckanban-dr-stage-" + projectUid;
  function stageHasDecisions(n) { return rows.some(function (r) { return Number(r.dataset.stage) === n; }); }

  // Start on the remembered view, else the current stage; if that stage has no
  // decisions, jump to the first enabled stage that does.
  var view = current;          // a stage number, or "all"
  try { var s = localStorage.getItem(LS); if (s === "all") view = "all"; else if (s !== null && s !== "" && isEnabled(Number(s))) view = Number(s); } catch (e) {}
  if (view !== "all" && rows.length && !stageHasDecisions(view)) {
    for (var i = 0; i <= 7; i++) { if (isEnabled(i) && stageHasDecisions(i)) { view = i; break; } }
  }
  var lastStage = (view === "all") ? current : view;

  function apply() {
    var all = view === "all", anyVisible = false;
    rows.forEach(function (r) { var show = all || Number(r.dataset.stage) === view; r.hidden = !show; if (show) anyVisible = true; });
    var table = document.querySelector(".dr-table");
    if (table) table.hidden = rows.length > 0 && !anyVisible;     // hide the header-only table on an empty stage
    if (none) none.hidden = anyVisible || rows.length === 0;

    var num = document.querySelector(".tb-stage-num"), nm = document.querySelector(".tb-stage-name");
    var prev = document.querySelector(".tb-pager.prev"), next = document.querySelector(".tb-pager.next");
    var toggle = document.querySelector('[data-action="dr-toggle-all"]');
    if (all) {
      if (num) num.textContent = "·"; if (nm) nm.textContent = "All stages";
      if (prev) prev.disabled = true; if (next) next.disabled = true;
      if (toggle) toggle.textContent = "Show stage " + lastStage;
    } else {
      if (num) num.textContent = view; if (nm) nm.textContent = RIBA[view];
      if (prev) prev.disabled = nextEnabled(view, -1) === null;
      if (next) next.disabled = nextEnabled(view, +1) === null;
      if (toggle) toggle.textContent = "Show all stages";
    }
    var bl = document.querySelector(".dr-board");
    if (bl) { var base = bl.getAttribute("href").split("?")[0]; bl.setAttribute("href", all ? base : base + "?stage=" + view); }
    try { localStorage.setItem(LS, all ? "all" : String(view)); } catch (e) {}
  }
  function goStage(n) { if (n == null) return; view = n; lastStage = n; apply(); }
  function toggleAll() { if (view === "all") goStage(isEnabled(lastStage) ? lastStage : current); else { view = "all"; apply(); } }

  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-action]"); if (!el) return;
    switch (el.dataset.action) {
      case "dr-prev": goStage(nextEnabled(view === "all" ? lastStage : view, -1)); break;
      case "dr-next": goStage(nextEnabled(view === "all" ? lastStage : view, +1)); break;
      case "dr-toggle-all": toggleAll(); break;
      case "dr-substage": toggleSubstage(); break;
      case "edit-dr-assignee": startAssigneeEdit(el); break;
      case "dr-confirm": { var rc = el.closest(".dr-row"); confirmDecision(rc, el.dataset.text, false); break; }
      case "dr-email": {
        var url = "/projects/" + encodeURIComponent(projectUid) + "/decisions.eml";
        if (view !== "all") url += "?stages=" + view;
        window.location.href = url; break;
      }
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.target.matches("input, textarea, select, [contenteditable]")) return;
    if (e.key === "ArrowLeft") goStage(nextEnabled(view === "all" ? lastStage : view, -1));
    else if (e.key === "ArrowRight") goStage(nextEnabled(view === "all" ? lastStage : view, +1));
  });

  apply();

  // ---- "sub-stage aware": tag each decision's stage chip 4a/4b/4c ----------
  // Paging stays by whole stage; the toggle only relabels the Stage column.
  var LS_SUB = "arckanban-dr-substage-" + projectUid;
  var subOn = false; try { subOn = localStorage.getItem(LS_SUB) === "1"; } catch (e) {}
  function applySubstage() {
    document.querySelectorAll(".dr-stage").forEach(function (chip) {
      var label = chip.dataset.label || chip.dataset.stage;
      chip.textContent = subOn ? label : chip.dataset.stage;
      chip.classList.toggle("is-sub", subOn && label !== chip.dataset.stage);
    });
    var btn = document.querySelector('[data-action="dr-substage"]');
    if (btn) { btn.setAttribute("aria-pressed", subOn ? "true" : "false"); btn.classList.toggle("has-active", subOn); }
  }
  function toggleSubstage() {
    subOn = !subOn;
    try { localStorage.setItem(LS_SUB, subOn ? "1" : "0"); } catch (e) {}
    applySubstage();
  }
  applySubstage();

  // ---- confirm a decision from the register (a typed "Other…" outcome) ----
  document.addEventListener("submit", function (e) {
    var other = e.target.closest(".dr-other"); if (!other) return;
    e.preventDefault();
    var input = other.querySelector('input[name="other"]'); var text = input.value.trim();
    if (!text) { input.focus(); return; }
    confirmDecision(other.closest(".dr-row"), text, true);
  });

  // ---- spawn a task from a decision (linked via from_decision_id) ---------
  document.addEventListener("submit", async function (e) {
    var form = e.target.closest(".dr-addtask"); if (!form) return;
    e.preventDefault();
    var input = form.querySelector('input[name="title"]'); var title = input.value.trim();
    if (!title) { input.focus(); return; }
    var res, json = {};
    try {
      res = await fetch("/api/decisions/" + form.dataset.decisionId + "/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title }),
      });
    } catch (err) { alert("Could not reach the app. Is it still running?"); return; }
    try { json = await res.json(); } catch (err) {}
    if (!res.ok || !json.ok) { alert((json && json.error) || "Could not add the task."); return; }
    var li = document.createElement("li"); li.className = "dr-linked-item"; li.textContent = json.task.title;
    form.parentElement.querySelector(".dr-linked").appendChild(li);
    input.value = ""; input.focus();
  });

  // ---- inline rationale editing (the optional "why" column) --------------
  document.addEventListener("click", function (e) {
    var cell = e.target.closest(".dr-rationale");
    if (cell && !cell.querySelector("textarea")) startRationaleEdit(cell);
  });
  function renderRationale(cell, val) {
    cell.dataset.value = val;
    if (val) cell.textContent = val; else cell.innerHTML = '<span class="dr-empty">— add rationale</span>';
  }
  function startRationaleEdit(cell) {
    var id = cell.dataset.decisionId;
    var current = "value" in cell.dataset ? cell.dataset.value : (cell.querySelector(".dr-empty") ? "" : cell.textContent.trim());
    var ta = document.createElement("textarea"); ta.className = "dr-rationale-input"; ta.rows = 3; ta.value = current;
    cell.textContent = ""; cell.appendChild(ta); ta.focus();
    var done = false;
    function finish(commit) {
      if (done) return; done = true;
      if (commit) saveRationale(id, ta.value.trim(), cell); else renderRationale(cell, current);
    }
    ta.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); finish(true); }
      else if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
    });
    ta.addEventListener("blur", function () { finish(true); });
  }
  async function saveRationale(id, val, cell) {
    var res, json = {};
    try {
      res = await fetch("/api/tasks/" + id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rationale: val }) });
    } catch (err) { alert("Could not reach the app. Is it still running?"); renderRationale(cell, val); return; }
    try { json = await res.json(); } catch (err) {}
    if (!res.ok || !json.ok) alert((json && json.error) || "Could not save the rationale.");
    renderRationale(cell, val);
  }

  // ---- inline "Decision by" editing (with role autocomplete) -------------
  function renderAssignee(cell, val) {
    if (val) cell.textContent = val; else cell.innerHTML = '<span class="dr-empty">— not set</span>';
  }
  function startAssigneeEdit(cell) {
    if (cell.querySelector("input")) return;
    var id = cell.dataset.decisionId;
    var current = cell.querySelector(".dr-empty") ? "" : cell.textContent.trim();
    var inp = document.createElement("input");
    inp.type = "text"; inp.className = "dr-by-input"; inp.value = current; inp.autocomplete = "off";
    inp.setAttribute("list", "dr-assignee-suggestions");
    cell.textContent = ""; cell.appendChild(inp); inp.focus(); inp.select();
    var done = false;
    function finish(commit) {
      if (done) return; done = true;
      if (commit) saveAssignee(id, inp.value.trim(), cell); else renderAssignee(cell, current);
    }
    inp.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
      else if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
    });
    inp.addEventListener("blur", function () { finish(true); });
  }
  async function saveAssignee(id, val, cell) {
    var res, json = {};
    try {
      res = await fetch("/api/tasks/" + id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ awaiting_on: val }) });
    } catch (err) { alert("Could not reach the app. Is it still running?"); renderAssignee(cell, val); return; }
    try { json = await res.json(); } catch (err) {}
    if (!res.ok || !json.ok) alert((json && json.error) || "Could not save the decision-maker.");
    renderAssignee(cell, val);
  }

  // ---- confirm a decision (mirrors the board: decision-maker required) ----
  async function confirmDecision(row, text, addOption) {
    if (!row || !text) return;
    var by = row.querySelector(".dr-by-edit"), input = by && by.querySelector("input");
    var maker = input ? input.value.trim() : (by && !by.querySelector(".dr-empty") ? by.textContent.trim() : "");
    if (!maker) {
      alert("Set the decision-maker (“Decision by”) before confirming.");
      if (by) startAssigneeEdit(by); return;
    }
    var res, json = {};
    try {
      res = await fetch("/api/tasks/" + row.dataset.decisionId + "/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text, add_option: !!addOption }),
      });
    } catch (err) { alert("Could not reach the app. Is it still running?"); return; }
    try { json = await res.json(); } catch (err) {}
    if (!res.ok || !json.ok) { alert((json && json.error) || "Could not confirm the decision."); return; }
    location.reload();   // re-render the row as decided (outcome, date, dismissed options)
  }
})();
