/* ArcKanban — register (home) page.
   Template uploader: pick "Upload a template…" in the picker → choose a JSON
   file you saved earlier → name it in a popup → it's stored in the library and
   offered on every future project. Parses/validates client-side first, then
   POSTs {name, template} to the server which sanitizes and writes the file. */
(function () {
  "use strict";
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
