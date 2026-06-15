/* ArcKanban — board interactions.
   Two layouts share this file (board.dataset.layout):
     swimlane — section bands; drag across the section×status grid.
     grouped  — status columns with section bubbles; drag changes status and
                auto-regroups into the section's bubble; click a card to link
                its section across columns; reassign section via the chip bar.
   Horizontal stage paging throughout; status steppers as the click fallback.
   Everything persists via small JSON endpoints, no reload. Nesting is next. */
(function () {
  "use strict";

  var STATUSES = ["upcoming", "todo", "awaiting", "done"];
  var STATUS_LABELS = { upcoming: "Upcoming", todo: "To Do", awaiting: "Awaiting", done: "Done" };
  var RIBA = [
    "Strategic Definition", "Preparation and Briefing", "Concept Design",
    "Spatial Coordination", "Technical Design", "Manufacturing and Construction",
    "Handover", "Use",
  ];

  var board = document.querySelector(".board");
  if (!board) return;
  var track = document.getElementById("stage-track");
  var projectId = Number(board.dataset.projectId);
  var currentStage = Number(board.dataset.currentStage);
  var LAYOUT = board.dataset.layout || "swimlane";
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var enabledStages = (board.dataset.stages || "0,1,2,3,4,5,6,7").split(",").map(Number);
  function isEnabled(n) { return enabledStages.indexOf(Number(n)) >= 0; }
  function nextEnabled(from, dir) { for (var i = Number(from) + dir; i >= 0 && i <= 7; i += dir) if (isEnabled(i)) return i; return null; }

  var activity = {}, dismissed = {};

  async function api(url, data) {
    var res;
    try {
      res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data || {}) });
    } catch (e) { alert("Could not reach the app. Is it still running?"); return null; }
    var json = {};
    try { json = await res.json(); } catch (e) {}
    if (!res.ok || !json.ok) { alert((json && json.error) || "Something went wrong."); return null; }
    if (json.event) prependLogEvent(json.event);
    return json;
  }

  // ---- activity log + undo helpers --------------------------------------
  function prependLogEvent(ev) {
    var list = document.getElementById("log-list"); if (!list || !ev) return;
    var empty = list.querySelector(".log-empty"); if (empty) empty.remove();
    var li = document.createElement("li"); li.className = "log-item";
    var t = document.createElement("span"); t.className = "log-text"; t.textContent = ev.text;
    var w = document.createElement("time"); w.className = "log-when"; w.textContent = ev.when;
    li.appendChild(t); li.appendChild(w);
    list.insertBefore(li, list.firstChild);
  }
  var undoStack = [];
  function pushUndo(label, run) { undoStack.push({ label: label, run: run }); }
  async function runUndo() { var u = undoStack.pop(); if (u) await u.run(); }
  function cardTitle(card) { var t = card.querySelector(".task-title"); return t ? t.textContent.trim() : "task"; }
  async function undoUpdate(id, body) { var r = await api("/api/tasks/" + id, body); if (r) location.reload(); }
  async function undoMove(id, status, section) { var r = await api("/api/tasks/" + id, { status: status, section_id: section || null }); if (r) location.reload(); }

  function cardOf(el) { return el.closest(".card"); }
  function laneOf(el) { return el.closest(".section-lane"); }
  function stageOf(el) { return el.closest(".stage"); }
  function colBodyOf(el) { return el.closest(".col-body"); }

  // ---- horizontal navigation --------------------------------------------
  var LS_STAGE = "arckanban-stage-" + projectId;
  function activeStage() {
    if (!track.clientWidth) return currentStage;
    return Math.max(0, Math.min(7, Math.round(track.scrollLeft / track.clientWidth)));
  }
  function updateNav(n) {
    if (n == null) n = activeStage();
    document.querySelectorAll(".titleblock .spine-cell").forEach(function (c, i) {
      c.classList.toggle("is-active", i === n);
    });
    var prev = document.querySelector(".nav-arrow.prev"), next = document.querySelector(".nav-arrow.next");
    if (prev) prev.disabled = nextEnabled(n, -1) === null;
    if (next) next.disabled = nextEnabled(n, +1) === null;
  }
  function gotoStage(n, instant) {
    n = Math.max(0, Math.min(7, Number(n)));
    track.scrollTo({ left: n * track.clientWidth, behavior: (instant || reduceMotion) ? "auto" : "smooth" });
    updateNav(n);
  }
  var ticking = false;
  track.addEventListener("scroll", function () {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(function () {
        var n = activeStage(); updateNav(n);
        try { localStorage.setItem(LS_STAGE, String(n)); } catch (e) {}
        lastActive = n; ticking = false;
      });
    }
  });
  var lastActive = currentStage;
  window.addEventListener("resize", function () { gotoStage(lastActive, true); });

  // ---- counts ------------------------------------------------------------
  function colCards(scope, status) {
    return scope.querySelectorAll('.col-cards[data-status="' + status + '"] > .card').length;
  }
  function recountLane(laneEl) {
    if (!laneEl) return;
    var total = 0, done = 0;
    STATUSES.forEach(function (st) {
      var n = colCards(laneEl, st);
      var cc = laneEl.querySelector(".col-" + st + " .col-count"); if (cc) cc.textContent = n;
      total += n; if (st === "done") done = n;
    });
    var urgent = laneEl.querySelectorAll(".card.is-urgent").length;
    var roll = laneEl.querySelector(".lane-rollup");
    if (roll) roll.innerHTML = total
      ? (done + "/" + total + (urgent ? ' <span class="rollup-urgent">!' + urgent + "</span>" : "")) : "";
  }
  function recountStagePips(stageEl) {
    var html = "";
    STATUSES.forEach(function (st) {
      var n = colCards(stageEl, st);
      if (n) html += '<span class="pip pip-' + st + '">' + n + " " + STATUS_LABELS[st].toLowerCase() + "</span>";
    });
    var urgent = stageEl.querySelectorAll(".card.is-urgent").length;
    if (urgent) html += '<span class="pip pip-urgent">' + urgent + " urgent</span>";
    var box = stageEl.querySelector(".stage-counts"); if (box) box.innerHTML = html;
  }
  function updateUrgentTally() {
    var n = board.querySelectorAll(".card.is-urgent").length;
    var el = document.getElementById("tb-urgent");
    if (!el) return;
    if (n > 0) { el.hidden = false; el.textContent = n + " urgent"; } else { el.hidden = true; }
  }
  function recountStageFull(stageEl) {
    if (!stageEl) return;
    if (LAYOUT === "grouped") {
      stageEl.querySelectorAll(".gcolumns .column").forEach(function (col) {
        var n = col.querySelectorAll(".col-cards > .card").length;
        var cc = col.querySelector(".col-count"); if (cc) cc.textContent = n;
      });
      stageEl.querySelectorAll(".bubble").forEach(function (b) {
        var n = b.querySelectorAll(".bubble-cards > .card").length;
        var bc = b.querySelector(".bubble-count"); if (bc) bc.textContent = n;
        if (n === 0) b.remove();
      });
      stageEl.querySelectorAll(".sec-chip").forEach(function (chip) {
        var sid = chip.dataset.section; if (!sid) return;
        var total = stageEl.querySelectorAll('.col-cards[data-section="' + sid + '"] > .card').length;
        var done = stageEl.querySelectorAll('.col-done .col-cards[data-section="' + sid + '"] > .card').length;
        var roll = chip.querySelector(".sec-chip-roll"); if (roll) roll.textContent = done + "/" + total;
      });
    } else {
      stageEl.querySelectorAll(".section-lane").forEach(recountLane);
    }
    recountStagePips(stageEl);
    updateUrgentTally();
  }

  // ---- nudge -------------------------------------------------------------
  function registerActivity(stage, taskId) {
    stage = Number(stage);
    if (stage > currentStage) {
      if (!activity[stage]) activity[stage] = new Set();
      activity[stage].add(Number(taskId)); evaluateNudge();
    }
  }
  function currentStageCompletion() {
    var st = document.getElementById("stage-" + currentStage);
    if (!st) return 0;
    var total = st.querySelectorAll(".col-cards > .card").length;
    return total ? colCards(st, "done") / total : 0;
  }
  function evaluateNudge() {
    var target = null, s;
    for (s = 7; s > currentStage; s--) if (activity[s] && activity[s].size >= 3 && !dismissed[s]) { target = s; break; }
    if (target === null && currentStageCompletion() >= 0.8)
      for (s = 7; s > currentStage; s--) if (activity[s] && activity[s].size >= 1 && !dismissed[s]) { target = s; break; }
    var nudge = document.getElementById("nudge");
    if (target !== null) {
      nudge.querySelector(".nudge-text").textContent =
        "Working in Stage " + target + " (" + RIBA[target] + ") — set as current?";
      nudge.dataset.stage = target; nudge.hidden = false;
    } else nudge.hidden = true;
  }

  // ---- current stage -----------------------------------------------------
  async function setCurrentStage(n) {
    n = Number(n);
    var r = await api("/api/projects/" + projectId + "/current_stage", { stage: n });
    if (!r) return;
    currentStage = n; board.dataset.currentStage = n;
    document.querySelectorAll(".titleblock .spine-cell").forEach(function (cell, i) {
      cell.classList.remove("is-current", "is-past", "is-future");
      cell.classList.add(i < n ? "is-past" : (i === n ? "is-current" : "is-future"));
    });
    var csn = document.querySelector(".compact-stage-num"); if (csn) csn.textContent = n;
    document.querySelectorAll(".here-tag").forEach(function (t) { t.remove(); });
    var nameEl = document.querySelector("#stage-" + n + " .slide-head .stage-name");
    if (nameEl) { var tag = document.createElement("span"); tag.className = "here-tag"; tag.textContent = "you are here"; nameEl.insertAdjacentElement("afterend", tag); }
    document.querySelectorAll(".stage-slide").forEach(function (st) {
      var idx = Number(st.dataset.stage);
      var btn = st.querySelector(".set-current"); var badge = st.querySelector(".current-badge");
      if (btn) btn.hidden = idx === n; if (badge) badge.hidden = idx !== n;
    });
    document.getElementById("nudge").hidden = true; gotoStage(n); evaluateNudge();
  }

  // ---- inline editing ----------------------------------------------------
  function editInline(displayEl, currentText, onSave) {
    if (displayEl.dataset.editing) return;
    displayEl.dataset.editing = "1";
    var input = document.createElement("input");
    input.type = "text"; input.className = "title-input"; input.value = currentText;
    displayEl.replaceChildren(input); input.focus(); input.select();
    var done = false;
    function finish(commit) {
      if (done) return; done = true; delete displayEl.dataset.editing;
      onSave(commit ? input.value.trim() : null, input.value.trim() !== currentText);
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    });
    input.addEventListener("blur", function () { finish(true); });
  }
  function editTitle(titleEl) {
    var id = cardOf(titleEl).dataset.taskId, text = titleEl.textContent.trim();
    editInline(titleEl, text, async function (val, changed) {
      if (val === null || !changed || !val) { titleEl.textContent = text; return; }
      var r = await api("/api/tasks/" + id, { title: val }); titleEl.textContent = (r && val) || text;
    });
  }
  function editAwaiting(box) {
    var id = cardOf(box).dataset.taskId, textEl = box.querySelector(".awaiting-text");
    var current = textEl.classList.contains("is-empty") ? "" : textEl.textContent.trim();
    editInline(textEl, current, async function (val, changed) {
      if (val === null) { renderAwaiting(textEl, current); return; }
      if (changed) await api("/api/tasks/" + id, { awaiting_on: val });
      renderAwaiting(textEl, changed ? val : current);
    });
  }
  function renderAwaiting(textEl, val) {
    if (val) { textEl.textContent = val; textEl.classList.remove("is-empty"); }
    else { textEl.textContent = "who / what?"; textEl.classList.add("is-empty"); }
  }
  function editProjectField(cell, field) {
    var raw = cell.textContent.trim(), current = raw === "—" ? "" : raw;
    editInline(cell, current, async function (val, changed) {
      if (val === null || !changed) { cell.textContent = raw; return; }
      var payload = {}; payload[field] = val;
      var r = await api("/api/projects/" + projectId, payload);
      cell.textContent = r ? (val || (field === "number" ? "—" : raw)) : raw;
    });
  }
  function renameSection(titleEl) {
    var holder = titleEl.closest("[data-section]"); var id = holder.dataset.section;
    var text = titleEl.textContent.trim();
    editInline(titleEl, text, async function (val, changed) {
      if (val === null || !changed || !val) { titleEl.textContent = text; return; }
      var r = await api("/api/sections/" + id, { title: val });
      if (!r) { titleEl.textContent = text; return; }
      titleEl.textContent = val;
      if (LAYOUT === "grouped") {
        var stageEl = stageOf(titleEl);
        stageEl.querySelectorAll('.bubble[data-section="' + id + '"] .bubble-name').forEach(function (n) { n.textContent = val; });
        stageEl.querySelectorAll('.add-task select[name="section"] option[value="' + id + '"]').forEach(function (o) { o.textContent = val; });
      }
    });
  }

  // ---- grouped helpers ---------------------------------------------------
  function sectionTitle(stageEl, sec) {
    var c = stageEl.querySelector('.sec-chip[data-section="' + sec + '"] .sec-chip-name');
    return c ? c.textContent.trim() : "Section";
  }
  function sectionPos(stageEl, sec) {
    var c = stageEl.querySelector('.sec-chip[data-section="' + sec + '"]');
    return c ? Number(c.dataset.pos) : 999;
  }
  function containerFor(colBody, sec) {
    return sec ? colBody.querySelector('.bubble[data-section="' + sec + '"] .bubble-cards')
               : colBody.querySelector(".loose-cards");
  }
  function ensureContainer(colBody, sec) {
    if (!sec) return colBody.querySelector(".loose-cards");
    var existing = colBody.querySelector('.bubble[data-section="' + sec + '"]');
    if (existing) return existing.querySelector(".bubble-cards");
    var stageEl = stageOf(colBody), pos = sectionPos(stageEl, sec);
    var bubble = document.createElement("div");
    bubble.className = "bubble"; bubble.dataset.section = sec; bubble.dataset.pos = pos;
    var head = document.createElement("div"); head.className = "bubble-head";
    head.draggable = true; head.title = "Drag this section to another status";
    var nm = document.createElement("span"); nm.className = "bubble-name"; nm.textContent = sectionTitle(stageEl, sec);
    var ct = document.createElement("span"); ct.className = "bubble-count"; ct.textContent = "0";
    head.appendChild(nm); head.appendChild(ct);
    var cards = document.createElement("div");
    cards.className = "col-cards bubble-cards";
    cards.dataset.stage = colBody.dataset.stage; cards.dataset.status = colBody.dataset.status; cards.dataset.section = sec;
    bubble.appendChild(head); bubble.appendChild(cards);
    var loose = colBody.querySelector(".loose-cards"), ref = null;
    var bubbles = colBody.querySelectorAll(".bubble");
    for (var i = 0; i < bubbles.length; i++) { if (Number(bubbles[i].dataset.pos) > pos) { ref = bubbles[i]; break; } }
    colBody.insertBefore(bubble, ref || loose);
    return cards;
  }

  // ---- selection + cross-column link (grouped) --------------------------
  var selectedCard = null;
  function clearSelection() {
    if (!selectedCard) return;
    var g = selectedCard.closest(".grouped");
    selectedCard.classList.remove("is-selected");
    if (g) { g.classList.remove("linking"); g.querySelectorAll(".bubble.is-linked").forEach(function (b) { b.classList.remove("is-linked"); }); }
    selectedCard = null;
  }
  function selectCard(card) {
    if (selectedCard === card) { clearSelection(); return; }
    clearSelection();
    selectedCard = card; card.classList.add("is-selected");
    var g = card.closest(".grouped"); if (!g) return;
    g.classList.add("linking");
    var sec = card.dataset.section || "";
    if (sec) g.querySelectorAll('.bubble[data-section="' + sec + '"]').forEach(function (b) { b.classList.add("is-linked"); });
  }
  async function assignSelectedTo(sec) {
    var card = selectedCard; if (!card) return;
    var colBody = colBodyOf(card), stageEl = stageOf(card);
    var prev = card.dataset.section || "";
    if (prev === sec) { clearSelection(); return; }
    var id = card.dataset.taskId, title = cardTitle(card);
    var r = await api("/api/tasks/" + id, { section_id: sec || null });
    if (!r) { clearSelection(); return; }
    card.dataset.section = sec || "";
    ensureContainer(colBody, sec).appendChild(card);
    recountStageFull(stageEl);
    pushUndo("move of “" + title + "”", function () { return undoUpdate(id, { section_id: prev || null }); });
    clearSelection();
  }

  // ---- right-click: assign to / break out of a section ------------------
  var ctxMenu = null;
  function closeMenu() { if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; } }
  function stageSections(stageEl) {
    var out = [];
    if (LAYOUT === "grouped")
      stageEl.querySelectorAll(".sec-chip:not(.sec-chip-general)").forEach(function (ch) {
        out.push({ id: ch.dataset.section, title: ch.querySelector(".sec-chip-name").textContent.trim() });
      });
    else
      stageEl.querySelectorAll(".section-lane:not(.is-general)").forEach(function (l) {
        out.push({ id: l.dataset.section, title: l.querySelector(".lane-title").textContent.trim() });
      });
    return out;
  }
  async function assignCardToSection(card, sec) {
    var prev = card.dataset.section || "";
    if (prev === sec) return;
    var id = card.dataset.taskId, title = cardTitle(card);
    var r = await api("/api/tasks/" + id, { section_id: sec || null });
    if (!r) return;
    card.dataset.section = sec || "";
    var stageEl = stageOf(card);
    if (LAYOUT === "grouped") {
      ensureContainer(colBodyOf(card), sec).appendChild(card);
    } else {
      var lane = sec ? stageEl.querySelector('.section-lane[data-section="' + sec + '"]')
                     : stageEl.querySelector(".section-lane.is-general");
      if (lane) { var cont = lane.querySelector('.col-cards[data-status="' + card.dataset.status + '"]'); if (cont) cont.appendChild(card); }
    }
    recountStageFull(stageEl);
    pushUndo("move of “" + title + "”", function () { return undoUpdate(id, { section_id: prev || null }); });
  }
  function openSectionMenu(card, x, y) {
    closeMenu();
    var stageEl = stageOf(card), cur = card.dataset.section || "";
    var menu = document.createElement("div"); menu.className = "ctx-menu";
    var head = document.createElement("div"); head.className = "ctx-head"; head.textContent = "Move to section"; menu.appendChild(head);
    [{ id: "", title: "General (no section)" }].concat(stageSections(stageEl)).forEach(function (it) {
      var el = document.createElement("div");
      el.className = "ctx-item" + (it.id === cur ? " is-current" : "");
      var s = document.createElement("span"); s.textContent = it.title; el.appendChild(s);
      if (it.id !== cur) el.addEventListener("click", function () { assignCardToSection(card, it.id); closeMenu(); });
      menu.appendChild(el);
    });
    document.body.appendChild(menu);
    menu.style.left = Math.min(x, window.innerWidth - menu.offsetWidth - 8) + "px";
    menu.style.top = Math.min(y, window.innerHeight - menu.offsetHeight - 8) + "px";
    ctxMenu = menu;
  }
  function openActionsMenu(x, y) {
    closeMenu();
    var menu = document.createElement("div"); menu.className = "ctx-menu";
    var head = document.createElement("div"); head.className = "ctx-head"; head.textContent = "Actions"; menu.appendChild(head);
    var last = undoStack[undoStack.length - 1];
    var item = document.createElement("div");
    item.className = "ctx-item" + (last ? "" : " is-disabled");
    var s = document.createElement("span"); s.textContent = last ? ("Undo " + last.label) : "Nothing to undo"; item.appendChild(s);
    if (last) item.addEventListener("click", function () { closeMenu(); runUndo(); });
    menu.appendChild(item);
    document.body.appendChild(menu);
    menu.style.left = Math.min(x, window.innerWidth - menu.offsetWidth - 8) + "px";
    menu.style.top = Math.min(y, window.innerHeight - menu.offsetHeight - 8) + "px";
    ctxMenu = menu;
  }

  // ---- task mutations ----------------------------------------------------
  function applyCardStatus(card, status) {
    card.dataset.status = status;
    card.classList.remove("status-upcoming", "status-todo", "status-awaiting", "status-done");
    card.classList.add("status-" + status);
    var lbl = card.querySelector(".status-label"); if (lbl) lbl.textContent = STATUS_LABELS[status];
    var i = STATUSES.indexOf(status);
    var p = card.querySelector(".step-prev"), n = card.querySelector(".step-next");
    if (p) p.disabled = i === 0; if (n) n.disabled = i === STATUSES.length - 1;
  }
  async function stepStatus(card, dir) {
    var i = STATUSES.indexOf(card.dataset.status), ni = i + dir;
    if (ni < 0 || ni >= STATUSES.length) return;
    var newStatus = STATUSES[ni];
    var prev = card.dataset.status, sec = card.dataset.section || "", id = card.dataset.taskId, title = cardTitle(card);
    var r = await api("/api/tasks/" + id, { status: newStatus });
    if (!r) return;
    applyCardStatus(card, newStatus);
    pushUndo("move of “" + title + "”", function () { return undoMove(id, prev, sec); });
    var stageEl = stageOf(card);
    if (LAYOUT === "grouped") {
      var destCol = stageEl.querySelector('.col-body[data-status="' + newStatus + '"]');
      if (destCol) ensureContainer(destCol, card.dataset.section || "").appendChild(card);
    } else {
      var dest = laneOf(card).querySelector('.col-cards[data-status="' + newStatus + '"]');
      if (dest) dest.appendChild(card);
    }
    recountStageFull(stageEl); registerActivity(card.dataset.stage, card.dataset.taskId);
  }
  async function toggleUrgent(btn) {
    var card = cardOf(btn), next = card.dataset.urgent !== "1";
    var id = card.dataset.taskId, prev = card.dataset.urgent === "1", title = cardTitle(card);
    var r = await api("/api/tasks/" + id, { urgent: next });
    if (!r) return;
    card.dataset.urgent = next ? "1" : "0"; card.classList.toggle("is-urgent", next);
    btn.setAttribute("aria-pressed", next ? "true" : "false");
    pushUndo("urgent change on “" + title + "”", function () { return undoUpdate(id, { urgent: prev }); });
    recountStageFull(stageOf(card)); registerActivity(card.dataset.stage, card.dataset.taskId);
  }
  async function changeType(select) {
    var card = cardOf(select), oldType = card.dataset.type, newType = select.value;
    if (newType === oldType) return;
    if (oldType === "statutory" && newType !== "statutory" &&
        !confirm("Remove the statutory marker from this task? Statutory tasks carry legal duties.")) {
      select.value = oldType; return;
    }
    var id = card.dataset.taskId, title = cardTitle(card);
    var r = await api("/api/tasks/" + id, { type: newType });
    if (!r) { select.value = oldType; return; }
    card.dataset.type = newType;
    card.classList.remove("type-client", "type-statutory", "type-admin"); card.classList.add("type-" + newType);
    pushUndo("type change on “" + title + "”", function () { return undoUpdate(id, { type: oldType }); });
    registerActivity(card.dataset.stage, card.dataset.taskId);
  }
  async function deleteTask(btn) {
    var card = cardOf(btn);
    if (!confirm("Delete this task?")) return;
    var stageEl = stageOf(card);
    var r = await api("/api/tasks/" + card.dataset.taskId + "/delete", {});
    if (!r) return;
    card.remove(); recountStageFull(stageEl);
    if (r.task) pushUndo("delete of “" + (r.task.title || "task") + "”",
      async function () { var rr = await api("/api/projects/" + projectId + "/tasks/restore", r.task); if (rr) location.reload(); });
  }
  async function addTask(form) {
    var stage = Number(form.dataset.stage);
    var titleInput = form.querySelector('input[name="title"]');
    var title = titleInput.value.trim(); if (!title) { titleInput.focus(); return; }
    var typeSel = form.querySelector('select[name="type"]');
    var secSel = form.querySelector('select[name="section"]');
    var section = secSel ? secSel.value : (form.dataset.section || "");
    var payload = { stage: stage, title: title, section_id: section };
    if (typeSel) payload.type = typeSel.value;
    var r = await api("/api/projects/" + projectId + "/tasks", payload);
    if (!r) return;
    var stageEl = document.getElementById("stage-" + stage), cont;
    if (LAYOUT === "grouped") {
      var todoCol = stageEl.querySelector('.col-body[data-status="todo"]');
      cont = ensureContainer(todoCol, section);
    } else {
      cont = form.closest(".section-lane").querySelector('.col-cards[data-status="todo"]');
    }
    cont.insertAdjacentHTML("beforeend", r.html);
    titleInput.value = ""; titleInput.focus();
    var newId = r.task.id;
    pushUndo("add of “" + title + "”", async function () { var rr = await api("/api/tasks/" + newId + "/delete", {}); if (rr) location.reload(); });
    recountStageFull(stageEl); registerActivity(stage, r.task.id);
  }

  // ---- sections ----------------------------------------------------------
  async function addSection(form) {
    var stage = Number(form.dataset.stage);
    var input = form.querySelector('input[name="title"]');
    var title = input.value.trim(); if (!title) { input.focus(); return; }
    var r = await api("/api/projects/" + projectId + "/sections", { stage: stage, title: title });
    if (!r) return;
    var stageEl = document.getElementById("stage-" + stage);
    if (LAYOUT === "grouped") {
      var bar = stageEl.querySelector(".section-bar");
      var pos = stageEl.querySelectorAll(".sec-chip:not(.sec-chip-general)").length;
      var chip = document.createElement("span");
      chip.className = "sec-chip"; chip.dataset.section = r.section.id; chip.dataset.pos = pos;
      var nm = document.createElement("span"); nm.className = "sec-chip-name editable";
      nm.dataset.action = "rename-section"; nm.setAttribute("role", "button"); nm.tabIndex = 0; nm.textContent = r.section.title;
      var roll = document.createElement("span"); roll.className = "sec-chip-roll"; roll.textContent = "0/0";
      var del = document.createElement("button"); del.type = "button"; del.className = "sec-chip-del";
      del.dataset.action = "delete-section"; del.dataset.section = r.section.id; del.setAttribute("aria-label", "Delete section"); del.textContent = "×";
      chip.appendChild(nm); chip.appendChild(roll); chip.appendChild(del);
      bar.insertBefore(chip, form);
      stageEl.querySelectorAll('.add-task select[name="section"]').forEach(function (sel) {
        var o = document.createElement("option"); o.value = r.section.id; o.textContent = r.section.title; sel.appendChild(o);
      });
      input.value = "";
    } else {
      var lanes = stageEl.querySelector(".lanes");
      var general = lanes.querySelector(".section-lane.is-general");
      var temp = document.createElement("div"); temp.innerHTML = r.html.trim();
      var newLane = temp.firstElementChild;
      lanes.insertBefore(newLane, general);
      input.value = "";
      var fi = newLane.querySelector('.add-task input[name="title"]'); if (fi) fi.focus();
    }
  }
  async function deleteSection(el) {
    var id = el.dataset.section || (laneOf(el) && laneOf(el).dataset.section);
    if (!id) return;
    if (!confirm("Delete this section? Its tasks move to General.")) return;
    var r = await api("/api/sections/" + id + "/delete", {});
    if (!r) return;
    var stageEl = stageOf(el);
    if (LAYOUT === "grouped") {
      stageEl.querySelectorAll(".col-body").forEach(function (colBody) {
        var bubble = colBody.querySelector('.bubble[data-section="' + id + '"]');
        if (!bubble) return;
        var loose = colBody.querySelector(".loose-cards"), src = bubble.querySelector(".bubble-cards");
        while (src.firstElementChild) { var c = src.firstElementChild; c.dataset.section = ""; loose.appendChild(c); }
        bubble.remove();
      });
      var chip = stageEl.querySelector('.sec-chip[data-section="' + id + '"]'); if (chip) chip.remove();
      stageEl.querySelectorAll('.add-task select[name="section"] option[value="' + id + '"]').forEach(function (o) { o.remove(); });
    } else {
      var lane = laneOf(el), general = stageEl.querySelector(".section-lane.is-general");
      STATUSES.forEach(function (st) {
        var srcc = lane.querySelector('.col-cards[data-status="' + st + '"]');
        var dstc = general.querySelector('.col-cards[data-status="' + st + '"]');
        while (srcc && srcc.firstElementChild) { var c = srcc.firstElementChild; c.dataset.section = ""; dstc.appendChild(c); }
      });
      lane.remove();
    }
    recountStageFull(stageEl);
  }

  // ---- filters & collapse (persisted) -----------------------------------
  var LS_FILTERS = "arckanban-filters", LS_COLLAPSE = "arckanban-tb-collapsed", LS_LANES = "arckanban-lanes-" + projectId;
  function applyFilters(state) {
    document.body.classList.toggle("filter-urgent", !!state.urgent);
    document.body.classList.toggle("filter-statutory", !!state.statutory);
    document.body.classList.toggle("hide-done", !!state.done);
    document.querySelectorAll(".filter-btn").forEach(function (b) { b.setAttribute("aria-pressed", state[b.dataset.filter] ? "true" : "false"); });
  }
  function loadFilters() { try { return JSON.parse(localStorage.getItem(LS_FILTERS)) || {}; } catch (e) { return {}; } }
  function toggleFilter(name) { var s = loadFilters(); s[name] = !s[name]; localStorage.setItem(LS_FILTERS, JSON.stringify(s)); applyFilters(s); }
  function applyCollapse(on) { document.getElementById("titleblock").classList.toggle("is-collapsed", on); }
  function saveScope(stages) { api("/api/projects/" + projectId + "/stages", { stages: stages }).then(function (r) { if (r) location.reload(); }); }
  function applyScope() {
    var set = [];
    document.querySelectorAll('#scope-pop input[type="checkbox"]').forEach(function (b) { if (b.checked) set.push(Number(b.value)); });
    saveScope(set);
  }
  function laneKey(l) { return l.dataset.section ? "s" + l.dataset.section : "g" + l.dataset.stage; }
  function loadLanes() { try { return JSON.parse(localStorage.getItem(LS_LANES)) || {}; } catch (e) { return {}; } }
  function persistLanes() { var s = {}; document.querySelectorAll(".section-lane.is-collapsed").forEach(function (l) { s[laneKey(l)] = 1; }); localStorage.setItem(LS_LANES, JSON.stringify(s)); }
  function applyLanes() { var s = loadLanes(); document.querySelectorAll(".section-lane").forEach(function (l) { l.classList.toggle("is-collapsed", !!s[laneKey(l)]); }); }
  function toggleLane(btn) { laneOf(btn).classList.toggle("is-collapsed"); persistLanes(); }

  // ---- native drag -------------------------------------------------------
  var draggingCard = null, draggingBubble = null, lastOver = null, lastOverCol = null, dragFrom = null;
  function getDragAfterElement(container, y) {
    var els = [].slice.call(container.querySelectorAll(".card:not(.dragging)"));
    var closest = { offset: -Infinity, el: null };
    els.forEach(function (child) {
      var box = child.getBoundingClientRect(), offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) closest = { offset: offset, el: child };
    });
    return closest.el;
  }
  // FLIP: let sibling cards slide to their new spots instead of snapping.
  function flipReorder(scope, mutate) {
    if (reduceMotion) { mutate(); return; }
    var cards = [].slice.call(scope.querySelectorAll(".card:not(.dragging)"));
    // Freeze: cancel any in-flight transition/transform so we measure TRUE
    // layout positions (measuring mid-animation was why it only worked sometimes).
    cards.forEach(function (c) { c.style.transition = "none"; c.style.transform = ""; });
    var first = cards.map(function (c) { return c.getBoundingClientRect(); });
    mutate();
    cards.forEach(function (c, i) {
      var l = c.getBoundingClientRect();
      var dx = first[i].left - l.left, dy = first[i].top - l.top;
      c.style.transform = (dx || dy) ? "translate(" + dx + "px," + dy + "px)" : "";
    });
    requestAnimationFrame(function () {
      cards.forEach(function (c) {
        if (!c.style.transform) return;
        c.style.transition = "transform 160ms cubic-bezier(.2,.7,.3,1)";
        c.style.transform = "";
      });
    });
  }
  function maybePlace(container, y) {
    var after = getDragAfterElement(container, y);
    if (draggingCard.parentElement === container && after === draggingCard.nextElementSibling) return;
    flipReorder(stageOf(container) || container, function () {
      if (after == null) container.appendChild(draggingCard);
      else container.insertBefore(draggingCard, after);
    });
  }
  document.addEventListener("dragstart", function (e) {
    var card = e.target.closest(".card");
    if (card) {
      if (e.target.closest("button, select, input, textarea, a, .task-title, .awaiting-on, [contenteditable]")) { e.preventDefault(); return; }
      clearSelection();
      draggingCard = card; card.classList.add("dragging");
      dragFrom = { id: card.dataset.taskId, status: card.dataset.status, section: card.dataset.section || "", title: cardTitle(card) };
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", card.dataset.taskId); } catch (_) {}
      return;
    }
    var head = LAYOUT === "grouped" ? e.target.closest(".bubble-head") : null;
    if (head) {
      draggingBubble = head.closest(".bubble"); draggingBubble.classList.add("dragging-bubble");
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", "bubble"); } catch (_) {}
    }
  });
  track.addEventListener("dragover", function (e) {
    if (draggingBubble) {
      var cb = e.target.closest(".col-body"); if (!cb) return;
      e.preventDefault(); e.dataTransfer.dropEffect = "move";
      if (lastOverCol && lastOverCol !== cb) lastOverCol.classList.remove("drag-over");
      cb.classList.add("drag-over"); lastOverCol = cb;
      return;
    }
    if (!draggingCard) return;
    if (LAYOUT === "grouped") {
      var colBody = e.target.closest(".col-body"); if (!colBody) return;
      e.preventDefault(); e.dataTransfer.dropEffect = "move";
      if (lastOverCol && lastOverCol !== colBody) lastOverCol.classList.remove("drag-over");
      colBody.classList.add("drag-over"); lastOverCol = colBody;
      if (colBody.dataset.status === draggingCard.dataset.status) {
        var cont = containerFor(colBody, draggingCard.dataset.section || "");
        if (cont) maybePlace(cont, e.clientY);
      }
    } else {
      var container = e.target.closest(".col-cards"); if (!container) return;
      e.preventDefault(); e.dataTransfer.dropEffect = "move";
      if (lastOver && lastOver !== container) lastOver.classList.remove("drag-over");
      container.classList.add("drag-over"); lastOver = container;
      maybePlace(container, e.clientY);
    }
  });
  track.addEventListener("drop", function (e) { if (draggingCard) e.preventDefault(); });
  document.addEventListener("dragend", async function () {
    if (draggingBubble) {
      var bubble = draggingBubble; draggingBubble = null; bubble.classList.remove("dragging-bubble");
      if (lastOverCol) lastOverCol.classList.remove("drag-over");
      var sourceCol = colBodyOf(bubble), destCol = lastOverCol || sourceCol; lastOverCol = null;
      if (!sourceCol || !destCol) return;
      var fromStatus = sourceCol.dataset.status, toStatus = destCol.dataset.status, sec = bubble.dataset.section;
      if (toStatus === fromStatus) return;
      var bcards = [].slice.call(bubble.querySelectorAll(".bubble-cards > .card"));
      var secName = (bubble.querySelector(".bubble-name") || {}).textContent || "section";
      var rb = await api("/api/sections/" + sec + "/move", { from_status: fromStatus, to_status: toStatus });
      if (!rb) { location.reload(); return; }
      var destCont = ensureContainer(destCol, sec);
      bcards.forEach(function (c) { applyCardStatus(c, toStatus); destCont.appendChild(c); });
      bubble.remove();
      var sEl2 = stageOf(destCol); recountStageFull(sEl2);
      if (sEl2) sEl2.querySelectorAll(".card").forEach(function (c) { c.style.transform = ""; c.style.transition = ""; });
      bcards.forEach(function (c) { registerActivity(destCol.dataset.stage, c.dataset.taskId); });
      pushUndo("move of section “" + secName + "”", async function () {
        var rr = await api("/api/sections/" + sec + "/move", { from_status: toStatus, to_status: fromStatus });
        if (rr) location.reload();
      });
      return;
    }
    if (!draggingCard) return;
    var card = draggingCard; draggingCard = null; card.classList.remove("dragging");
    if (lastOver) { lastOver.classList.remove("drag-over"); lastOver = null; }
    if (lastOverCol) { lastOverCol.classList.remove("drag-over"); }
    var container, status, section;
    if (LAYOUT === "grouped") {
      var destCol = lastOverCol || colBodyOf(card); lastOverCol = null;
      if (!destCol) return;
      status = destCol.dataset.status; section = card.dataset.section || "";
      container = ensureContainer(destCol, section);
      if (card.parentElement !== container) container.appendChild(card);
    } else {
      container = card.closest(".col-cards"); if (!container) return;
      status = container.dataset.status; section = container.dataset.section || "";
    }
    var index = [].slice.call(container.querySelectorAll(".card")).indexOf(card);
    var r = await api("/api/tasks/" + card.dataset.taskId + "/move",
      { status: status, section_id: section || null, index: index });
    if (!r) { location.reload(); return; }
    applyCardStatus(card, status);
    card.dataset.section = section || "";
    if (dragFrom && (dragFrom.status !== status || dragFrom.section !== (section || ""))) {
      var df = dragFrom;
      pushUndo("move of “" + df.title + "”", function () { return undoMove(df.id, df.status, df.section); });
    }
    dragFrom = null;
    var sEl = stageOf(card);
    recountStageFull(sEl);
    if (sEl) sEl.querySelectorAll(".card").forEach(function (c) { c.style.transform = ""; c.style.transition = ""; });
    registerActivity(card.dataset.stage, card.dataset.taskId);
  });

  // ---- event wiring ------------------------------------------------------
  document.addEventListener("click", function (e) {
    if (selectedCard) {
      var chip = e.target.closest(".sec-chip");
      if (chip && !e.target.closest(".sec-chip-del")) { assignSelectedTo(chip.dataset.section || ""); return; }
    }
    var el = e.target.closest("[data-action], [data-filter]");
    if (el) {
      if (el.dataset.filter) { toggleFilter(el.dataset.filter); return; }
      switch (el.dataset.action) {
        case "status-prev": stepStatus(cardOf(el), -1); break;
        case "status-next": stepStatus(cardOf(el), +1); break;
        case "toggle-urgent": toggleUrgent(el); break;
        case "delete-task": deleteTask(el); break;
        case "edit-title": editTitle(el); break;
        case "edit-awaiting": editAwaiting(el); break;
        case "edit-project-number": editProjectField(el, "number"); break;
        case "edit-project-name": editProjectField(el, "name"); break;
        case "rename-section": renameSection(el); break;
        case "delete-section": deleteSection(el); break;
        case "toggle-lane": toggleLane(el); break;
        case "set-current": setCurrentStage(el.dataset.stage); break;
        case "goto-stage": { var gs = Number(el.dataset.stage); if (isEnabled(gs)) { lastActive = gs; gotoStage(gs); } break; }
        case "nav-prev": { var pe = nextEnabled(activeStage(), -1); if (pe != null) { lastActive = pe; gotoStage(pe); } break; }
        case "nav-next": { var ne = nextEnabled(activeStage(), +1); if (ne != null) { lastActive = ne; gotoStage(ne); } break; }
        case "toggle-scope": { var sp = document.getElementById("scope-pop"); sp.hidden = !sp.hidden; break; }
        case "apply-scope": applyScope(); break;
        case "enable-stage": { var set = enabledStages.slice(); var es = Number(el.dataset.stage); if (set.indexOf(es) < 0) set.push(es); saveScope(set); break; }
        case "toggle-titleblock": {
          var on = !document.getElementById("titleblock").classList.contains("is-collapsed");
          applyCollapse(on); localStorage.setItem(LS_COLLAPSE, on ? "1" : "0"); break;
        }
        case "toggle-log": {
          var d = document.getElementById("log-drawer");
          d.setAttribute("aria-hidden", d.classList.toggle("open") ? "false" : "true"); break;
        }
        case "nudge-set": setCurrentStage(document.getElementById("nudge").dataset.stage); break;
        case "nudge-dismiss": { var s = Number(document.getElementById("nudge").dataset.stage); dismissed[s] = true; document.getElementById("nudge").hidden = true; break; }
      }
      return;
    }
    if (LAYOUT === "grouped") {
      var card = e.target.closest(".card");
      if (card && !e.target.closest("button, select, input, textarea, a, .task-title, .awaiting-on, [contenteditable]")) selectCard(card);
      else if (!card) clearSelection();
    }
  });
  document.addEventListener("change", function (e) { if (e.target.matches(".type-select")) changeType(e.target); });
  document.addEventListener("contextmenu", function (e) {
    var card = e.target.closest(".card");
    if (card) { e.preventDefault(); openSectionMenu(card, e.clientX, e.clientY); return; }
    if (e.target.closest("input, textarea, select")) return;   // keep the native menu on fields
    e.preventDefault(); openActionsMenu(e.clientX, e.clientY);
  });
  document.addEventListener("click", function (e) {
    if (ctxMenu && !e.target.closest(".ctx-menu")) closeMenu();
    var sp = document.getElementById("scope-pop");
    if (sp && !sp.hidden && !e.target.closest("#scope-pop") && !e.target.closest('[data-action="toggle-scope"]')) sp.hidden = true;
  });
  track.addEventListener("scroll", closeMenu);
  document.addEventListener("submit", function (e) {
    var add = e.target.closest('[data-action="add-task"]'); if (add) { e.preventDefault(); addTask(add); return; }
    var sec = e.target.closest('[data-action="add-section"]'); if (sec) { e.preventDefault(); addSection(sec); }
  });
  document.addEventListener("keydown", function (e) {
    var t = e.target;
    if (e.key === "Enter" || e.key === " ") {
      if (t.matches(".spine-cell, .task-title, .tb-cell, .awaiting-on, .lane-title, .sec-chip-name")) { e.preventDefault(); t.click(); }
      return;
    }
    if (e.key === "Escape") { closeMenu(); clearSelection(); return; }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (t.matches("input, select, textarea, [contenteditable]")) return;
      var te = nextEnabled(activeStage(), e.key === "ArrowRight" ? 1 : -1);
      if (te != null) { lastActive = te; gotoStage(te); }
    }
  });

  // ---- init --------------------------------------------------------------
  applyFilters(loadFilters());
  applyCollapse(localStorage.getItem(LS_COLLAPSE) === "1");
  applyLanes();
  updateUrgentTally();
  var saved = null; try { saved = localStorage.getItem(LS_STAGE); } catch (e) {}
  var startN = (saved != null && saved !== "" && isEnabled(Number(saved))) ? Number(saved) : currentStage;
  gotoStage(startN, true);
})();
