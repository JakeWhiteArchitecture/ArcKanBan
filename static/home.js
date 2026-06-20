/* ArcKanban — register (home) page.
   Template uploader: pick "Upload a template…" in the picker → choose a JSON
   file you saved earlier → name it in a popup → it's stored in the library and
   offered on every future project. Parses/validates client-side first, then
   POSTs {name, template} to the server which sanitizes and writes the file. */
(function () {
  "use strict";

  // Close any open project Config popover when clicking away / pressing Escape.
  document.addEventListener("click", function (e) {
    document.querySelectorAll("details.card-config[open]").forEach(function (d) {
      if (!d.contains(e.target)) d.removeAttribute("open");
    });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") document.querySelectorAll("details.card-config[open]").forEach(function (d) { d.removeAttribute("open"); });
  });

  // Edge-aware Config popover: open downward; flip up only when there's no room
  // below and more above (bottom-row cards). max-height keeps it inside the view.
  document.querySelectorAll("details.card-config").forEach(function (d) {
    d.addEventListener("toggle", function () {
      d.classList.remove("flip-up");
      if (!d.open) return;
      var menu = d.querySelector(".config-menu"), sum = d.querySelector("summary");
      if (!menu || !sum) return;
      var rect = sum.getBoundingClientRect();
      var below = window.innerHeight - rect.bottom - 12, above = rect.top - 12;
      if (menu.offsetHeight > below && above > below) d.classList.add("flip-up");
    });
  });

  // Sub-stage tickboxes (Config): parts are contiguous — c needs b.
  document.addEventListener("change", function (e) {
    var cb = e.target;
    if (!cb.matches || !cb.matches('input[name="subpart"]')) return;
    var row = cb.closest(".substage-row"); if (!row) return;
    var b = row.querySelector('input[value$="b"]'), c = row.querySelector('input[value$="c"]');
    if (cb === c && c.checked && b) b.checked = true;     // ticking c auto-ticks b
    if (cb === b && !b.checked && c) c.checked = false;   // unticking b drops c
  });

  // Backdate tool (Config): set a confirmed decision's date — for recording
  // older decisions on live projects. Updates inline; the Config stays open.
  document.querySelectorAll(".backdate").forEach(function (box) {
    var pick = box.querySelector(".backdate-pick"), date = box.querySelector(".backdate-date");
    var setBtn = box.querySelector(".backdate-set"), note = box.querySelector(".backdate-note");
    if (!pick || !date || !setBtn) return;
    function sync() { var o = pick.options[pick.selectedIndex]; if (o && o.dataset.ymd) date.value = o.dataset.ymd; }
    pick.addEventListener("change", function () { sync(); note.textContent = ""; });
    setBtn.addEventListener("click", async function () {
      var id = pick.value, d = date.value;
      if (!id || !d) { note.textContent = "Pick a decision and a date."; return; }
      setBtn.disabled = true; note.textContent = "Saving…";
      var res, json = {};
      try {
        res = await fetch("/api/tasks/" + id + "/decided-date", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: d }),
        });
      } catch (e) { note.textContent = "Couldn't reach the app."; setBtn.disabled = false; return; }
      try { json = await res.json(); } catch (e) {}
      setBtn.disabled = false;
      if (!res.ok || !json.ok) { note.textContent = (json && json.error) || "Couldn't set the date."; return; }
      note.textContent = "✓ Dated " + json.decided_day;
      var o = pick.options[pick.selectedIndex];   // keep the dropdown label + prefill current
      if (o) { o.dataset.ymd = json.ymd; o.textContent = o.textContent.replace(/\s+—\s+.*$/, "") + " — " + json.decided_day; }
    });
  });

  var select = document.getElementById("template-select");
  var fileInput = document.getElementById("tpl-file");
  var modal = document.getElementById("upload-modal");
  if (!select || !fileInput || !modal) return;

  var nameInput = document.getElementById("upload-name");
  var fileNote = document.getElementById("upload-file-note");
  var saveBtn = document.getElementById("upload-save");
  var cancelBtn = document.getElementById("upload-cancel");
  var pending = null;   // the parsed template object awaiting a name

  select.addEventListener("change", function () {
    if (select.value === "__upload__") { select.value = "__blank__"; fileInput.value = ""; fileInput.click(); }
  });

  fileInput.addEventListener("change", function () {
    var f = fileInput.files && fileInput.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      var obj;
      try { obj = JSON.parse(reader.result); }
      catch (e) { alert("That file isn't valid JSON."); return; }
      if (!obj || !Array.isArray(obj.tasks)) { alert("That doesn't look like an ArcKanban template (no tasks)."); return; }
      pending = obj;
      fileNote.textContent = f.name + " · " + obj.tasks.length + " task" + (obj.tasks.length === 1 ? "" : "s");
      nameInput.value = obj.name || f.name.replace(/\.json$/i, "");
      openModal();
    };
    reader.readAsText(f);
  });

  function openModal() { modal.hidden = false; nameInput.focus(); nameInput.select(); }
  function closeModal() { modal.hidden = true; pending = null; saveBtn.disabled = false; }

  cancelBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !modal.hidden) closeModal(); });
  nameInput.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); save(); } });
  saveBtn.addEventListener("click", save);

  async function save() {
    if (!pending) return;
    var name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    saveBtn.disabled = true;
    var res;
    try {
      res = await fetch("/templates/upload", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name, template: pending }),
      });
    } catch (e) { alert("Upload failed — is the app still running?"); saveBtn.disabled = false; return; }
    var json = {};
    try { json = await res.json(); } catch (e) {}
    if (!res.ok || !json.ok) { alert((json && json.error) || "Upload failed."); saveBtn.disabled = false; return; }
    window.location = "/?tpl=" + encodeURIComponent(json.file);   // reload with the new template pre-selected
  }
})();
