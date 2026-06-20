/* ArcKanban — board interactions.
   Status-primary layout: five status columns, each grouping cards into section
   bubbles + a loose area. Drag changes status and auto-regroups into the
   section's bubble; click a card to link its section across columns; sections
   are managed in the Sections popup. Horizontal stage paging throughout, with
   status steppers as the click fallback. Decision tasks carry options + a
   confirmed outcome. Everything persists via small JSON endpoints, no reload. */
(function () {
  "use strict";

  var STATUSES = ["backlog", "upcoming", "todo", "inprogress", "awaiting", "done"];
  var STATUS_LABELS = { backlog: "Stage goals", upcoming: "Upcoming", todo: "To Do", inprogress: "In Progress", awaiting: "Awaiting", done: "Done" };
  var RIBA = [
    "Strategic Definition", "Preparation and Briefing", "Concept Design",
    "Spatial Coordination", "Technical Design", "Manufacturing and Construction",
    "Handover", "Use",
  ];

  var board = document.querySelector(".board");
  if (!board) return;
  var track = document.getElementById("stage-track");
  var projectId = Number(board.dataset.projectId);
  var projectUid = board.dataset.projectUid;
  var currentStage = Number(board.dataset.currentStage);
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var enabledStages = (board.dataset.stages || "0,1,2,3,4,5,6,7").split(",").map(Number);
  function isEnabled(n) { return enabledStages.indexOf(Number(n)) >= 0; }

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
  function stageOf(el) { return el.closest(".stage"); }
  function colBodyOf(el) { return el.closest(".col-body"); }
  function pageHasCards(p) { var el = document.getElementById("stage-" + p); return !!(el && el.querySelector(".card")); }

  // ---- horizontal navigation (page-based) --------------------------------
  // The board is a flat list of pages: one per in-scope stage, or several when a
  // stage is split into sub-stages (4a/4b…). A page no longer equals the RIBA
  // stage number, so navigation keys off the page index and reads the stage/part
  // each page carries; `currentStage` stays a RIBA stage (the ★ / nudge concept).
  var LS_STAGE = "arckanban-page-" + projectId;
  var panels = [].slice.call(track.querySelectorAll(".stage-slide")).map(function (el) {
    return {
      page: Number(el.dataset.page), stage: Number(el.dataset.stage), part: Number(el.dataset.part || 0),
      parts: Number(el.dataset.parts || 1), label: el.dataset.label || el.dataset.stage,
      enabled: el.dataset.enabled === "1", el: el,
    };
  });
  var pageCount = panels.length || 1;
  var currentPage = 0, lastActive = 0;
  function panelAt(p) { return panels[Math.max(0, Math.min(pageCount - 1, p))] || panels[0]; }
  function activePage() {
    if (!track.clientWidth) return currentPage;
    return Math.max(0, Math.min(pageCount - 1, Math.round(track.scrollLeft / track.clientWidth)));
  }
  function currentSlide() { return panelAt(activePage()).el; }
  function nextEnabledPage(from, dir) {
    for (var i = Number(from) + dir; i >= 0 && i < pageCount; i += dir) if (panels[i].enabled) return i;
    return null;
  }
  function firstPageOfStage(stage) {
    var i; stage = Number(stage);
    for (i = 0; i < pageCount; i++) if (panels[i].stage === stage && panels[i].enabled) return i;
    for (i = 0; i < pageCount; i++) if (panels[i].stage === stage) return i;   // disabled fallback
    return null;
  }
  function pageForStagePart(stage, part) {
    stage = Number(stage); part = Number(part || 0);
    for (var i = 0; i < pageCount; i++) if (panels[i].stage === stage && panels[i].part === part) return i;
    return firstPageOfStage(stage);
  }
  function updateNav(p) {
    if (p == null) p = activePage();
    var panel = panelAt(p);
    var num = document.querySelector(".tb-stage-num"); if (num) num.textContent = panel.label;
    var prev = document.querySelector(".tb-pager.prev"), next = document.querySelector(".tb-pager.next");
    if (prev) prev.disabled = nextEnabledPage(p, -1) === null;
    if (next) next.disabled = nextEnabledPage(p, +1) === null;
    var fn = document.querySelector(".tb-focus-name"); if (fn) fn.textContent = RIBA[panel.stage];
    var star = document.querySelector(".tb-star");
    if (star) { var cur = panel.stage === currentStage; star.textContent = cur ? "★" : "☆"; star.classList.toggle("is-current", cur); }
  }
  function gotoPage(p, instant) {
    p = Math.max(0, Math.min(pageCount - 1, Number(p)));
    currentPage = p; lastActive = p;
    try { localStorage.setItem(LS_STAGE, String(p)); } catch (e) {}
    track.scrollTo({ left: p * track.clientWidth, behavior: (instant || reduceMotion) ? "auto" : "smooth" });
    updateNav(p);
  }
  var ticking = false;
  track.addEventListener("scroll", function () {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(function () {
        var p = activePage(); updateNav(p);
        try { localStorage.setItem(LS_STAGE, String(p)); } catch (e) {}
        lastActive = p; currentPage = p; ticking = false;
      });
    }
  });
  window.addEventListener("resize", function () { gotoPage(lastActive, true); });

  // ---- counts ------------------------------------------------------------
  function colCards(scope, status) {
    return scope.querySelectorAll('.col-cards[data-status="' + status + '"] > .card').length;
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
    // A split stage spans several pages — roll the whole RIBA stage together.
    var slides = board.querySelectorAll('.stage-slide[data-stage="' + currentStage + '"]');
    if (!slides.length) return 0;
    var total = 0, done = 0;
    slides.forEach(function (st) {
      total += st.querySelectorAll(".col-cards > .card").length;
      done += colCards(st, "done");
    });
    return total ? done / total : 0;
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
    var nudge = document.getElementById("nudge"); if (nudge) nudge.hidden = true;
    var p = firstPageOfStage(n);
    if (p != null) { lastActive = p; gotoPage(p); }   // lands on the stage's first page, refreshes the ★ via updateNav
    else updateNav();
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
      var stageEl = currentSlide();
      if (stageEl) {
        stageEl.querySelectorAll('.bubble[data-section="' + id + '"] .bubble-name').forEach(function (n) { n.textContent = val; });
        stageEl.querySelectorAll('.sec-chip[data-section="' + id + '"] .sec-chip-name').forEach(function (n) { n.textContent = val; });
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
    head.title = "Click to collapse / expand";
    var chev = document.createElement("button"); chev.type = "button"; chev.className = "bubble-collapse";
    chev.dataset.action = "toggle-bubble"; chev.setAttribute("aria-label", "Collapse section");
    chev.innerHTML = '<span class="chevron">▾</span>';
    var nm = document.createElement("span"); nm.className = "bubble-name"; nm.textContent = sectionTitle(stageEl, sec);
    var ct = document.createElement("span"); ct.className = "bubble-count"; ct.textContent = "0";
    var grip = document.createElement("span"); grip.className = "bubble-grip"; grip.draggable = true;
    grip.setAttribute("aria-hidden", "true"); grip.title = "Drag to move this section to another status"; grip.textContent = "⠿";
    head.appendChild(chev); head.appendChild(nm); head.appendChild(ct); head.appendChild(grip);
    var cards = document.createElement("div");
    cards.className = "col-cards bubble-cards";
    cards.dataset.stage = colBody.dataset.stage; cards.dataset.part = colBody.dataset.part; cards.dataset.status = colBody.dataset.status; cards.dataset.section = sec;
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
    stageEl.querySelectorAll(".sec-chip:not(.sec-chip-general)").forEach(function (ch) {
      out.push({ id: ch.dataset.section, title: ch.querySelector(".sec-chip-name").textContent.trim() });
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
    ensureContainer(colBodyOf(card), sec).appendChild(card);
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
  function decAssigneeSet(card) {
    var t = card.querySelector(".awaiting-text");
    return !!(t && !t.classList.contains("is-empty") && t.textContent.trim());
  }
  async function confirmDecision(card, text, addOpt) {
    // A decision can't be confirmed until the decision-maker is set.
    if (!decAssigneeSet(card)) {
      alert("Set who the decision is for (“decision by?”) before confirming it.");
      var box = card.querySelector(".awaiting-on"); if (box) editAwaiting(box);
      return;
    }
    var r = await api("/api/tasks/" + card.dataset.taskId + "/confirm", { text: text, add_option: !!addOpt });
    if (!r) return;
    if (r.option) {
      var ul = ensureDecOptionsUl(card);
      if (!ul.querySelector('[data-option-id="' + r.option.id + '"]')) ul.appendChild(renderOption(r.option.id, r.option.text));
      updateDecOther(card);
    }
    setDecisionOutcome(card, r.outcome);
    if (r.status) {   // auto-moved to Done on the server — fly it across to reflect it
      var stageEl = stageOf(card), destCol = stageEl.querySelector('.col-body[data-status="' + r.status + '"]');
      transportCard(card, function () {
        applyCardStatus(card, r.status);
        if (destCol) ensureContainer(destCol, card.dataset.section || "").appendChild(card);
      });
      recountStageFull(stageEl); registerActivity(card.dataset.stage, card.dataset.taskId);
      maybePromptRationale(card);
    }
  }
  async function clearDecision(card) {
    var r = await api("/api/tasks/" + card.dataset.taskId + "/unconfirm", {});
    if (!r) return;
    if (r.status) {   // reopened -> back to To Do on the server; fly it back out of Done
      var stageEl = stageOf(card), destCol = stageEl.querySelector('.col-body[data-status="' + r.status + '"]');
      transportCard(card, function () {
        setDecisionOutcome(card, "");        // drop the outcome banner (the card grows back)
        applyCardStatus(card, r.status);
        if (destCol) ensureContainer(destCol, card.dataset.section || "").appendChild(card);
      });
      recountStageFull(stageEl); registerActivity(card.dataset.stage, card.dataset.taskId);
    } else {
      setDecisionOutcome(card, "");
    }
    // Tasks were spawned from this (now-unmade) decision — offer to revise/remove them.
    if (r.linked && r.linked.length) openUnmade(card, r.linked);
  }
  function setDecisionOutcome(card, outcome) {
    var block = decBlock(card); if (!block) return;
    var banner = block.querySelector(".dec-outcome");
    if (outcome) {
      if (!banner) {
        banner = document.createElement("div"); banner.className = "dec-outcome";
        banner.innerHTML = '<span class="dec-check">✓</span> <span class="dec-outcome-text"></span>' +
          '<button type="button" class="dec-clear" data-action="clear-decision" aria-label="Reopen decision" title="Reopen decision">×</button>' +
          '<button type="button" class="dec-history-toggle" data-action="toggle-dec-history" aria-label="Show options considered" title="Show the options considered">▾</button>';
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

  // ---- decision rationale: capture the "why" when a decision lands in Done -
  var rationaleId = null;
  function maybePromptRationale(card) {
    if (!card || card.dataset.type !== "decision") return;
    if ((card.dataset.rationale || "").trim()) return;   // already explained — don't nag
    openRationale(card);
  }
  function openRationale(card) {
    var modal = document.getElementById("rationale-modal"); if (!modal) return;
    rationaleId = card.dataset.taskId;
    var forEl = modal.querySelector(".rationale-for"); if (forEl) forEl.textContent = cardTitle(card);
    var ta = modal.querySelector(".rationale-text"); ta.value = card.dataset.rationale || "";
    modal.querySelectorAll(".rat-chip").forEach(function (c) { c.classList.remove("is-on"); });
    modal.hidden = false; ta.focus();
  }
  function closeRationale() { var m = document.getElementById("rationale-modal"); if (m) m.hidden = true; rationaleId = null; }
  function rationaleChip(btn) {
    var ta = document.getElementById("rationale-modal").querySelector(".rationale-text");
    var label = btn.dataset.rat || btn.textContent.trim(), cur = ta.value.trim();
    if (cur.indexOf(label) === -1) ta.value = cur ? cur + ". " + label : label;   // append; non-destructive
    btn.classList.add("is-on"); ta.focus();
  }
  async function saveRationale() {
    var id = rationaleId; if (!id) { closeRationale(); return; }
    var val = document.getElementById("rationale-modal").querySelector(".rationale-text").value.trim();
    var r = await api("/api/tasks/" + id, { rationale: val });
    if (r) { var card = board.querySelector('.card[data-task-id="' + id + '"]'); if (card) card.dataset.rationale = val; }
    closeRationale();
  }

  // ---- "decision unmade": revise/remove the tasks it spawned -------------
  function openUnmade(decisionCard, linked) {
    var modal = document.getElementById("unmade-modal"); if (!modal) return;
    var forEl = modal.querySelector(".unmade-for"); if (forEl) forEl.textContent = cardTitle(decisionCard);
    var list = modal.querySelector(".unmade-list"); list.innerHTML = "";
    linked.forEach(function (t) { list.appendChild(unmadeRow(t.id, t.title)); });
    modal.hidden = false;
  }
  function unmadeRow(id, title) {
    var li = document.createElement("li"); li.className = "unmade-item"; li.dataset.taskId = id;
    var nm = document.createElement("span"); nm.className = "unmade-name"; nm.textContent = title;
    nm.title = "Click to rename"; nm.setAttribute("role", "button"); nm.tabIndex = 0;
    nm.addEventListener("click", function () { renameUnmade(nm, id); });
    var del = document.createElement("button"); del.type = "button"; del.className = "unmade-del";
    del.setAttribute("aria-label", "Delete this task"); del.title = "Delete this task"; del.textContent = "×";
    del.addEventListener("click", function () { deleteUnmade(li, id); });
    li.appendChild(nm); li.appendChild(del); return li;
  }
  function renameUnmade(nm, id) {
    var cur = nm.textContent.trim();
    editInline(nm, cur, async function (val, changed) {
      if (val === null || !changed || !val) { nm.textContent = cur; return; }
      var r = await api("/api/tasks/" + id, { title: val });
      nm.textContent = (r && val) || cur;
      if (r) {                                            // mirror the rename onto the board card
        var c = board.querySelector('.card[data-task-id="' + id + '"]');
        var tt = c && c.querySelector(".task-title"); if (tt) tt.textContent = val;
      }
    });
  }
  async function deleteUnmade(li, id) {
    var r = await api("/api/tasks/" + id + "/delete", {});
    if (!r) return;
    var c = board.querySelector('.card[data-task-id="' + id + '"]');   // remove from the board too
    if (c) { var st = stageOf(c); c.remove(); if (st) recountStageFull(st); }
    li.remove();
    var list = document.getElementById("unmade-modal").querySelector(".unmade-list");
    if (list && !list.children.length) closeUnmade();                  // nothing left to manage
  }
  function closeUnmade() { var m = document.getElementById("unmade-modal"); if (m) m.hidden = true; }

  // ---- email a task schedule (.eml, meeting-minutes style) --------------
  function openEmail() {
    var m = document.getElementById("email-modal"); if (!m) return;
    var n = Number(currentSlide().dataset.stage);   // pre-tick the focused RIBA stage
    m.querySelectorAll(".email-stage-cb").forEach(function (cb) { cb.checked = Number(cb.value) === n; });
    m.hidden = false;
  }
  function closeEmail() { var m = document.getElementById("email-modal"); if (m) m.hidden = true; }
  function emailDownload() {
    var m = document.getElementById("email-modal"); if (!m) return;
    var stages = [].slice.call(m.querySelectorAll(".email-stage-cb:checked")).map(function (cb) { return cb.value; });
    if (!stages.length) { alert("Pick at least one stage to include."); return; }
    window.location.href = "/projects/" + encodeURIComponent(projectUid) + "/email.eml?stages=" + stages.join(",");
    closeEmail();
  }

  // ---- roles (managed assignees) ----------------------------------------
  function addRoleRow(id, name) {
    var list = document.querySelector(".roles-list"); if (!list) return null;
    var row = document.createElement("div"); row.className = "role-row"; row.dataset.role = id;
    var nm = document.createElement("span"); nm.className = "role-name"; nm.dataset.action = "rename-role";
    nm.setAttribute("role", "button"); nm.tabIndex = 0; nm.title = "Rename"; nm.textContent = name;
    var del = document.createElement("button"); del.type = "button"; del.className = "role-del";
    del.dataset.action = "delete-role"; del.dataset.role = id; del.setAttribute("aria-label", "Delete role"); del.title = "Delete role"; del.textContent = "×";
    row.appendChild(nm); row.appendChild(del); list.appendChild(row); return row;
  }
  function ensureAssigneeOption(val) {
    var dl = document.getElementById("assignee-suggestions"); if (!dl || !val) return;
    var has = Array.prototype.some.call(dl.options, function (o) { return o.value.toLowerCase() === val.toLowerCase(); });
    if (!has) { var o = document.createElement("option"); o.value = val; dl.appendChild(o); }
  }
  function removeAssigneeOption(val) {
    var dl = document.getElementById("assignee-suggestions"); if (!dl) return;
    Array.prototype.slice.call(dl.options).forEach(function (o) { if (o.value.toLowerCase() === (val || "").toLowerCase()) o.remove(); });
  }
  function relabelAssignee(oldName, newName) {
    board.querySelectorAll(".awaiting-text").forEach(function (t) {
      if (!t.classList.contains("is-empty") && t.textContent.trim() === oldName) renderAwaiting(t, newName);
    });
  }
  async function addRolePop(form) {
    var input = form.querySelector('input[name="name"]'); var name = input.value.trim();
    if (!name) { input.focus(); return; }
    var r = await api("/api/projects/" + projectId + "/roles", { name: name });
    if (!r) return;
    addRoleRow(r.role.id, r.role.name); ensureAssigneeOption(r.role.name);
    input.value = ""; input.focus();
  }
  function renameRole(nameEl) {
    var row = nameEl.closest(".role-row"); var id = row.dataset.role, old = nameEl.textContent.trim();
    editInline(nameEl, old, async function (val, changed) {
      if (val === null || !changed || !val) { nameEl.textContent = old; return; }
      var res, json = {};
      try { res = await fetch("/api/roles/" + id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: val }) }); }
      catch (e) { alert("Could not reach the app. Is it still running?"); nameEl.textContent = old; return; }
      try { json = await res.json(); } catch (e) {}
      if (!res.ok || !json.ok) { alert((json && json.error) || "Could not rename the role."); nameEl.textContent = old; return; }
      nameEl.textContent = val; removeAssigneeOption(old); ensureAssigneeOption(val); relabelAssignee(old, val);
    });
  }
  async function deleteRole(btn) {
    var row = btn.closest(".role-row"); if (!row) return;
    var id = btn.dataset.role || row.dataset.role, name = row.querySelector(".role-name").textContent.trim();
    var res, json = {};
    try { res = await fetch("/api/roles/" + id + "/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }); }
    catch (e) { alert("Could not reach the app. Is it still running?"); return; }
    try { json = await res.json(); } catch (e) {}
    if (res.status === 409 && json.in_use) { openReassign(id, name, json.in_use); return; }   // must reassign first
    if (!res.ok || !json.ok) { alert((json && json.error) || "Could not delete the role."); return; }
    row.remove(); removeAssigneeOption(name);
  }
  var reassignCtx = null;
  function openReassign(id, name, count) {
    var m = document.getElementById("role-reassign-modal"); if (!m) return;
    reassignCtx = { id: id, name: name };
    m.querySelector(".rr-role").textContent = name;
    m.querySelector(".rr-count").textContent = count + (count === 1 ? " task" : " tasks");
    var sel = m.querySelector(".rr-select"); sel.innerHTML = "";
    document.querySelectorAll(".roles-list .role-row").forEach(function (r) {
      if (r.dataset.role === String(id)) return;
      var o = document.createElement("option"); o.value = r.querySelector(".role-name").textContent.trim(); o.textContent = o.value; sel.appendChild(o);
    });
    var nw = document.createElement("option"); nw.value = "__new__"; nw.textContent = "＋ New role…"; sel.appendChild(nw);
    var ni = m.querySelector(".rr-new"); ni.value = ""; ni.hidden = sel.value !== "__new__";
    m.hidden = false; sel.focus();
  }
  function reassignSelectChanged(sel) {
    var ni = document.getElementById("role-reassign-modal").querySelector(".rr-new");
    ni.hidden = sel.value !== "__new__"; if (!ni.hidden) ni.focus();
  }
  async function reassignConfirm() {
    if (!reassignCtx) return;
    var m = document.getElementById("role-reassign-modal"), sel = m.querySelector(".rr-select");
    var target = sel.value === "__new__" ? m.querySelector(".rr-new").value.trim() : sel.value;
    if (!target) { alert("Choose or type a role to move the tasks to."); return; }
    var r = await api("/api/roles/" + reassignCtx.id + "/delete", { reassign_to: target });
    if (!r) return;
    location.reload();          // simplest resync of roles + the board after a reassign
  }
  function closeReassign() { var m = document.getElementById("role-reassign-modal"); if (m) m.hidden = true; reassignCtx = null; }

  function ctxSep(menu) { var s = document.createElement("div"); s.className = "ctx-sep"; menu.appendChild(s); }
  function ctxHead(menu, text) { var h = document.createElement("div"); h.className = "ctx-head"; h.textContent = text; menu.appendChild(h); }
  function appendUndo(menu) {
    var last = undoStack[undoStack.length - 1];
    menu.appendChild(ctxItem("Undo", last ? function () { closeMenu(); runUndo(); } : null, !last));
  }
  // Right-click a card: the task's own actions. Section options appear only when
  // the stage actually has sections to move between.
  function openSectionMenu(card, x, y) {
    closeMenu();
    var stageEl = stageOf(card), cur = card.dataset.section || "";
    var menu = document.createElement("div"); menu.className = "ctx-menu"; var has = false;
    if (card.dataset.type === "decision") {
      ctxHead(menu, "Confirm decision");
      var outcome = decOutcome(card);
      card.querySelectorAll(".dec-option .dec-option-text").forEach(function (span) {
        var text = span.textContent.trim();
        var it = ctxItem(text, text === outcome ? null : function () { confirmDecision(card, text, false); closeMenu(); });
        if (text === outcome) it.classList.add("is-current");
        menu.appendChild(it);
      });
      menu.appendChild(ctxItem("Other…", function () { closeMenu(); startAddOption(card, true); }));
      if (outcome) menu.appendChild(ctxItem("Clear decision", function () { clearDecision(card); closeMenu(); }));
      has = true;
    }
    var sections = stageSections(stageEl);
    if (sections.length) {
      if (has) ctxSep(menu);
      var moves = [{ id: "", title: "General (no section)" }].concat(sections).map(function (it) {
        return { label: it.title, current: it.id === cur,
                 onClick: function () { assignCardToSection(card, it.id); closeMenu(); } };
      });
      ctxSubmenu(menu, "Move to section", moves);
      has = true;
    }
    if (has) ctxSep(menu);
    appendUndo(menu);
    placeMenu(menu, x, y);
  }
  // Right-click empty board space: just Undo.
  function openActionsMenu(x, y) {
    closeMenu();
    var menu = document.createElement("div"); menu.className = "ctx-menu";
    appendUndo(menu);
    placeMenu(menu, x, y);
  }

  // ---- task mutations ----------------------------------------------------
  function applyCardStatus(card, status) {
    card.dataset.status = status;
    card.classList.remove("status-backlog", "status-upcoming", "status-todo", "status-inprogress", "status-awaiting", "status-done");
    card.classList.add("status-" + status);
    var lbl = card.querySelector(".status-label"); if (lbl) lbl.textContent = STATUS_LABELS[status];
    var i = STATUSES.indexOf(status);
    var p = card.querySelector(".step-prev"), n = card.querySelector(".step-next");
    if (p) p.disabled = i === 0; if (n) n.disabled = i === STATUSES.length - 1;
    // A decision moved out of Done is auto-unconfirmed server-side — drop its banner.
    if (card.dataset.type === "decision" && status !== "done" && card.querySelector(".dec-outcome")) setDecisionOutcome(card, "");
  }
  async function stepStatus(card, dir) {
    var i = STATUSES.indexOf(card.dataset.status), ni = i + dir;
    if (ni < 0 || ni >= STATUSES.length) return;
    var newStatus = STATUSES[ni];
    var prev = card.dataset.status, sec = card.dataset.section || "", id = card.dataset.taskId, title = cardTitle(card);
    var r = await api("/api/tasks/" + id, { status: newStatus });
    if (!r) return;
    var stageEl = stageOf(card);
    var destCol = stageEl.querySelector('.col-body[data-status="' + newStatus + '"]');
    transportCard(card, function () {
      applyCardStatus(card, newStatus);
      if (destCol) ensureContainer(destCol, card.dataset.section || "").appendChild(card);
    });
    if (newStatus === "done" && prev !== "done") maybePromptRationale(card);
    pushUndo("move of “" + title + "”", function () { return undoMove(id, prev, sec); });
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
  // ---- sections ----------------------------------------------------------
  async function deleteSection(el) {
    var id = el.dataset.section; if (!id) return;
    if (!confirm("Delete this section? Its tasks move to General.")) return;
    var r = await api("/api/sections/" + id + "/delete", {});
    if (!r) return;
    var stageEl = currentSlide();
    if (stageEl) {
      stageEl.querySelectorAll(".col-body").forEach(function (colBody) {
        var bubble = colBody.querySelector('.bubble[data-section="' + id + '"]');
        if (!bubble) return;
        var loose = colBody.querySelector(".loose-cards"), src = bubble.querySelector(".bubble-cards");
        while (src.firstElementChild) { var c = src.firstElementChild; c.dataset.section = ""; loose.appendChild(c); }
        bubble.remove();
      });
      var chip = stageEl.querySelector('.sec-chip[data-section="' + id + '"]'); if (chip) chip.remove();
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
    var stageEl = currentSlide(), panel = panelAt(activePage());
    var lbl = pop.querySelector(".sections-stage"); if (lbl) lbl.textContent = "Stage " + panel.label + " · " + RIBA[panel.stage];
    renderSectionsList(stageEl);
    closePops("sections-pop"); pop.hidden = false;
    var ti = pop.querySelector(".sections-add input"); if (ti) ti.value = "";
  }
  async function addSectionPop(form) {
    var stageEl = currentSlide(), stage = Number(stageEl.dataset.stage), substage = Number(stageEl.dataset.part || 0);
    var input = form.querySelector('input[name="title"]');
    var title = input.value.trim(); if (!title) { input.focus(); return; }
    var r = await api("/api/projects/" + projectId + "/sections", { stage: stage, substage: substage, title: title });
    if (!r) return;
    if (stageEl) {
      var reg = stageEl.querySelector(".section-reg");
      var pos = stageEl.querySelectorAll(".sec-chip:not(.sec-chip-general)").length;
      var chip = document.createElement("span");
      chip.className = "sec-chip"; chip.dataset.section = r.section.id; chip.dataset.pos = pos;
      var nm = document.createElement("span"); nm.className = "sec-chip-name"; nm.textContent = r.section.title;
      var roll = document.createElement("span"); roll.className = "sec-chip-roll"; roll.textContent = "0/0";
      chip.appendChild(nm); chip.appendChild(roll);
      if (reg) reg.appendChild(chip);
      renderSectionsList(stageEl);
    }
    input.value = ""; input.focus();
  }

  // ---- filters & collapse (persisted) -----------------------------------
  var LS_FILTERS = "arckanban-filters";
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
  var POP_IDS = ["filter-pop", "more-pop", "create-pop", "sections-pop", "search-pop", "roles-pop"];
  function closePops(except) {
    POP_IDS.forEach(function (id) { if (id === except) return; var el = document.getElementById(id); if (el) el.hidden = true; });
  }
  function togglePop(id) {
    var el = document.getElementById(id); if (!el) return;
    var willOpen = el.hidden; closePops(id); el.hidden = !willOpen;
  }
  function anyPopOpen() { return POP_IDS.some(function (id) { var el = document.getElementById(id); return el && !el.hidden; }); }

  // ---- task search (tasks only, across every stage) ---------------------
  function openSearch() {
    var pop = document.getElementById("search-pop"); if (!pop) return;
    closePops("search-pop"); pop.hidden = false;
    var inp = pop.querySelector(".search-input"); inp.value = ""; inp.focus();
    renderSearch("");
  }
  function renderSearch(q) {
    var pop = document.getElementById("search-pop"); if (!pop) return;
    var box = pop.querySelector(".search-results"); box.innerHTML = "";
    q = (q || "").trim().toLowerCase();
    if (!q) { box.innerHTML = '<div class="search-hint">Type to find a task across all stages…</div>'; return; }
    var matches = [].slice.call(board.querySelectorAll(".card")).filter(function (card) {
      var t = card.querySelector(".task-title");
      return t && t.textContent.trim().toLowerCase().indexOf(q) >= 0;
    });
    if (!matches.length) { box.innerHTML = '<div class="search-hint">No tasks match.</div>'; return; }
    matches.slice(0, 40).forEach(function (card) {
      var stage = Number(card.dataset.stage);
      var sec = card.dataset.section ? sectionTitle(stageOf(card), card.dataset.section) : "General";
      var row = document.createElement("button");
      row.type = "button"; row.className = "search-result type-" + (card.dataset.type || "recommended");
      row.dataset.action = "search-jump"; row.dataset.taskId = card.dataset.taskId;
      var title = document.createElement("span"); title.className = "search-result-title";
      title.textContent = card.querySelector(".task-title").textContent.trim();
      var meta = document.createElement("span"); meta.className = "search-result-meta";
      meta.textContent = "Stage " + stage + " · " + RIBA[stage] + " · " + sec + " · " + (STATUS_LABELS[card.dataset.status] || card.dataset.status);
      row.appendChild(title); row.appendChild(meta); box.appendChild(row);
    });
    if (matches.length > 40) box.insertAdjacentHTML("beforeend", '<div class="search-hint">…and ' + (matches.length - 40) + ' more — keep typing</div>');
  }
  function jumpToTask(id) {
    var card = board.querySelector('.card[data-task-id="' + id + '"]'); if (!card) return;
    closePops();
    var collapsed = card.closest(".bubble.is-collapsed"); if (collapsed) collapsed.classList.remove("is-collapsed");
    var p = pageForStagePart(card.dataset.stage, card.dataset.part); lastActive = p; gotoPage(p);
    setTimeout(function () {
      card.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center", inline: "nearest" });
      card.classList.remove("is-found"); void card.offsetWidth; card.classList.add("is-found");
      setTimeout(function () { card.classList.remove("is-found"); }, 1700);
    }, reduceMotion ? 0 : 340);
  }

  // ---- create-task widget -----------------------------------------------
  function openCreate() {
    var pop = document.getElementById("create-pop"); if (!pop) return;
    var stageEl = currentSlide(), panel = panelAt(activePage());
    pop.dataset.stage = panel.stage; pop.dataset.part = panel.part; pop.dataset.page = panel.page;
    var lbl = pop.querySelector(".create-stage"); if (lbl) lbl.textContent = "Stage " + panel.label + " · " + RIBA[panel.stage];
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
    var stage = Number(pop.dataset.stage), substage = Number(pop.dataset.part || 0);
    var type = pop.querySelector(".create-type").value;
    var status = pop.querySelector(".create-status").value;
    var section = pop.querySelector(".create-section").value;
    var r = await api("/api/projects/" + projectId + "/tasks",
      { stage: stage, substage: substage, title: title, type: type, status: status, section_id: section });
    if (!r) return;
    var stageEl = document.getElementById("stage-" + pop.dataset.page);
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
    // Long pause before retracting, so brushing the bar a few times keeps it
    // open — it barely gets a chance to close.
    dockTimer = setTimeout(function () { if (!dockHover && !anyPopOpen()) document.body.classList.remove("dock-open"); }, 2200);
  }
  function dockEnter() { dockHover = true; dockReveal(); }
  function dockLeave() { dockHover = false; dockHideSoon(); }

  // Appointment scope is managed on the register page now; the board keeps only
  // the in-context "Add to scope" affordance on a disabled-stage placeholder.
  function saveScope(stages) { api("/api/projects/" + projectId + "/stages", { stages: stages }).then(function (r) { if (r) location.reload(); }); }

  // collapse section bubbles (grouped) — folds a whole section across columns, persisted
  var LS_BUBBLES = "arckanban-bubbles-" + projectId;
  function loadBubbles() { try { return new Set(JSON.parse(localStorage.getItem(LS_BUBBLES)) || []); } catch (e) { return new Set(); } }
  function applyBubbles() { var s = loadBubbles(); document.querySelectorAll(".bubble").forEach(function (b) { if (s.has(b.dataset.section)) b.classList.add("is-collapsed"); }); }
  function toggleBubble(el) {
    var bubble = el.closest(".bubble"); if (!bubble) return;
    var sec = bubble.dataset.section; if (!sec) return;
    var collapse = !bubble.classList.contains("is-collapsed");
    stageOf(el).querySelectorAll('.bubble[data-section="' + sec + '"]').forEach(function (b) { animateBubble(b, collapse); });
    var s = loadBubbles(); if (collapse) s.add(sec); else s.delete(sec);
    localStorage.setItem(LS_BUBBLES, JSON.stringify(Array.from(s)));
  }
  // Animate a section open/closed: the card area expands/contracts while its
  // cards stagger in from the left (and slide back out to the left on close).
  function animateBubble(bubble, collapse) {
    var cards = bubble.querySelector(".bubble-cards");
    if (!cards || reduceMotion || !cards.animate) { bubble.classList.toggle("is-collapsed", collapse); return; }
    var kids = [].slice.call(cards.children);
    cards.getAnimations().forEach(function (a) { a.cancel(); });
    kids.forEach(function (c) { c.getAnimations().forEach(function (a) { a.cancel(); }); });
    var stagger = Math.min(34, 150 / Math.max(1, kids.length));
    cards.style.overflow = "hidden";
    if (collapse) {
      var h = cards.getBoundingClientRect().height;
      bubble.classList.add("is-collapsing");                       // rotates the chevron now
      kids.forEach(function (c, i) {                               // last card leaves first
        c.animate([{ opacity: 1, transform: "translateX(0)" }, { opacity: 0, transform: "translateX(-16px)" }],
          { duration: 150, delay: (kids.length - 1 - i) * stagger, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" });
      });
      var a = cards.animate([{ height: h + "px", opacity: 1 }, { height: "0px", opacity: 0 }],
        { duration: Math.min(360, 150 + kids.length * 22), delay: 40, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" });
      a.onfinish = function () {
        bubble.classList.remove("is-collapsing"); bubble.classList.add("is-collapsed");
        cards.style.overflow = ""; cards.style.height = "";
        a.cancel(); kids.forEach(function (c) { c.getAnimations().forEach(function (x) { x.cancel(); }); });
      };
    } else {
      bubble.classList.remove("is-collapsed");
      var target = cards.getBoundingClientRect().height;          // natural height once shown
      var ha = cards.animate([{ height: "0px", opacity: 0 }, { height: target + "px", opacity: 1 }],
        { duration: Math.min(380, 160 + kids.length * 24), easing: "cubic-bezier(.2,.7,.3,1)" });
      ha.onfinish = function () { cards.style.overflow = ""; cards.style.height = ""; };
      kids.forEach(function (c, i) {
        c.animate([{ opacity: 0, transform: "translateX(-16px)" }, { opacity: 1, transform: "translateX(0)" }],
          { duration: 200, delay: 30 + i * stagger, easing: "cubic-bezier(.2,.7,.3,1)" });
      });
    }
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
  // Fly a card from where it is to wherever `mutate` moves it, settling (and
  // gently compressing) into its new size — used when a decision passes its gate
  // into Done, the inverse when it's reopened, and for the ‹ › status steps.
  function transportCard(card, mutate) {
    var scope = stageOf(card);
    if (reduceMotion || !card.animate || !scope) { mutate(); return; }
    var others = [].slice.call(scope.querySelectorAll(".card")).filter(function (c) { return c !== card; });
    var firstO = others.map(function (c) { return c.getBoundingClientRect(); });
    var first = card.getBoundingClientRect();
    mutate();
    var last = card.getBoundingClientRect();
    others.forEach(function (c, i) {            // siblings slide to make room / close the gap
      if (c._flip) { c._flip.cancel(); c._flip = null; }
      var l = c.getBoundingClientRect(), dx = firstO[i].left - l.left, dy = firstO[i].top - l.top;
      if (!dx && !dy) return;
      c._flip = c.animate([{ transform: "translate(" + dx + "px," + dy + "px)" }, { transform: "translate(0,0)" }],
        { duration: 300, easing: "cubic-bezier(.2,.7,.3,1)" });
      c._flip.onfinish = function () { c._flip = null; };
    });
    var dx2 = first.left - last.left, dy2 = first.top - last.top;
    var sy = last.height ? Math.max(1, Math.min(first.height / last.height, 1.2)) : 1;   // cap so text never grossly stretches
    if (!dx2 && !dy2 && sy < 1.02) return;
    card.style.transformOrigin = "top left"; card.style.zIndex = "6";
    var a = card.animate(
      [{ transform: "translate(" + dx2 + "px," + dy2 + "px) scaleY(" + sy + ")", opacity: 0.75 },
       { transform: "translate(0,0) scaleY(1)", opacity: 1 }],
      { duration: 440, easing: "cubic-bezier(.34,1.06,.4,1)" });
    a.onfinish = function () { card.style.transformOrigin = ""; card.style.zIndex = ""; };
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
    var grip = e.target.closest(".bubble-grip");
    if (grip) {
      draggingBubble = grip.closest(".bubble"); draggingBubble.classList.add("dragging-bubble");
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
    var destCol = lastOverCol || colBodyOf(card); lastOverCol = null;
    if (!destCol) return;
    var status = destCol.dataset.status, section = card.dataset.section || "";
    var container = ensureContainer(destCol, section);
    if (card.parentElement !== container) container.appendChild(card);
    var index = [].slice.call(container.querySelectorAll(".card")).indexOf(card);
    var r = await api("/api/tasks/" + card.dataset.taskId + "/move",
      { status: status, section_id: section || null, index: index });
    if (!r) { location.reload(); return; }
    applyCardStatus(card, status);
    card.dataset.section = section || "";
    if (status === "done" && dragFrom && dragFrom.status !== "done") maybePromptRationale(card);
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
        case "toggle-dec-history": { var hb = el.closest(".dec-block"); if (hb) hb.classList.toggle("is-history-open"); break; }
        case "rationale-chip": rationaleChip(el); break;
        case "rationale-save": saveRationale(); break;
        case "rationale-skip": closeRationale(); break;
        case "unmade-done": closeUnmade(); break;
        case "open-email": openEmail(); break;
        case "email-close": closeEmail(); break;
        case "email-download": emailDownload(); break;
        case "edit-title": editTitle(el); break;
        case "edit-awaiting": editAwaiting(el); break;
        case "edit-project-number": editProjectField(el, "number"); break;
        case "edit-project-name": editProjectField(el, "name"); break;
        case "rename-section": renameSection(el); break;
        case "delete-section": deleteSection(el); break;
        case "toggle-bubble": toggleBubble(el); break;
        case "set-current": setCurrentStage(el.dataset.stage); break;
        case "star-current": setCurrentStage(Number(currentSlide().dataset.stage)); break;
        case "goto-stage": { var gp = firstPageOfStage(Number(el.dataset.stage)); if (gp != null) { lastActive = gp; gotoPage(gp); } break; }
        case "nav-prev": { var pe = nextEnabledPage(activePage(), -1); if (pe != null) { lastActive = pe; gotoPage(pe); } break; }
        case "nav-next": { var ne = nextEnabledPage(activePage(), +1); if (ne != null) { lastActive = ne; gotoPage(ne); } break; }
        case "create-open": openCreate(); break;
        case "create-save": createSave(false); break;
        case "create-close": createSave(true); break;
        case "toggle-filters": togglePop("filter-pop"); break;
        case "toggle-more": togglePop("more-pop"); break;
        case "toggle-roles": togglePop("roles-pop"); break;
        case "rename-role": renameRole(el); break;
        case "delete-role": deleteRole(el); break;
        case "rr-cancel": closeReassign(); break;
        case "rr-confirm": reassignConfirm(); break;
        case "toggle-search": { var spp = document.getElementById("search-pop"); if (spp.hidden) openSearch(); else spp.hidden = true; break; }
        case "search-jump": jumpToTask(el.dataset.taskId); break;
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
    var bhead = e.target.closest(".bubble-head");                 // click the header (not the grip/buttons) to collapse/expand
    if (bhead && !e.target.closest(".bubble-grip, button, a, input, select, textarea")) { toggleBubble(bhead); return; }
    var card = e.target.closest(".card");
    if (card && !e.target.closest("button, select, input, textarea, a, .task-title, .awaiting-on, [contenteditable]")) selectCard(card);
    else if (!card) clearSelection();
  });
  document.addEventListener("change", function (e) { if (e.target.matches(".type-select")) changeType(e.target); else if (e.target.matches(".rr-select")) reassignSelectChanged(e.target); });
  document.addEventListener("input", function (e) { if (e.target.classList.contains("search-input")) renderSearch(e.target.value); });
  // ---- right-click a column / section: create here ----------------------
  function ctxItem(label, onClick, disabled) {
    var el = document.createElement("div");
    el.className = "ctx-item" + (disabled ? " is-disabled" : "");
    var s = document.createElement("span"); s.textContent = label; el.appendChild(s);
    if (!disabled && onClick) el.addEventListener("click", onClick);
    return el;
  }
  // A ctx-item that opens a flyout submenu to its right (the long section list
  // lives here so the card menu stays short). Hover opens it; click toggles for
  // touch. The submenu is a child of the parent menu, so closeMenu() clears it.
  function ctxSubmenu(parentMenu, label, items) {
    var item = document.createElement("div"); item.className = "ctx-item ctx-parent";
    var s = document.createElement("span"); s.textContent = label; item.appendChild(s);
    var caret = document.createElement("span"); caret.className = "ctx-caret"; caret.textContent = "›"; item.appendChild(caret);
    var sub = document.createElement("div"); sub.className = "ctx-menu ctx-submenu"; sub.hidden = true;
    items.forEach(function (it) {
      var el = ctxItem(it.label, it.current ? null : it.onClick, false);
      if (it.current) el.classList.add("is-current");
      sub.appendChild(el);
    });
    item.appendChild(sub);
    var timer = null;
    function open() {
      if (timer) { clearTimeout(timer); timer = null; }
      sub.hidden = false;
      var r = item.getBoundingClientRect();
      sub.style.top = Math.max(8, Math.min(r.top - 5, window.innerHeight - sub.offsetHeight - 8)) + "px";
      var rx = r.right + 2, lx = r.left - sub.offsetWidth - 2;       // open right; flip left if no room
      sub.style.left = (rx + sub.offsetWidth <= window.innerWidth - 8 ? rx : Math.max(8, lx)) + "px";
    }
    function closeSoon() { timer = setTimeout(function () { sub.hidden = true; }, 160); }
    item.addEventListener("mouseenter", open);
    item.addEventListener("mouseleave", closeSoon);
    sub.addEventListener("mouseenter", function () { if (timer) { clearTimeout(timer); timer = null; } });
    sub.addEventListener("mouseleave", closeSoon);
    item.addEventListener("click", function (e) { if (!sub.contains(e.target)) { if (sub.hidden) open(); else sub.hidden = true; } });
    parentMenu.appendChild(item);
    return item;
  }
  function placeMenu(menu, x, y) {
    document.body.appendChild(menu);
    menu.style.left = Math.min(x, window.innerWidth - menu.offsetWidth - 8) + "px";
    menu.style.top = Math.min(y, window.innerHeight - menu.offsetHeight - 8) + "px";
    ctxMenu = menu;
  }
  function openColumnMenu(colBody, sec, x, y) {
    closeMenu();
    var stageEl = stageOf(colBody), status = colBody.dataset.status;
    var menu = document.createElement("div"); menu.className = "ctx-menu";
    if (sec) {                                   // inside a section → section context
      ctxHead(menu, sectionTitle(stageEl, sec));
      menu.appendChild(ctxItem("New task here", function () { closeMenu(); quickCreateTask(colBody, sec); }));
      menu.appendChild(ctxItem("Rename section", function () {
        closeMenu();
        var b = stageEl.querySelector('.bubble[data-section="' + sec + '"]');
        var nm = b && b.querySelector(".bubble-name"); if (nm) renameSection(nm);
      }));
      menu.appendChild(ctxItem("Delete section", function () {
        closeMenu();
        var b = stageEl.querySelector('.bubble[data-section="' + sec + '"]'); if (b) deleteSection(b);
      }));
    } else {                                     // empty column area → create context
      ctxHead(menu, STATUS_LABELS[status] || status);
      menu.appendChild(ctxItem("New task here", function () { closeMenu(); quickCreateTask(colBody, ""); }));
      menu.appendChild(ctxItem("New section…", function () { closeMenu(); openSections(); }));   // already on this page
    }
    ctxSep(menu);
    appendUndo(menu);
    placeMenu(menu, x, y);
  }
  async function quickCreateTask(colBody, sec) {
    var stage = Number(colBody.dataset.stage), substage = Number(colBody.dataset.part || 0), status = colBody.dataset.status;
    var r = await api("/api/projects/" + projectId + "/tasks",
      { stage: stage, substage: substage, title: "New task", type: "recommended", status: status, section_id: sec || "" });
    if (!r) return;
    var stageEl = stageOf(colBody);
    var cont = ensureContainer(colBody, sec || "");
    cont.insertAdjacentHTML("beforeend", r.html);
    var card = cont.lastElementChild;
    recountStageFull(stageEl);
    var newId = r.task.id;
    pushUndo("add of “New task”", async function () { var rr = await api("/api/tasks/" + newId + "/delete", {}); if (rr) location.reload(); });
    registerActivity(stage, newId);
    if (card) { card.scrollIntoView({ block: "nearest" }); var t = card.querySelector(".task-title"); if (t) editTitle(t); }
  }
  document.addEventListener("contextmenu", function (e) {
    var card = e.target.closest(".card");
    if (card) { e.preventDefault(); openSectionMenu(card, e.clientX, e.clientY); return; }
    if (e.target.closest("input, textarea, select")) return;   // keep the native menu on fields
    var colBody = e.target.closest(".col-body");
    if (colBody) {
      e.preventDefault();
      var bubble = e.target.closest(".bubble");
      openColumnMenu(colBody, bubble ? (bubble.dataset.section || "") : "", e.clientX, e.clientY);
      return;
    }
    e.preventDefault(); openActionsMenu(e.clientX, e.clientY);
  });
  document.addEventListener("click", function (e) {
    if (ctxMenu && !e.target.closest(".ctx-menu")) closeMenu();
    var inPop = e.target.closest(".tb-pop");
    var onTrigger = e.target.closest('[data-action="toggle-filters"], [data-action="toggle-more"], [data-action="create-open"], [data-action="toggle-sections"], [data-action="toggle-search"]');
    if (!inPop && !onTrigger) closePops();
    if (dockEnabled() && !e.target.closest(".titleblock, .dock-handle, .tb-pop")) dockHideSoon();
  });
  track.addEventListener("scroll", closeMenu);
  var ratModal = document.getElementById("rationale-modal");
  if (ratModal) ratModal.addEventListener("click", function (e) { if (e.target === ratModal) closeRationale(); });
  var unmadeModal = document.getElementById("unmade-modal");
  if (unmadeModal) unmadeModal.addEventListener("click", function (e) { if (e.target === unmadeModal) closeUnmade(); });
  var emailModal = document.getElementById("email-modal");
  if (emailModal) emailModal.addEventListener("click", function (e) { if (e.target === emailModal) closeEmail(); });
  var rrModal = document.getElementById("role-reassign-modal");
  if (rrModal) rrModal.addEventListener("click", function (e) { if (e.target === rrModal) closeReassign(); });
  document.addEventListener("submit", function (e) {
    var secp = e.target.closest('[data-action="add-section-pop"]'); if (secp) { e.preventDefault(); addSectionPop(secp); }
    var rolep = e.target.closest('[data-action="add-role-pop"]'); if (rolep) { e.preventDefault(); addRolePop(rolep); }
  });
  document.addEventListener("keydown", function (e) {
    var t = e.target;
    if (t.classList && t.classList.contains("search-input")) {   // typing in the search box
      if (e.key === "Enter") { var f = document.querySelector("#search-pop .search-result"); if (f) { e.preventDefault(); jumpToTask(f.dataset.taskId); } }
      return;   // let "/" etc. type normally here
    }
    if (e.key === "/" && !t.matches("input, select, textarea, [contenteditable]")) { e.preventDefault(); openSearch(); return; }
    if (e.key === "Enter" || e.key === " ") {
      if (t.matches(".task-title, .tb-cell, .awaiting-on, .sec-row-name, .role-name")) { e.preventDefault(); t.click(); }
      return;
    }
    if (e.key === "Escape") { closeRationale(); closeUnmade(); closeEmail(); closeReassign(); closeMenu(); clearSelection(); closePops(); dockHideSoon(); return; }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (t.matches("input, select, textarea, [contenteditable]")) return;
      var te = nextEnabledPage(activePage(), e.key === "ArrowRight" ? 1 : -1);
      if (te != null) { lastActive = te; gotoPage(te); }
    }
  });

  // ---- init --------------------------------------------------------------
  applyFilters(loadFilters());
  applyBubbles();
  updateUrgentTally();
  // Auto-hide dock: default ON (conceal the bar for maximum board real estate)
  // unless the user has pinned it open before. Hover the handle / bar to reveal.
  // The top bar stays pinned in place (no auto-hide / expand-contract).
  setDockMode(false);
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
  var qStage = null; try { qStage = new URLSearchParams(location.search).get("stage"); } catch (e) {}
  var saved = null; try { saved = localStorage.getItem(LS_STAGE); } catch (e) {}
  var startP;
  if (qStage != null && qStage !== "" && isEnabled(Number(qStage)) && firstPageOfStage(Number(qStage)) != null) {
    startP = firstPageOfStage(Number(qStage));   // explicit return-to-stage (e.g. from the decision register)
    try { history.replaceState({}, "", location.pathname); } catch (e) {}   // keep the URL clean
  } else if (saved != null && saved !== "" && Number(saved) >= 0 && Number(saved) < pageCount && panels[Number(saved)].enabled) {
    startP = Number(saved);      // remembered page (invalidated automatically if the split shape changed)
  } else {
    startP = firstPageOfStage(currentStage);
    if (startP == null) startP = 0;
    // Fresh project (no remembered page): if that page is empty — e.g. a template
    // whose tasks sit in later stages — open on the first enabled page that
    // actually has cards, so the board never opens onto an empty page.
    if (!pageHasCards(startP)) {
      for (var si = 0; si < pageCount; si++) { if (panels[si].enabled && pageHasCards(si)) { startP = si; break; } }
    }
  }
  lastActive = startP; currentPage = startP;
  gotoPage(startP, true);
})();
