/* ArcKanban — board interactions.
   Horizontal stage paging (arrows / spine / keyboard / swipe); status moves
   via the ‹ › steppers. Everything persists via small JSON endpoints with no
   page reload. Drag + nesting arrive next. */
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
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var activity = {};   // stage -> Set of task ids touched (for the nudge)
  var dismissed = {};  // stage -> true

  // ---- fetch helper ------------------------------------------------------
  async function api(url, data) {
    var res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data || {}),
      });
    } catch (e) { alert("Could not reach the app. Is it still running?"); return null; }
    var json = {};
    try { json = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok || !json.ok) { alert((json && json.error) || "Something went wrong."); return null; }
    return json;
  }

  function cardOf(el) { return el.closest(".card"); }
  function stageElOf(el) { return el.closest(".stage"); }

  // ---- horizontal navigation --------------------------------------------
  function activeStage() {
    if (!track.clientWidth) return currentStage;
    return Math.max(0, Math.min(7, Math.round(track.scrollLeft / track.clientWidth)));
  }
  function updateNav(n) {
    if (n == null) n = activeStage();
    document.querySelectorAll(".titleblock .spine-cell").forEach(function (c, i) {
      c.classList.toggle("is-active", i === n);
    });
    var prev = document.querySelector(".nav-arrow.prev");
    var next = document.querySelector(".nav-arrow.next");
    if (prev) prev.disabled = n <= 0;
    if (next) next.disabled = n >= 7;
  }
  function gotoStage(n, instant) {
    n = Math.max(0, Math.min(7, Number(n)));
    track.scrollTo({ left: n * track.clientWidth, behavior: (instant || reduceMotion) ? "auto" : "smooth" });
    updateNav(n);
  }

  var ticking = false;
  track.addEventListener("scroll", function () {
    if (!ticking) { ticking = true; requestAnimationFrame(function () { updateNav(); ticking = false; }); }
  });
  var lastActive = currentStage;
  window.addEventListener("resize", function () { gotoStage(lastActive, true); });

  // ---- counts & tally ----------------------------------------------------
  function recountStage(stageEl) {
    if (!stageEl) return;
    var counts = {};
    STATUSES.forEach(function (st) {
      var n = stageEl.querySelectorAll('.col-cards[data-status="' + st + '"] > .card').length;
      counts[st] = n;
      var cc = stageEl.querySelector(".col-" + st + " .col-count");
      if (cc) cc.textContent = n;
    });
    var urgent = stageEl.querySelectorAll(".card.is-urgent").length;
    var html = "";
    STATUSES.forEach(function (st) {
      if (counts[st]) html += '<span class="pip pip-' + st + '">' + counts[st] + " " + STATUS_LABELS[st].toLowerCase() + "</span>";
    });
    if (urgent) html += '<span class="pip pip-urgent">' + urgent + " urgent</span>";
    var box = stageEl.querySelector(".stage-counts");
    if (box) box.innerHTML = html;
  }
  function updateUrgentTally() {
    var n = board.querySelectorAll(".card.is-urgent").length;
    var el = document.getElementById("tb-urgent");
    if (!el) return;
    if (n > 0) { el.hidden = false; el.textContent = n + " urgent"; } else { el.hidden = true; }
  }

  // ---- nudge -------------------------------------------------------------
  function registerActivity(stage, taskId) {
    stage = Number(stage);
    if (stage > currentStage) {
      if (!activity[stage]) activity[stage] = new Set();
      activity[stage].add(Number(taskId));
      evaluateNudge();
    }
  }
  function currentStageCompletion() {
    var st = document.getElementById("stage-" + currentStage);
    if (!st) return 0;
    var total = st.querySelectorAll(".col-cards > .card").length;
    if (!total) return 0;
    return st.querySelectorAll('.col-cards[data-status="done"] > .card').length / total;
  }
  function evaluateNudge() {
    var target = null, s;
    for (s = 7; s > currentStage; s--) {
      if (activity[s] && activity[s].size >= 3 && !dismissed[s]) { target = s; break; }
    }
    if (target === null && currentStageCompletion() >= 0.8) {
      for (s = 7; s > currentStage; s--) {
        if (activity[s] && activity[s].size >= 1 && !dismissed[s]) { target = s; break; }
      }
    }
    var nudge = document.getElementById("nudge");
    if (target !== null) {
      nudge.querySelector(".nudge-text").textContent =
        "Working in Stage " + target + " (" + RIBA[target] + ") — set as current?";
      nudge.dataset.stage = target;
      nudge.hidden = false;
    } else { nudge.hidden = true; }
  }

  // ---- current stage -----------------------------------------------------
  async function setCurrentStage(n) {
    n = Number(n);
    var r = await api("/api/projects/" + projectId + "/current_stage", { stage: n });
    if (!r) return;
    currentStage = n;
    board.dataset.currentStage = n;

    document.querySelectorAll(".titleblock .spine-cell").forEach(function (cell, i) {
      cell.classList.remove("is-current", "is-past", "is-future");
      cell.classList.add(i < n ? "is-past" : (i === n ? "is-current" : "is-future"));
    });
    var csn = document.querySelector(".compact-stage-num");
    if (csn) csn.textContent = n;

    document.querySelectorAll(".here-tag").forEach(function (t) { t.remove(); });
    var nameEl = document.querySelector("#stage-" + n + " .slide-head .stage-name");
    if (nameEl) {
      var tag = document.createElement("span");
      tag.className = "here-tag"; tag.textContent = "you are here";
      nameEl.insertAdjacentElement("afterend", tag);
    }
    document.querySelectorAll(".stage-slide").forEach(function (st) {
      var idx = Number(st.dataset.stage);
      var btn = st.querySelector(".set-current");
      var badge = st.querySelector(".current-badge");
      if (btn) btn.hidden = idx === n;
      if (badge) badge.hidden = idx !== n;
    });

    document.getElementById("nudge").hidden = true;
    gotoStage(n);
    evaluateNudge();
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
      if (done) return; done = true;
      delete displayEl.dataset.editing;
      onSave(commit ? input.value.trim() : null, input.value.trim() !== currentText);
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    });
    input.addEventListener("blur", function () { finish(true); });
  }
  function editTitle(titleEl) {
    var id = cardOf(titleEl).dataset.taskId;
    var text = titleEl.textContent.trim();
    editInline(titleEl, text, async function (val, changed) {
      if (val === null || !changed || !val) { titleEl.textContent = text; return; }
      var r = await api("/api/tasks/" + id, { title: val });
      titleEl.textContent = (r && val) || text;
    });
  }
  function editAwaiting(box) {
    var id = cardOf(box).dataset.taskId;
    var textEl = box.querySelector(".awaiting-text");
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
    var raw = cell.textContent.trim();
    var current = raw === "—" ? "" : raw;
    editInline(cell, current, async function (val, changed) {
      if (val === null || !changed) { cell.textContent = raw; return; }
      var payload = {}; payload[field] = val;
      var r = await api("/api/projects/" + projectId, payload);
      cell.textContent = r ? (val || (field === "number" ? "—" : raw)) : raw;
    });
  }

  // ---- task mutations ----------------------------------------------------
  async function stepStatus(card, dir) {
    var idx = STATUSES.indexOf(card.dataset.status);
    var ni = idx + dir;
    if (ni < 0 || ni >= STATUSES.length) return;
    var newStatus = STATUSES[ni];
    var id = card.dataset.taskId;
    var stageEl = stageElOf(card);
    var r = await api("/api/tasks/" + id, { status: newStatus });
    if (!r) return;
    card.dataset.status = newStatus;
    card.classList.remove("status-upcoming", "status-todo", "status-awaiting", "status-done");
    card.classList.add("status-" + newStatus);
    card.querySelector(".status-label").textContent = STATUS_LABELS[newStatus];
    card.querySelector(".step-prev").disabled = ni === 0;
    card.querySelector(".step-next").disabled = ni === STATUSES.length - 1;
    var dest = stageEl.querySelector('.col-cards[data-status="' + newStatus + '"]');
    if (dest) dest.appendChild(card);
    recountStage(stageEl); updateUrgentTally(); registerActivity(stageEl.dataset.stage, id);
  }
  async function toggleUrgent(btn) {
    var card = cardOf(btn);
    var id = card.dataset.taskId;
    var next = card.dataset.urgent !== "1";
    var r = await api("/api/tasks/" + id, { urgent: next });
    if (!r) return;
    card.dataset.urgent = next ? "1" : "0";
    card.classList.toggle("is-urgent", next);
    btn.setAttribute("aria-pressed", next ? "true" : "false");
    recountStage(stageElOf(card)); updateUrgentTally(); registerActivity(card.dataset.stage, id);
  }
  async function changeType(select) {
    var card = cardOf(select);
    var id = card.dataset.taskId;
    var oldType = card.dataset.type, newType = select.value;
    if (newType === oldType) return;
    if (oldType === "statutory" && newType !== "statutory") {
      if (!confirm("Remove the statutory marker from this task? Statutory tasks carry legal duties.")) {
        select.value = oldType; return;
      }
    }
    var r = await api("/api/tasks/" + id, { type: newType });
    if (!r) { select.value = oldType; return; }
    card.dataset.type = newType;
    card.classList.remove("type-client", "type-statutory", "type-admin");
    card.classList.add("type-" + newType);
    var tag = card.querySelector(".statutory-tag");
    if (newType === "statutory" && !tag) {
      tag = document.createElement("span"); tag.className = "statutory-tag"; tag.textContent = "Statutory";
      select.insertAdjacentElement("afterend", tag);
    } else if (newType !== "statutory" && tag) { tag.remove(); }
    registerActivity(card.dataset.stage, id);
  }
  async function deleteTask(btn) {
    var card = cardOf(btn);
    if (!confirm("Delete this task?")) return;
    var stageEl = stageElOf(card);
    var r = await api("/api/tasks/" + card.dataset.taskId + "/delete", {});
    if (!r) return;
    card.remove(); recountStage(stageEl); updateUrgentTally();
  }
  async function addTask(form) {
    var stage = Number(form.dataset.stage);
    var titleInput = form.querySelector('input[name="title"]');
    var title = titleInput.value.trim();
    if (!title) { titleInput.focus(); return; }
    var type = form.querySelector('select[name="type"]').value;
    var r = await api("/api/projects/" + projectId + "/tasks", { stage: stage, title: title, type: type });
    if (!r) return;
    var stageEl = document.getElementById("stage-" + stage);
    stageEl.querySelector('.col-cards[data-status="todo"]').insertAdjacentHTML("beforeend", r.html);
    titleInput.value = ""; titleInput.focus();
    recountStage(stageEl); registerActivity(stage, r.task.id);
  }

  // ---- filters & collapse (persisted) ------------------------------------
  var LS_FILTERS = "arckanban-filters", LS_COLLAPSE = "arckanban-tb-collapsed";
  function applyFilters(state) {
    document.body.classList.toggle("filter-urgent", !!state.urgent);
    document.body.classList.toggle("filter-statutory", !!state.statutory);
    document.body.classList.toggle("hide-done", !!state.done);
    document.querySelectorAll(".filter-btn").forEach(function (b) {
      b.setAttribute("aria-pressed", state[b.dataset.filter] ? "true" : "false");
    });
  }
  function loadFilters() { try { return JSON.parse(localStorage.getItem(LS_FILTERS)) || {}; } catch (e) { return {}; } }
  function toggleFilter(name) {
    var state = loadFilters(); state[name] = !state[name];
    localStorage.setItem(LS_FILTERS, JSON.stringify(state)); applyFilters(state);
  }
  function applyCollapse(on) { document.getElementById("titleblock").classList.toggle("is-collapsed", on); }

  // ---- event wiring ------------------------------------------------------
  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-action], [data-filter]");
    if (!el) return;
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
      case "set-current": setCurrentStage(el.dataset.stage); break;
      case "goto-stage": lastActive = Number(el.dataset.stage); gotoStage(el.dataset.stage); break;
      case "nav-prev": lastActive = activeStage() - 1; gotoStage(lastActive); break;
      case "nav-next": lastActive = activeStage() + 1; gotoStage(lastActive); break;
      case "toggle-titleblock": {
        var on = !document.getElementById("titleblock").classList.contains("is-collapsed");
        applyCollapse(on); localStorage.setItem(LS_COLLAPSE, on ? "1" : "0"); break;
      }
      case "nudge-set": setCurrentStage(document.getElementById("nudge").dataset.stage); break;
      case "nudge-dismiss": {
        var s = Number(document.getElementById("nudge").dataset.stage);
        dismissed[s] = true; document.getElementById("nudge").hidden = true; break;
      }
    }
  });

  document.addEventListener("change", function (e) {
    if (e.target.matches(".type-select")) changeType(e.target);
  });
  document.addEventListener("submit", function (e) {
    var form = e.target.closest('[data-action="add-task"]');
    if (form) { e.preventDefault(); addTask(form); }
  });

  document.addEventListener("keydown", function (e) {
    var t = e.target;
    if (e.key === "Enter" || e.key === " ") {
      if (t.matches(".spine-cell, .task-title, .tb-cell, .awaiting-on")) { e.preventDefault(); t.click(); }
      return;
    }
    // Left / right flip stages, unless typing in a field.
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (t.matches("input, select, textarea, [contenteditable]")) return;
      lastActive = activeStage() + (e.key === "ArrowRight" ? 1 : -1);
      gotoStage(lastActive);
    }
  });

  // ---- init --------------------------------------------------------------
  applyFilters(loadFilters());
  applyCollapse(localStorage.getItem(LS_COLLAPSE) === "1");
  updateUrgentTally();
  gotoStage(currentStage, true);
})();
