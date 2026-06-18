/* ArcKanban — decision register page.
   Each row can spawn a task that "feeds from" that decision; the link is stored
   server-side (from_decision_id) and logged, so the connection is recoverable
   later (process analysis / AI). No reload — the new task is appended in place. */
(function () {
  "use strict";

  // Return to the same board stage you were viewing (board.js saves it per project).
  var back = document.querySelector(".dr-back");
  if (back && back.dataset.projectId) {
    var n = null; try { n = localStorage.getItem("arckanban-stage-" + back.dataset.projectId); } catch (e) {}
    if (n != null && n !== "") back.href = back.href.split("?")[0] + "?stage=" + encodeURIComponent(n);
  }

  var table = document.querySelector(".dr-table");
  if (!table) return;

  document.addEventListener("submit", async function (e) {
    var form = e.target.closest(".dr-addtask");
    if (!form) return;
    e.preventDefault();
    var input = form.querySelector('input[name="title"]');
    var title = input.value.trim();
    if (!title) { input.focus(); return; }
    var did = form.dataset.decisionId;
    var res, json = {};
    try {
      res = await fetch("/api/decisions/" + did + "/tasks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title }),
      });
    } catch (err) { alert("Could not reach the app. Is it still running?"); return; }
    try { json = await res.json(); } catch (err) {}
    if (!res.ok || !json.ok) { alert((json && json.error) || "Could not add the task."); return; }
    var ul = form.parentElement.querySelector(".dr-linked");
    var li = document.createElement("li"); li.className = "dr-linked-item"; li.textContent = json.task.title;
    ul.appendChild(li);
    input.value = ""; input.focus();   // keep adding
  });

  // ---- inline rationale editing (the optional "why" column) --------------
  document.addEventListener("click", function (e) {
    var cell = e.target.closest(".dr-rationale");
    if (cell && !cell.querySelector("textarea")) startRationaleEdit(cell);
  });
  function renderRationale(cell, val) {
    cell.dataset.value = val;
    if (val) cell.textContent = val;
    else cell.innerHTML = '<span class="dr-empty">— add rationale</span>';
  }
  function startRationaleEdit(cell) {
    var id = cell.dataset.decisionId;
    var current = "value" in cell.dataset ? cell.dataset.value
                : (cell.querySelector(".dr-empty") ? "" : cell.textContent.trim());
    var ta = document.createElement("textarea");
    ta.className = "dr-rationale-input"; ta.rows = 3; ta.value = current;
    cell.textContent = ""; cell.appendChild(ta); ta.focus();
    var done = false;
    function finish(commit) {
      if (done) return; done = true;
      if (commit) saveRationale(id, ta.value.trim(), cell);
      else renderRationale(cell, current);
    }
    ta.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); finish(true); }   // Shift+Enter = newline
      else if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
    });
    ta.addEventListener("blur", function () { finish(true); });
  }
  async function saveRationale(id, val, cell) {
    var res, json = {};
    try {
      res = await fetch("/api/tasks/" + id, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rationale: val }) });
    } catch (err) { alert("Could not reach the app. Is it still running?"); renderRationale(cell, val); return; }
    try { json = await res.json(); } catch (err) {}
    if (!res.ok || !json.ok) alert((json && json.error) || "Could not save the rationale.");
    renderRationale(cell, val);
  }
})();
