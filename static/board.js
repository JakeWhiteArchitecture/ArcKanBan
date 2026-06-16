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

  var STATUSES = ["backlog", "upcoming", "todo", "awaiting", "done"];
  var STATUS_LABELS = { backlog: "Backlog", upcoming: "Upcoming", todo: "To Do", awaiting: "Awaiting", done: "Done" };
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
    if (json.event) addLogEvent(json.event);
    else if (json.omit_last) removeLastLogEvent();
    return json;
  }

  // ---- activity log + undo helpers --------------------------------------
  function addLogEvent(ev) {
    var list = document.getElementById("log-list"); if (!list || !ev) return;
    var empty = list.querySelector(".log-empty"); if (empty) empty.remove();
    var li = document.createElement("li"); li.className = "log-item";
    var t = document.createElement("span"); t.className = "log-text"; t.textContent = ev.text;
    var w = document.createElement("time"); w.className = "log-when"; w.textContent = ev.when;
    li.appendChild(t); li.appendChild(w);
    list.appendChild(li);                  // latest entries at the bottom
    list.scrollTop = list.scrollHeight;    // keep the newest in view
  }
  function removeLastLogEvent() {
    var list = document.getElementById("log-list"); if (!list) return;
    var items = list.querySelectorAll(".log-item");
    if (items.length) items[items.length - 1].remove();
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
  function stageHasCards(n) { var el = document.getElementById("stage-" + n); return !!(el && el.querySelector(".card")); }

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
    var fn = document.querySelector(".tb-focus-name"); if (fn) fn.textContent = RIBA[n];
    var ds = document.querySelector(".dock-stage"); if (ds) ds.textContent = "Stage " + n;
    var star = document.querySelector(".tb-star");
    if (star) { var cur = n === currentStage; star.textContent = cur ? "★" : "☆"; star.classList.toggle("is-current", cur); }
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
    document.getElementById("nudge").hidden = true;
    gotoStage(n);      // also refreshes the focused-stage name + star via updateNav
    evaluateNudge();
  }

  // ---- inline editing ----------------------------------------------------
  function editInline(displayEl, currentText, onSave, listId) {
    if (displayEl.dataset.editing) return;
    displayEl.dataset.editing = "1";
    var input = document.createElement("input");
    input.type = "text"; input.className = "title-input"; input.value = currentText;
    if (listId) { input.setAttribute("list", listId); input.setAttribute("autocomplete", "off"); }
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
  function rememberAssignee(val) {
    var dl = document.getElementById("assignee-suggestions"); if (!dl || !val) return;
    var has = Array.prototype.some.call(dl.options, function (o) { return o.value.toLowerCase() === val.toLowerCase(); });
    if (!has) { var o = document.createElement("option"); o.value = val; dl.appendChild(o); }
  }
  function editAwaiting(box) {
    var id = cardOf(box).dataset.taskId, textEl = box.querySelector(".awaiting-text");
    var current = textEl.classList.contains("is-empty") ? "" : textEl.textContent.trim();
    editInline(textEl, current, async function (val, changed) {
      if (val === null) { renderAwaiting(textEl, current); return; }
      if (changed) await api("/api/tasks/" + id, { awaiting_on: val });
      renderAwaiting(textEl, changed ? val : current);
      if (val) rememberAssignee(val);   // new names autocomplete next time, this project
    }, "assignee-suggestions");
  }
  function renderAwaiting(textEl, val) {
    if (val) { textEl.textContent = val; textEl.classList.remove("is-empty"); }
    else {
      var card = textEl.closest(".card");
      textEl.textContent = (card && card.dataset.type === "decision") ? "decision by?" : "who / what?";
      textEl.classList.add("is-empty");
    }
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
  // rename/delete are driven from the Sections popup (rows keyed by section id);
  // the popup always reflects the stage in view, so updates target that stage.
  function renameSection(titleEl) {
    var id = titleEl.closest("[data-section]").dataset.section;
    var text = titleEl.textContent.trim();
    editInline(titleEl, text, async function (val, changed) {
      if (val === null || !changed || !val) { titleEl.textContent = text; return; }
      var r = await api("/api/sections/" + id, { title: val });
      if (!r) { titleEl.textContent = text; return; }
      titleEl.textContent = val;
      var stageEl = document.getElementById("stage-" + activeStage());
      if (stageEl) {
        stageEl.querySelectorAll('.bubble[data-section="' + id + '"] .bubble-name').forEach(function (n) { n.textContent = val; });
        stageEl.querySelectorAll('.sec-chip[data-section="' + id + '"] .sec-chip-name').forEach(function (n) { n.textContent = val; });
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
    var chev = document.createElement("button"); chev.type = "button"; chev.className = "bubble-collapse";
    chev.dataset.action = "toggle-bubble"; chev.setAttribute("aria-label", "Collapse section");
    chev.innerHTML = '<span class="chevron">▾</span>';
    var nm = document.createElement("span"); nm.className = "bubble-name"; nm.textContent = sectionTitle(stageEl, sec);
    var ct = document.createElement("span"); ct.className = "bubble-count"; ct.textContent = "0";
    head.appendChild(chev); head.appendChild(nm); head.appendChild(ct);
    var cards = document.createElement("div");
    cards.className = "col-cards bubble-cards";
    cards.dataset.stage = colBody.dataset.stage; cards.dataset.status = colBody.dataset.status; cards.dataset.section = sec;
    bubble.appendChild(head); bubble.appendChild(cards);
    if (loadBubbles().has(sec)) bubble.classList.add("is-collapsed");
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
  // ---- decisions: options + confirmed outcome (decision register) -------
  function decBlock(card) { return card.querySelector(".dec-block"); }
  function decOutcome(card) { var o = card.querySelector(".dec-outcome-text"); return o ? o.textContent.trim() : ""; }
  // Build the decision block on a card that's just become a decision (the
  // server only renders it for tasks already typed as decisions).
  function ensureDecBlock(card) {
    if (card.querySelector(".dec-block")) return;
    var block = document.createElement("div"); block.className = "dec-block";
    var actions = document.createElement("div"); actions.className = "dec-actions";
    var add = document.createElement("button"); add.type = "button"; add.className = "dec-add"; add.dataset.action = "add-option"; add.textContent = "+ option";
    actions.appendChild(add); block.appendChild(actions);   // "Other…" appears once >1 option exists
    card.appendChild(block);
  }
  function removeDecBlock(card) { var b = card.querySelector(".dec-block"); if (b) b.remove(); }
  // "Other…" is only offered once there's more than one option to choose between.
  function updateDecOther(card) {
    var block = decBlock(card); if (!block) return;
    var actions = block.querySelector(".dec-actions"); if (!actions) return;
    var count = block.querySelectorAll(".dec-option").length, other = actions.querySelector(".dec-other");
    if (count > 1 && !other) {
      other = document.createElement("button"); other.type = "button"; other.className = "dec-other";
      other.dataset.action = "confirm-other"; other.textContent = "Other…";
      actions.appendChild(other);
    } else if (count <= 1 && other) { other.remove(); }
  }
  function renderOption(id, text) {
    var li = document.createElement("li"); li.className = "dec-option"; li.dataset.optionId = id;
    var c = document.createElement("button"); c.type = "button"; c.className = "dec-confirm";
    c.dataset.action = "confirm-option"; c.title = "Confirm this choice"; c.setAttribute("aria-label", "Confirm this choice"); c.textContent = "✓";
    var t = document.createElement("span"); t.className = "dec-option-text"; t.textContent = text;
    var d = document.createElement("button"); d.type = "button"; d.className = "dec-option-del";
    d.dataset.action = "delete-option"; d.setAttribute("aria-label", "Remove option"); d.textContent = "×";
    li.appendChild(c); li.appendChild(t); li.appendChild(d); return li;
  }
  function ensureDecOptionsUl(card) {
    var block = decBlock(card); var ul = block.querySelector(".dec-options");
    if (!ul) { ul = document.createElement("ul"); ul.className = "dec-options"; block.insertBefore(ul, block.querySelector(".dec-actions")); }
    return ul;
  }
  async function addOption(card, text) {
    var r = await api("/api/tasks/" + card.dataset.taskId + "/options", { text: text });
    if (!r) return;
    ensureDecOptionsUl(card).appendChild(renderOption(r.option.id, r.option.text));
    updateDecOther(card);
  }
  async function deleteOption(btn) {
    var card = cardOf(btn), li = btn.closest(".dec-option"); if (!li) return;
    var r = await api("/api/options/" + li.dataset.optionId + "/delete", {});
    if (r) { li.remove(); updateDecOther(card); }
  }
  async function confirmDecision(card, text, addOpt) {
    var r = await api("/api/tasks/" + card.dataset.taskId + "/confirm", { text: text, add_option: !!addOpt });
    if (!r) return;
    if (r.option) {
      var ul = ensureDecOptionsUl(card);
      if (!ul.querySelector('[data-option-id="' + r.option.id + '"]')) ul.appendChild(renderOption(r.option.id, r.option.text));
      updateDecOther(card);
    }
    setDecisionOutcome(card, r.outcome);
  }
  async function clearDecision(card) {
    var r = await api("/api/tasks/" + card.dataset.taskId + "/unconfirm", {});
    if (r) setDecisionOutcome(card, "");
  }
  function setDecisionOutcome(card, outcome) {
    var block = decBlock(card); if (!block) return;
    var banner = block.querySelector(".dec-outcome");
    if (outcome) {
      if (!banner) {
        banner = document.createElement("div"); banner.className = "dec-outcome";
        banner.innerHTML = '<span class="dec-check">✓</span> <span class="dec-outcome-text"></span>' +
          '<button type="button" class="dec-clear" data-action="clear-decision" aria-label="Reopen decision" title="Reopen decision">×</button>';
        block.insertBefore(banner, block.firstChild);
      }
      banner.querySelector(".dec-outcome-text").textContent = outcome;
    } else if (banner) { banner.remove(); }
    block.querySelectorAll(".dec-option").forEach(function (li) {
      li.classList.toggle("is-chosen", !!outcome && li.querySelector(".dec-option-text").textContent.trim() === outcome);
    });
  }
  // Inline "add an option" (and the "Other…" variant, which also confirms it).
  function startAddOption(card, confirmAfter) {
    var block = decBlock(card); if (!block) return;
    var existing = block.querySelector(".dec-option-input"); if (existing) { existing.focus(); return; }
    var input = document.createElement("input"); input.type = "text"; input.className = "dec-option-input";
    input.placeholder = confirmAfter ? "Type the decision…" : "Add an option…";
    block.insertBefore(input, block.querySelector(".dec-actions")); input.focus();
    var done = false;
    function finish(commit) {
      if (done) return; done = true;
      var val = input.value.trim(); input.remove();
      if (commit && val) { if (confirmAfter) confirmDecision(card, val, true); else addOption(card, val); }
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        var val = input.value.trim();
        if (!confirmAfter && val) { addOption(card, val); input.value = ""; return; }   // keep adding
        finish(true);
      } else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    });
    input.addEventListener("blur", function () { finish(true); });
  }

  function openSectionMenu(card, x, y) {
    closeMenu();
    var stageEl = stageOf(card), cur = card.dataset.section || "";
    var menu = document.createElement("div"); menu.className = "ctx-menu";
    if (card.dataset.type === "decision") {       // confirm-choice section first
      var dh = document.createElement("div"); dh.className = "ctx-head"; dh.textContent = "Confirm decision"; menu.appendChild(dh);
      var outcome = decOutcome(card);
      card.querySelectorAll(".dec-option .dec-option-text").forEach(function (span) {
        var text = span.textContent.trim();
        var it = document.createElement("div"); it.className = "ctx-item" + (text === outcome ? " is-current" : "");
        var s = document.createElement("span"); s.textContent = text; it.appendChild(s);
        if (text !== outcome) it.addEventListener("click", function () { confirmDecision(card, text, false); closeMenu(); });
        menu.appendChild(it);
      });
      var other = document.createElement("div"); other.className = "ctx-item";
      var os = document.createElement("span"); os.textContent = "Other…"; other.appendChild(os);
      other.addEventListener("click", function () { closeMenu(); startAddOption(card, true); });
      menu.appendChild(other);
      if (outcome) {
        var clr = document.createElement("div"); clr.className = "ctx-item";
        var cs = document.createElement("span"); cs.textContent = "Clear decision"; clr.appendChild(cs);
        clr.addEventListener("click", function () { clearDecision(card); closeMenu(); });
        menu.appendChild(clr);
      }
      var sep = document.createElement("div"); sep.className = "ctx-sep"; menu.appendChild(sep);
    }
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
    card.classList.remove("status-backlog", "status-upcoming", "status-todo", "status-awaiting", "status-done");
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
    card.classList.remove("type-statutory", "type-recommended", "type-process", "type-decision");
    card.classList.add("type-" + newType);
    if (newType === "decision") ensureDecBlock(card); else removeDecBlock(card);   // options UI appears/leaves with the type
    var at = card.querySelector(".awaiting-text"); if (at && at.classList.contains("is-empty")) renderAwaiting(at, "");
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
    var id = el.dataset.section; if (!id) return;
    if (!confirm("Delete this section? Its tasks move to General.")) return;
    var r = await api("/api/sections/" + id + "/delete", {});
    if (!r) return;
    var stageEl = document.getElementById("stage-" + activeStage());
    if (stageEl) {
      stageEl.querySelectorAll(".col-body").forEach(function (colBody) {
        var bubble = colBody.querySelector('.bubble[data-section="' + id + '"]');
        if (!bubble) return;
        var loose = colBody.querySelector(".loose-cards"), src = bubble.querySelector(".bubble-cards");
        while (src.firstElementChild) { var c = src.firstElementChild; c.dataset.section = ""; loose.appendChild(c); }
        bubble.remove();
      });
      var chip = stageEl.querySelector('.sec-chip[data-section="' + id + '"]'); if (chip) chip.remove();
      stageEl.querySelectorAll('.add-task select[name="section"] option[value="' + id + '"]').forEach(function (o) { o.remove(); });
      recountStageFull(stageEl);
    }
    var row = document.querySelector('#sections-pop .sec-row[data-section="' + id + '"]'); if (row) row.remove();
    var list = document.querySelector("#sections-pop .sections-list");
    if (list && !list.querySelector(".sec-row")) renderSectionsList(stageEl);   // show the empty hint
  }

  // ---- Sections popup (add / rename / delete for the stage in view) ------
  function renderSectionsList(stageEl) {
    var pop = document.getElementById("sections-pop"); if (!pop) return;
    var list = pop.querySelector(".sections-list"); list.innerHTML = "";
    var chips = stageEl ? stageEl.querySelectorAll(".sec-chip:not(.sec-chip-general)") : [];
    if (!chips.length) {
      var e = document.createElement("div"); e.className = "sections-empty";
      e.textContent = "No sections yet — add one below."; list.appendChild(e); return;
    }
    chips.forEach(function (ch) {
      var id = ch.dataset.section, name = ch.querySelector(".sec-chip-name").textContent.trim();
      var rollEl = ch.querySelector(".sec-chip-roll");
      var row = document.createElement("div"); row.className = "sec-row"; row.dataset.section = id;
      var nm = document.createElement("span"); nm.className = "sec-row-name"; nm.dataset.action = "rename-section";
      nm.setAttribute("role", "button"); nm.tabIndex = 0; nm.title = "Rename"; nm.textContent = name;
      var rl = document.createElement("span"); rl.className = "sec-row-roll"; rl.textContent = rollEl ? rollEl.textContent.trim() : "";
      var del = document.createElement("button"); del.type = "button"; del.className = "sec-row-del";
      del.dataset.action = "delete-section"; del.dataset.section = id;
      del.setAttribute("aria-label", "Delete section"); del.title = "Delete section (tasks → General)"; del.textContent = "×";
      row.appendChild(nm); row.appendChild(rl); row.appendChild(del);
      list.appendChild(row);
    });
  }
  function openSections() {
    var pop = document.getElementById("sections-pop"); if (!pop) return;
    var n = activeStage(), stageEl = document.getElementById("stage-" + n);
    var lbl = pop.querySelector(".sections-stage"); if (lbl) lbl.textContent = "Stage " + n + " · " + RIBA[n];
    renderSectionsList(stageEl);
    closePops("sections-pop"); pop.hidden = false;
    var ti = pop.querySelector(".sections-add input"); if (ti) ti.value = "";
  }
  async function addSectionPop(form) {
    var stage = activeStage();
    var input = form.querySelector('input[name="title"]');
    var title = input.value.trim(); if (!title) { input.focus(); return; }
    var r = await api("/api/projects/" + projectId + "/sections", { stage: stage, title: title });
    if (!r) return;
    var stageEl = document.getElementById("stage-" + stage);
    if (stageEl) {
      var reg = stageEl.querySelector(".section-reg");
      var pos = stageEl.querySelectorAll(".sec-chip:not(.sec-chip-general)").length;
      var chip = document.createElement("span");
      chip.className = "sec-chip"; chip.dataset.section = r.section.id; chip.dataset.pos = pos;
      var nm = document.createElement("span"); nm.className = "sec-chip-name"; nm.textContent = r.section.title;
      var roll = document.createElement("span"); roll.className = "sec-chip-roll"; roll.textContent = "0/0";
      chip.appendChild(nm); chip.appendChild(roll);
      if (reg) reg.appendChild(chip);
      stageEl.querySelectorAll('.add-task select[name="section"]').forEach(function (sel) {
        var o = document.createElement("option"); o.value = r.section.id; o.textContent = r.section.title; sel.appendChild(o);
      });
      renderSectionsList(stageEl);
    }
    input.value = ""; input.focus();
  }

  // ---- filters & collapse (persisted) -----------------------------------
  var LS_FILTERS = "arckanban-filters", LS_LANES = "arckanban-lanes-" + projectId;
  function applyFilters(state) {
    document.body.classList.toggle("filter-urgent", !!state.urgent);
    document.body.classList.toggle("filter-statutory", !!state.statutory);
    document.body.classList.toggle("hide-done", !!state.done);
    document.querySelectorAll(".filter-btn").forEach(function (b) { b.setAttribute("aria-pressed", state[b.dataset.filter] ? "true" : "false"); });
    var fb = document.getElementById("filter-btn");
    if (fb) fb.classList.toggle("has-active", !!(state.urgent || state.statutory || state.done));
  }
  function loadFilters() { try { return JSON.parse(localStorage.getItem(LS_FILTERS)) || {}; } catch (e) { return {}; } }
  function toggleFilter(name) { var s = loadFilters(); s[name] = !s[name]; localStorage.setItem(LS_FILTERS, JSON.stringify(s)); applyFilters(s); }
  // ---- titleblock popovers (filters / more / scope / create) ------------
  var POP_IDS = ["filter-pop", "more-pop", "create-pop", "sections-pop"];
  function closePops(except) {
    POP_IDS.forEach(function (id) { if (id === except) return; var el = document.getElementById(id); if (el) el.hidden = true; });
  }
  function togglePop(id) {
    var el = document.getElementById(id); if (!el) return;
    var willOpen = el.hidden; closePops(id); el.hidden = !willOpen;
  }
  function anyPopOpen() { return POP_IDS.some(function (id) { var el = document.getElementById(id); return el && !el.hidden; }); }

  // ---- create-task widget -----------------------------------------------
  function openCreate() {
    var pop = document.getElementById("create-pop"); if (!pop) return;
    var n = activeStage(), stageEl = document.getElementById("stage-" + n);
    pop.dataset.stage = n;
    var lbl = pop.querySelector(".create-stage"); if (lbl) lbl.textContent = "Stage " + n + " · " + RIBA[n];
    var secSel = pop.querySelector(".create-section");
    secSel.innerHTML = '<option value="">General</option>';
    if (stageEl) stageEl.querySelectorAll(".sec-chip:not(.sec-chip-general)").forEach(function (ch) {
      var o = document.createElement("option");
      o.value = ch.dataset.section; o.textContent = ch.querySelector(".sec-chip-name").textContent.trim();
      secSel.appendChild(o);
    });
    closePops("create-pop"); pop.hidden = false;
    var ti = pop.querySelector(".create-title"); ti.value = ""; ti.focus();
  }
  async function createSave(closeAfter) {
    var pop = document.getElementById("create-pop"); if (!pop) return;
    var ti = pop.querySelector(".create-title"), title = ti.value.trim();
    if (!title) { if (closeAfter) pop.hidden = true; else ti.focus(); return; }
    var stage = Number(pop.dataset.stage);
    var type = pop.querySelector(".create-type").value;
    var status = pop.querySelector(".create-status").value;
    var section = pop.querySelector(".create-section").value;
    var r = await api("/api/projects/" + projectId + "/tasks",
      { stage: stage, title: title, type: type, status: status, section_id: section });
    if (!r) return;
    var stageEl = document.getElementById("stage-" + stage);
    if (stageEl) {
      var destCol = stageEl.querySelector('.col-body[data-status="' + status + '"]');
      if (destCol) {
        var cont = ensureContainer(destCol, section);
        cont.insertAdjacentHTML("beforeend", r.html);
        recountStageFull(stageEl);
      }
    }
    var newId = r.task.id;
    pushUndo("add of “" + title + "”", async function () { var rr = await api("/api/tasks/" + newId + "/delete", {}); if (rr) location.reload(); });
    registerActivity(stage, newId);
    if (closeAfter) { pop.hidden = true; dockHideSoon(); }
    else { ti.value = ""; ti.focus(); }   // keep open for rapid multi-add
  }

  // ---- auto-hide dock ----------------------------------------------------
  var LS_DOCK = "arckanban-dock", dockTimer = null, dockHover = false;
  function dockEnabled() { return document.body.classList.contains("dock-mode"); }
  function setDockMode(on) {
    document.body.classList.toggle("dock-mode", on);
    if (!on) document.body.classList.remove("dock-open");
    var cb = document.querySelector(".tb-collapse"); if (cb) cb.title = on ? "Pin the top bar open" : "Auto-hide the top bar";
    try { localStorage.setItem(LS_DOCK, on ? "1" : "0"); } catch (e) {}
  }
  function dockReveal() { if (dockEnabled()) { clearTimeout(dockTimer); document.body.classList.add("dock-open"); } }
  function dockHideSoon() {
    if (!dockEnabled()) return;
    clearTimeout(dockTimer);
    dockTimer = setTimeout(function () { if (!dockHover && !anyPopOpen()) document.body.classList.remove("dock-open"); }, 300);
  }
  function dockEnter() { dockHover = true; dockReveal(); }
  function dockLeave() { dockHover = false; dockHideSoon(); }

  // Appointment scope is managed on the register page now; the board keeps only
  // the in-context "Add to scope" affordance on a disabled-stage placeholder.
  function saveScope(stages) { api("/api/projects/" + projectId + "/stages", { stages: stages }).then(function (r) { if (r) location.reload(); }); }
  function laneKey(l) { return l.dataset.section ? "s" + l.dataset.section : "g" + l.dataset.stage; }
  function loadLanes() { try { return JSON.parse(localStorage.getItem(LS_LANES)) || {}; } catch (e) { return {}; } }
  function persistLanes() { var s = {}; document.querySelectorAll(".section-lane.is-collapsed").forEach(function (l) { s[laneKey(l)] = 1; }); localStorage.setItem(LS_LANES, JSON.stringify(s)); }
  function applyLanes() { var s = loadLanes(); document.querySelectorAll(".section-lane").forEach(function (l) { l.classList.toggle("is-collapsed", !!s[laneKey(l)]); }); }
  function toggleLane(btn) { laneOf(btn).classList.toggle("is-collapsed"); persistLanes(); }

  // collapse section bubbles (grouped) — folds a whole section across columns, persisted
  var LS_BUBBLES = "arckanban-bubbles-" + projectId;
  function loadBubbles() { try { return new Set(JSON.parse(localStorage.getItem(LS_BUBBLES)) || []); } catch (e) { return new Set(); } }
  function applyBubbles() { var s = loadBubbles(); document.querySelectorAll(".bubble").forEach(function (b) { if (s.has(b.dataset.section)) b.classList.add("is-collapsed"); }); }
  function toggleBubble(btn) {
    var bubble = btn.closest(".bubble"); if (!bubble) return;
    var sec = bubble.dataset.section; if (!sec) return;
    var collapsed = !bubble.classList.contains("is-collapsed");
    stageOf(btn).querySelectorAll('.bubble[data-section="' + sec + '"]').forEach(function (b) { b.classList.toggle("is-collapsed", collapsed); });
    var s = loadBubbles(); if (collapsed) s.add(sec); else s.delete(sec);
    localStorage.setItem(LS_BUBBLES, JSON.stringify(Array.from(s)));
  }

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
    // First: each card's *current on-screen* position (includes any in-flight slide).
    var first = cards.map(function (c) { return c.getBoundingClientRect(); });
    mutate();
    cards.forEach(function (c, i) {
      // Cancel any running slide → card reverts to its base, then measure the new layout.
      if (c._flip) { c._flip.cancel(); c._flip = null; }
      var l = c.getBoundingClientRect();
      var dx = first[i].left - l.left, dy = first[i].top - l.top;
      if (!dx && !dy) return;
      // Web Animations API: interruption-safe — a new reorder cancels the prior run and
      // slides on from where the card currently is, so it never falls back to a snap
      // (no CSS-transition flush or rAF timing to miss).
      c._flip = c.animate(
        [{ transform: "translate(" + dx + "px," + dy + "px)" }, { transform: "translate(0px,0px)" }],
        { duration: 170, easing: "cubic-bezier(.2,.7,.3,1)" }
      );
      c._flip.onfinish = function () { c._flip = null; };
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
    if (head && !e.target.closest(".bubble-collapse")) {
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
      lastOverCol = colBody;
      if (colBody.dataset.status === draggingCard.dataset.status) {
        var cont = containerFor(colBody, draggingCard.dataset.section || "");
        if (cont) maybePlace(cont, e.clientY);   // slide into its section bubble
      } else if (draggingCard.parentElement !== colBody) {
        // cross-column: slide the card itself into the destination column (no highlight)
        flipReorder(stageOf(colBody), function () { colBody.appendChild(draggingCard); });
      }
    } else {
      var container = e.target.closest(".col-cards"); if (!container) return;
      e.preventDefault(); e.dataTransfer.dropEffect = "move";
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
        case "add-option": startAddOption(cardOf(el), false); break;
        case "confirm-other": startAddOption(cardOf(el), true); break;
        case "confirm-option": { var dli = el.closest(".dec-option"); if (dli) confirmDecision(cardOf(el), dli.querySelector(".dec-option-text").textContent.trim(), false); break; }
        case "delete-option": deleteOption(el); break;
        case "clear-decision": clearDecision(cardOf(el)); break;
        case "edit-title": editTitle(el); break;
        case "edit-awaiting": editAwaiting(el); break;
        case "edit-project-number": editProjectField(el, "number"); break;
        case "edit-project-name": editProjectField(el, "name"); break;
        case "rename-section": renameSection(el); break;
        case "delete-section": deleteSection(el); break;
        case "toggle-lane": toggleLane(el); break;
        case "toggle-bubble": toggleBubble(el); break;
        case "set-current": setCurrentStage(el.dataset.stage); break;
        case "star-current": setCurrentStage(activeStage()); break;
        case "goto-stage": { var gs = Number(el.dataset.stage); if (isEnabled(gs)) { lastActive = gs; gotoStage(gs); } break; }
        case "nav-prev": { var pe = nextEnabled(activeStage(), -1); if (pe != null) { lastActive = pe; gotoStage(pe); } break; }
        case "nav-next": { var ne = nextEnabled(activeStage(), +1); if (ne != null) { lastActive = ne; gotoStage(ne); } break; }
        case "create-open": openCreate(); break;
        case "create-save": createSave(false); break;
        case "create-close": createSave(true); break;
        case "toggle-filters": togglePop("filter-pop"); break;
        case "toggle-more": togglePop("more-pop"); break;
        case "toggle-sections": { var secp = document.getElementById("sections-pop"); if (secp.hidden) openSections(); else secp.hidden = true; break; }
        case "dock-peek": if (document.body.classList.contains("dock-open")) document.body.classList.remove("dock-open"); else dockReveal(); break;
        case "enable-stage": { var set = enabledStages.slice(); var es = Number(el.dataset.stage); if (set.indexOf(es) < 0) set.push(es); saveScope(set); break; }
        case "toggle-titleblock": setDockMode(!dockEnabled()); break;
        case "toggle-log": {
          var d = document.getElementById("log-drawer");
          var lopen = d.classList.toggle("open");
          d.setAttribute("aria-hidden", lopen ? "false" : "true");
          if (lopen) { var ll = document.getElementById("log-list"); if (ll) ll.scrollTop = ll.scrollHeight; }
          break;
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
    var inPop = e.target.closest(".tb-pop");
    var onTrigger = e.target.closest('[data-action="toggle-filters"], [data-action="toggle-more"], [data-action="create-open"], [data-action="toggle-sections"]');
    if (!inPop && !onTrigger) closePops();
    if (dockEnabled() && !e.target.closest(".titleblock, .dock-handle, .tb-pop")) dockHideSoon();
  });
  track.addEventListener("scroll", closeMenu);
  document.addEventListener("submit", function (e) {
    var add = e.target.closest('[data-action="add-task"]'); if (add) { e.preventDefault(); addTask(add); return; }
    var secp = e.target.closest('[data-action="add-section-pop"]'); if (secp) { e.preventDefault(); addSectionPop(secp); return; }
    var sec = e.target.closest('[data-action="add-section"]'); if (sec) { e.preventDefault(); addSection(sec); }
  });
  document.addEventListener("keydown", function (e) {
    var t = e.target;
    if (e.key === "Enter" || e.key === " ") {
      if (t.matches(".spine-cell, .task-title, .tb-cell, .awaiting-on, .lane-title, .sec-row-name")) { e.preventDefault(); t.click(); }
      return;
    }
    if (e.key === "Escape") { closeMenu(); clearSelection(); closePops(); dockHideSoon(); return; }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (t.matches("input, select, textarea, [contenteditable]")) return;
      var te = nextEnabled(activeStage(), e.key === "ArrowRight" ? 1 : -1);
      if (te != null) { lastActive = te; gotoStage(te); }
    }
  });

  // ---- init --------------------------------------------------------------
  applyFilters(loadFilters());
  applyLanes();
  applyBubbles();
  updateUrgentTally();
  // Auto-hide dock: default ON (conceal the bar for maximum board real estate)
  // unless the user has pinned it open before. Hover the handle / bar to reveal.
  var savedDock = null; try { savedDock = localStorage.getItem(LS_DOCK); } catch (e) {}
  setDockMode(savedDock === null ? true : savedDock === "1");
  var tbEl = document.getElementById("titleblock"), dhEl = document.querySelector(".dock-handle");
  if (tbEl) {
    tbEl.addEventListener("mouseenter", dockEnter);
    tbEl.addEventListener("mouseleave", dockLeave);
    tbEl.addEventListener("focusin", dockReveal);
    tbEl.addEventListener("focusout", dockHideSoon);
  }
  if (dhEl) { dhEl.addEventListener("mouseenter", dockEnter); dhEl.addEventListener("mouseleave", dockLeave); }
  var drEl = document.querySelector(".dock-rail");
  if (drEl) { drEl.addEventListener("mouseenter", dockEnter); drEl.addEventListener("mouseleave", dockLeave); }
  var saved = null; try { saved = localStorage.getItem(LS_STAGE); } catch (e) {}
  var startN;
  if (saved != null && saved !== "" && isEnabled(Number(saved))) {
    startN = Number(saved);
  } else {
    startN = currentStage;
    // Fresh project (no remembered stage): if the current stage is empty — e.g.
    // a template whose tasks sit in later stages — open on the first enabled
    // stage that actually has cards, so the board never looks empty.
    if (!stageHasCards(startN)) {
      for (var si = 0; si <= 7; si++) { if (isEnabled(si) && stageHasCards(si)) { startN = si; break; } }
    }
  }
  gotoStage(startN, true);
})();
