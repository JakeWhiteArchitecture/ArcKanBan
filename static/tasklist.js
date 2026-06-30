/* ArcKanban — task-list view.
   A second, interactive lens on the board's data: tasks grouped into status
   segments. Pages by RIBA stage (‹ ›, like the decision register), filters like
   the board, drag to reorder / change status, hover-tick to mark done, and a
   right-click menu on decisions (set the decision-maker, confirm an option).
   Reuses the same JSON APIs as the board; optimistic DOM updates, a refresh
   always reflects the server's canonical order. */
(function () {
  "use strict";

  var RIBA = [
    "Strategic Definition", "Preparation and Briefing", "Concept Design",
    "Spatial Coordination", "Technical Design", "Manufacturing and Construction",
    "Handover", "Use",
  ];

  var tb = document.getElementById("titleblock");
  if (!tb) return;
  var projectUid = tb.dataset.projectUid;
  var current = Number(tb.dataset.currentStage);
  var enabled = (tb.dataset.stages || "0,1,2,3,4,5,6,7").split(",").map(Number);
  function isEnabled(n) { return enabled.indexOf(Number(n)) >= 0; }
  function nextEnabled(from, dir) { for (var i = Number(from) + dir; i >= 0 && i <= 7; i += dir) if (isEnabled(i)) return i; return null; }

  var main = document.querySelector(".tl-page");
  var tasks = [].slice.call(document.querySelectorAll(".tl-task"));
  var segs = [].slice.call(document.querySelectorAll(".tl-seg"));
  var none = document.querySelector(".tl-none");
  var LS = "arckanban-tl-stage-" + projectUid;

  async function post(url, body) {
    var res, json = {};
    try {
      res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch (e) { alert("Could not reach the app. Is it still running?"); return null; }
    try { json = await res.json(); } catch (e) {}
    if (!res.ok || !json.ok) { alert((json && json.error) || "That didn't work."); return null; }
    return json;
  }

  // ---- stage paging (mirrors the decision register) ----------------------
  var view = current;
  try { var s = localStorage.getItem(LS); if (s === "all") view = "all"; else if (s !== null && s !== "" && isEnabled(Number(s))) view = Number(s); } catch (e) {}
  if (view !== "all" && !isEnabled(view)) view = isEnabled(current) ? current : (enabled[0] != null ? enabled[0] : 0);
  var lastStage = view === "all" ? current : view;

  function apply() {
    var all = view === "all";
    if (main) main.classList.toggle("show-stages", all);   // per-task stage chip only when all stages
    tasks.forEach(function (t) { t.classList.toggle("stage-hidden", !(all || Number(t.dataset.stage) === view)); });
    var anyVisible = false;
    segs.forEach(function (seg) {
      var vis = seg.querySelectorAll(".tl-task:not(.stage-hidden)").length;
      seg.hidden = vis === 0;
      var c = seg.querySelector(".tl-count"); if (c) c.textContent = vis;
      if (vis) anyVisible = true;
    });
    if (none) none.hidden = anyVisible || tasks.length === 0;
    var num = document.querySelector(".tb-stage-num"), nm = document.querySelector(".tb-stage-name");
    var prev = document.querySelector(".tb-pager.prev"), next = document.querySelector(".tb-pager.next");
    var toggle = document.querySelector('[data-action="tl-toggle-all"]');
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
    try { localStorage.setItem(LS, all ? "all" : String(view)); } catch (e) {}
  }
  function goStage(n) { if (n == null) return; view = n; lastStage = n; apply(); }
  function toggleAll() { if (view === "all") goStage(isEnabled(lastStage) ? lastStage : current); else { view = "all"; apply(); } }
  apply();

  // ---- filters (same body classes + CSS as the board) --------------------
  function syncFilterBtn() {
    var any = ["filter-urgent", "filter-statutory", "hide-done"].some(function (c) { return document.body.classList.contains(c); });
    var b = document.getElementById("tl-filter-btn"); if (b) b.classList.toggle("has-active", any);
  }
  function closeFilterPop() { var p = document.getElementById("tl-filter-pop"); if (p) p.hidden = true; }

  // ---- mark done (hover tick) --------------------------------------------
  function moveToStatus(li, status) {
    li.dataset.status = status;
    li.classList.toggle("is-done", status === "done");
    var cb = li.querySelector(".tl-check"); if (cb) cb.checked = status === "done";
    var ul = document.querySelector('.tl-list[data-status="' + status + '"]');
    if (ul) ul.appendChild(li);
    apply();
  }
  document.addEventListener("change", async function (e) {
    var cb = e.target.closest(".tl-check"); if (!cb) return;
    var li = cb.closest(".tl-task"); var want = cb.checked ? "done" : "todo";
    var prev = li.dataset.status;
    moveToStatus(li, want);
    var r = await post("/api/tasks/" + li.dataset.taskId, { status: want });
    if (!r) moveToStatus(li, prev);   // revert on failure
  });

  // ---- drag to reorder / change status -----------------------------------
  var dragging = null;
  function laneIndex(li) {   // position within its (stage, substage, status, section) lane
    var ul = li.closest(".tl-list"); if (!ul) return 0;
    var sid = li.dataset.sectionId || "", sub = li.dataset.substage, stg = li.dataset.stage;
    var lane = [].slice.call(ul.querySelectorAll(".tl-task")).filter(function (x) {
      return (x.dataset.sectionId || "") === sid && x.dataset.substage === sub && x.dataset.stage === stg;
    });
    return Math.max(0, lane.indexOf(li));
  }
  function rowAfter(ul, y) {
    var els = [].slice.call(ul.querySelectorAll(".tl-task:not(.dragging):not(.stage-hidden)"));
    for (var i = 0; i < els.length; i++) { var r = els[i].getBoundingClientRect(); if (y < r.top + r.height / 2) return els[i]; }
    return null;
  }
  document.addEventListener("dragstart", function (e) {
    var li = e.target.closest(".tl-task"); if (!li) return;
    dragging = li; li.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", li.dataset.taskId); } catch (_) {}
  });
  document.addEventListener("dragover", function (e) {
    if (!dragging) return;
    var ul = e.target.closest(".tl-list"); if (!ul || ul.hidden || ul.closest(".tl-seg").hidden) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "move";
    var after = rowAfter(ul, e.clientY);
    if (after == null) ul.appendChild(dragging); else ul.insertBefore(dragging, after);
  });
  document.addEventListener("drop", async function (e) {
    if (!dragging) return;
    e.preventDefault();
    var li = dragging, ul = li.closest(".tl-list"), status = ul.dataset.status;
    li.dataset.status = status;
    li.classList.toggle("is-done", status === "done");
    var cb = li.querySelector(".tl-check"); if (cb) cb.checked = status === "done";
    var index = laneIndex(li), sid = li.dataset.sectionId || "";
    li.classList.remove("dragging"); dragging = null;
    apply();
    await post("/api/tasks/" + li.dataset.taskId + "/move", { status: status, section_id: sid, index: index });
  });
  document.addEventListener("dragend", function () { if (dragging) { dragging.classList.remove("dragging"); dragging = null; } });

  // ---- right-click a decision: set decision-maker, confirm an option ------
  var ctxMenu = null;
  function closeMenu() { if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; } }
  function ctxHead(menu, text) { var h = document.createElement("div"); h.className = "ctx-head"; h.textContent = text; menu.appendChild(h); }
  function ctxSep(menu) { var d = document.createElement("div"); d.className = "ctx-sep"; menu.appendChild(d); }
  function ctxItem(label, onClick, current) {
    var el = document.createElement("div");
    el.className = "ctx-item" + (onClick ? "" : " is-disabled") + (current ? " is-current" : "");
    var s = document.createElement("span"); s.textContent = label; el.appendChild(s);
    if (onClick) el.addEventListener("click", function () { closeMenu(); onClick(); });
    return el;
  }
  function placeMenu(menu, x, y) {
    document.body.appendChild(menu);
    menu.style.left = Math.min(x, window.innerWidth - menu.offsetWidth - 8) + "px";
    menu.style.top = Math.min(y, window.innerHeight - menu.offsetHeight - 8) + "px";
    ctxMenu = menu;
  }
  function makerOf(li) { var w = li.querySelector(".tl-who"); return (w && !w.hidden) ? w.textContent.trim() : ""; }
  async function setMaker(li, name) {
    var r = await post("/api/tasks/" + li.dataset.taskId, { awaiting_on: name });
    if (!r) return false;
    var w = li.querySelector(".tl-who"); if (w) { w.textContent = name; w.hidden = !name; }
    return true;
  }
  async function confirmDecision(li, text, addOption) {
    if (!makerOf(li)) {
      alert("Set the decision-maker before confirming.");
      var n = prompt("Decision-maker (who decides):"); if (!n || !n.trim()) return;
      if (!await setMaker(li, n.trim())) return;
    }
    var r = await post("/api/tasks/" + li.dataset.taskId + "/confirm", { text: text, add_option: !!addOption });
    if (r) location.reload();   // decided → moves to Done with an outcome; refresh to reflect
  }
  async function clearDecision(li) {
    var r = await post("/api/tasks/" + li.dataset.taskId + "/unconfirm", {});
    if (r) location.reload();
  }
  function openDecisionMenu(li, x, y) {
    closeMenu();
    var opts = []; try { opts = JSON.parse(li.dataset.options || "[]"); } catch (_) {}
    var outcome = li.dataset.outcome || "", who = makerOf(li);
    var menu = document.createElement("div"); menu.className = "ctx-menu";
    ctxHead(menu, outcome ? "Decision" : "Confirm decision");
    opts.forEach(function (o) {
      var chosen = o === outcome;
      menu.appendChild(ctxItem(o, (outcome || chosen) ? null : function () { confirmDecision(li, o, false); }, chosen));
    });
    if (!outcome) menu.appendChild(ctxItem("Other…", function () {
      var t = prompt("Confirm a typed outcome:"); if (t && t.trim()) confirmDecision(li, t.trim(), true);
    }));
    ctxSep(menu);
    menu.appendChild(ctxItem(who ? ("Decision by: " + who) : "Set decision-maker…", function () {
      var n = prompt("Decision-maker (who decides):", who); if (n !== null) setMaker(li, n.trim());
    }));
    if (outcome) menu.appendChild(ctxItem("Clear decision", function () { clearDecision(li); }));
    placeMenu(menu, x, y);
  }
  document.addEventListener("contextmenu", function (e) {
    var li = e.target.closest('.tl-task[data-type="decision"]');
    if (li) { e.preventDefault(); openDecisionMenu(li, e.clientX, e.clientY); }
  });

  // ---- clicks: pager, all-stages, filters, outside-close -----------------
  document.addEventListener("click", function (e) {
    if (ctxMenu && !e.target.closest(".ctx-menu")) closeMenu();
    var fb = e.target.closest(".filter-btn");
    if (fb) {
      var f = fb.dataset.filter, cls = f === "done" ? "hide-done" : ("filter-" + f);
      var on = document.body.classList.toggle(cls);
      fb.setAttribute("aria-pressed", on ? "true" : "false");
      syncFilterBtn(); return;
    }
    if (!e.target.closest("#tl-filter-pop, [data-action='tl-toggle-filters']")) closeFilterPop();
    var el = e.target.closest("[data-action]"); if (!el) return;
    switch (el.dataset.action) {
      case "tl-prev": goStage(nextEnabled(view === "all" ? lastStage : view, -1)); break;
      case "tl-next": goStage(nextEnabled(view === "all" ? lastStage : view, +1)); break;
      case "tl-toggle-all": toggleAll(); break;
      case "tl-toggle-filters": { var p = document.getElementById("tl-filter-pop"); if (p) p.hidden = !p.hidden; break; }
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { closeMenu(); closeFilterPop(); }
    if (e.target.matches("input, textarea, select")) return;
    if (e.key === "ArrowLeft") goStage(nextEnabled(view === "all" ? lastStage : view, -1));
    else if (e.key === "ArrowRight") goStage(nextEnabled(view === "all" ? lastStage : view, +1));
  });
})();
