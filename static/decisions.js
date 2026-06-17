/* ArcKanban — decision register page.
   Each row can spawn a task that "feeds from" that decision; the link is stored
   server-side (from_decision_id) and logged, so the connection is recoverable
   later (process analysis / AI). No reload — the new task is appended in place. */
(function () {
  "use strict";
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
})();
