/* ArcKanban — Gantt chart view.
   Driven by the project's Sections of Work: the sidebar lists sections (paged
   by RIBA stage, like the board/decisions/task list — a "Show all stages"
   toggle reveals everything), a bar for each scheduled item. No bar
   dependencies. Bars are drawn as SVG path `d` strings matching the project's
   global corner-shape setting (mirrored server-side for the PDF export by
   _gantt_bar_path in app.py — same corner map, same corner size). Holidays
   split any bar that crosses them (_split_around_holidays, mirrored here).
   The timeline is an open-ended virtual canvas: click-drag pans it (scrollLeft
   tracking the mouse), and the rendered date window quietly extends whenever
   the scroll position nears an edge, so it "rolls on" indefinitely. Bars can
   be dragged to move, or dragged at an end to resize. Self-contained IIFE,
   same pattern as the other page scripts; no build step. */
(function () {
  "use strict";

  var D = window.GANTT_DATA;
  if (!D) return;

  var RIBA = [
    "Strategic Definition", "Preparation and Briefing", "Concept Design",
    "Spatial Coordination", "Technical Design", "Manufacturing and Construction",
    "Handover", "Use",
  ];

  var SVGNS = "http://www.w3.org/2000/svg";
  var ROW_H = 32;              // px — must match the sidebar row height set below
  var HEAD_H = 26;             // px — month-label strip / column-head strip
  var ZOOM_LEVELS = [10, 16, 22, 28, 36, 48, 64];   // px per day
  var DEFAULT_ZOOM_IDX = 3;
  var EXTEND_DAYS = 120;        // how far to extend the rendered window at an edge
  var EDGE_PX = 400;            // trigger extension within this many px of an edge
  var EDGE_ZONE_PX = 8;         // resize handle hit-zone at a bar's edge
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var GANTT_SHAPE_CORNERS = {
    rounded_all:   ["r", "r", "r", "r"],
    rounded_tl_br: ["r", "s", "r", "s"],
    rounded_br_tl: ["s", "r", "s", "r"],
    chamfer_all:   ["c", "c", "c", "c"],
    chamfer_tl_br: ["c", "s", "c", "s"],
    chamfer_br_tl: ["s", "c", "s", "c"],
    square:        ["s", "s", "s", "s"],
  };

  var rootStyle = getComputedStyle(document.documentElement);
  function cssVar(name, fallback) { var v = rootStyle.getPropertyValue(name); return (v && v.trim()) || fallback; }
  var COL_INK = cssVar("--ink", "#E9EDF8");
  var COL_INK_SOFT = cssVar("--ink-soft", "#98A2BC");
  var COL_REDLINE = cssVar("--redline", "#FF6B5C");
  var COL_BLUE = cssVar("--blue", "#5B8DEF");
  var COL_GLASS = cssVar("--glass", "rgba(255,255,255,0.045)");
  var FONT_UI = cssVar("--font-ui", "sans-serif");
  var FONT_MONO = cssVar("--font-mono", "monospace");

  async function api(url, data) {
    var res;
    try {
      res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data || {}) });
    } catch (e) { alert("Could not reach the app. Is it still running?"); return null; }
    var json = {};
    try { json = await res.json(); } catch (e) {}
    if (!res.ok || !json.ok) { alert((json && json.error) || "That didn't work."); return null; }
    return json;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtDisplayDate(d) {
    var dd = String(d.getDate()).padStart(2, "0");
    var mm = String(d.getMonth() + 1).padStart(2, "0");
    return dd + "-" + mm + "-" + d.getFullYear();
  }
  function parseISO(s) { return new Date(s + "T00:00:00"); }
  function toISO(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function addDays(d, n) { var r = new Date(d); r.setDate(r.getDate() + n); return r; }
  function dayDiff(a, b) { return Math.round((b - a) / 86400000); }
  function textColourFor(hex) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6 ? "#0A0F1F" : "#F5F7FC";
  }

  // ---- working-day model — mirrors _is_weekend / _working_days_between /
  // _compute_effective_end in app.py. Weekends aren't counted as duration and
  // bars run straight through them; holidays fall on what would otherwise be
  // a working day, so they push a bar's effective end out instead of just
  // erasing the overlapping days. ------------------------------------------
  function isWeekend(d) { var wd = d.getDay(); return wd === 0 || wd === 6; }
  function workingDaysBetween(start, end) {
    var count = 0, d = new Date(start);
    while (d <= end) { if (!isWeekend(d)) count++; d = addDays(d, 1); }
    return count;
  }
  function addWorkingDays(start, n) {   // the date of the nth working day counting from start (n >= 1)
    var d = new Date(start), count = 0;
    while (count < n) {
      if (!isWeekend(d)) count++;
      if (count >= n) break;
      d = addDays(d, 1);
    }
    return d;
  }
  function inAnyHoliday(d, holidays) {
    return holidays.some(function (h) { return d >= h[0] && d <= h[1]; });
  }
  function computeEffectiveEnd(start, end, holidays) {
    var lost = 0, d = new Date(start);
    while (d <= end) { if (!isWeekend(d) && inAnyHoliday(d, holidays)) lost++; d = addDays(d, 1); }
    if (lost === 0) return end;   // no overlap — the stored end stands, weekend or not
    var newEnd = new Date(end), added = 0;
    while (added < lost) {
      newEnd = addDays(newEnd, 1);
      if (!isWeekend(newEnd) && !inAnyHoliday(newEnd, holidays)) added++;
    }
    return newEnd;
  }

  // ---- shape path (SVG `d`) — mirrors _gantt_bar_path in app.py -----------
  function barPath(x, y, w, h, shape) {
    var c = GANTT_SHAPE_CORNERS[shape] || GANTT_SHAPE_CORNERS.rounded_all;
    var tl = c[0], tr = c[1], br = c[2], bl = c[3];
    var r = Math.max(0, Math.min(10, w / 2, h / 2));
    var x2 = x + w, y2 = y + h;
    var d = "M " + (x + (tl !== "s" ? r : 0)) + " " + y + " ";
    d += "L " + (x2 - (tr !== "s" ? r : 0)) + " " + y + " ";
    if (tr === "r") d += "A " + r + " " + r + " 0 0 1 " + x2 + " " + (y + r) + " ";
    else if (tr === "c") d += "L " + x2 + " " + (y + r) + " ";
    else d += "L " + x2 + " " + y + " ";
    d += "L " + x2 + " " + (y2 - (br !== "s" ? r : 0)) + " ";
    if (br === "r") d += "A " + r + " " + r + " 0 0 1 " + (x2 - r) + " " + y2 + " ";
    else if (br === "c") d += "L " + (x2 - r) + " " + y2 + " ";
    else d += "L " + x2 + " " + y2 + " ";
    d += "L " + (x + (bl !== "s" ? r : 0)) + " " + y2 + " ";
    if (bl === "r") d += "A " + r + " " + r + " 0 0 1 " + x + " " + (y2 - r) + " ";
    else if (bl === "c") d += "L " + x + " " + (y2 - r) + " ";
    else d += "L " + x + " " + y2 + " ";
    d += "L " + x + " " + (y + (tl !== "s" ? r : 0)) + " ";
    if (tl === "r") d += "A " + r + " " + r + " 0 0 1 " + (x + r) + " " + y + " ";
    else if (tl === "c") d += "L " + (x + r) + " " + y + " ";
    else d += "L " + x + " " + y + " ";
    d += "Z";
    return d;
  }

  // ---- holiday splitting — mirrors _split_around_holidays in app.py ------
  function splitAroundHolidays(start, end, holidays) {
    var segments = [[start, end]];
    holidays.slice().sort(function (a, b) { return a[0] - b[0]; }).forEach(function (h) {
      var hStart = h[0], hEnd = h[1], next = [];
      segments.forEach(function (seg) {
        var segStart = seg[0], segEnd = seg[1];
        if (hEnd < segStart || hStart > segEnd) { next.push([segStart, segEnd]); return; }
        if (hStart > segStart) next.push([segStart, addDays(hStart, -1)]);
        if (hEnd < segEnd) next.push([addDays(hEnd, 1), segEnd]);
      });
      segments = next;
    });
    return segments;
  }

  var sectionsById = {};
  D.allSections.forEach(function (s) { sectionsById[s.id] = s; });

  var tb = document.getElementById("titleblock");
  var projectUid = tb ? tb.dataset.projectUid : D.projectUid;
  var currentStage = tb ? Number(tb.dataset.currentStage) : 0;
  var enabledStages = ((tb && tb.dataset.stages) || "0,1,2,3,4,5,6,7").split(",").map(Number);
  function isEnabled(n) { return enabledStages.indexOf(Number(n)) >= 0; }
  function nextEnabledStage(from, dir) { for (var i = Number(from) + dir; i >= 0 && i <= 7; i += dir) if (isEnabled(i)) return i; return null; }

  var sidebarEl = document.getElementById("gantt-sidebar");
  var sidebarRowsEl = document.getElementById("gantt-sidebar-rows");
  var sidebarEmptyEl = document.getElementById("gantt-sidebar-empty");
  var colHeadEl = document.getElementById("gantt-col-head");
  var chartEl = document.getElementById("gantt-chart");
  var resizeHandle = document.getElementById("gantt-resize-handle");

  function itemForSection(sectionId) {
    var found = D.items.filter(function (it) { return it.section_id === sectionId; });
    return found.length ? found[0] : null;
  }

  // ---- stage paging (mirrors the task list / decision register) ----------
  var LS_STAGE = "arckanban-gantt-stage-" + projectUid;
  var view = currentStage;
  try {
    var savedStage = localStorage.getItem(LS_STAGE);
    if (savedStage === "all") view = "all";
    else if (savedStage !== null && savedStage !== "" && isEnabled(Number(savedStage))) view = Number(savedStage);
  } catch (e) {}
  if (view !== "all" && !isEnabled(view)) view = isEnabled(currentStage) ? currentStage : (enabledStages[0] != null ? enabledStages[0] : 0);
  var lastStage = view === "all" ? currentStage : view;

  function visibleSections() {
    return D.allSections.filter(function (s) { return view === "all" || s.stage === view; });
  }

  function applyStagePager() {
    var all = view === "all";
    var num = document.querySelector(".tb-stage-num"), nm = document.querySelector(".tb-stage-name");
    var prev = document.querySelector(".tb-pager.prev"), next = document.querySelector(".tb-pager.next");
    var toggle = document.querySelector('[data-action="gantt-toggle-all"]');
    if (all) {
      if (num) num.textContent = "·"; if (nm) nm.textContent = "All stages";
      if (prev) prev.disabled = true; if (next) next.disabled = true;
      if (toggle) toggle.textContent = "Show stage " + lastStage;
    } else {
      if (num) num.textContent = view; if (nm) nm.textContent = RIBA[view];
      if (prev) prev.disabled = nextEnabledStage(view, -1) === null;
      if (next) next.disabled = nextEnabledStage(view, +1) === null;
      if (toggle) toggle.textContent = "Show all stages";
    }
    try { localStorage.setItem(LS_STAGE, all ? "all" : String(view)); } catch (e) {}
    refresh();
  }
  function goStage(n) { if (n == null) return; view = n; lastStage = n; applyStagePager(); }
  function toggleAllStages() { if (view === "all") goStage(isEnabled(lastStage) ? lastStage : currentStage); else { view = "all"; applyStagePager(); } }

  // ---- pan/zoom viewport state --------------------------------------------
  var dayW = ZOOM_LEVELS[DEFAULT_ZOOM_IDX];
  var zoomIdx = DEFAULT_ZOOM_IDX;
  var viewStart, viewEnd;   // the currently-rendered date window (Date objects)

  function computeDefaultRange() {
    var allDates = [];
    D.items.forEach(function (it) { allDates.push(parseISO(it.start_date), parseISO(it.end_date)); });
    D.holidays.forEach(function (h) { allDates.push(parseISO(h.start_date), parseISO(h.end_date)); });
    var today = new Date(); today.setHours(0, 0, 0, 0);
    if (!allDates.length) allDates.push(today);
    var minD = new Date(Math.min.apply(null, allDates));
    var maxD = new Date(Math.max.apply(null, allDates));
    return { start: addDays(minD, -30), end: addDays(maxD, 30) };
  }
  function xOf(d) { return dayDiff(viewStart, d) * dayW; }
  function dateAtX(x) { return addDays(viewStart, Math.round(x / dayW)); }
  function ensureRangeVisible(start, end) {
    if (start < viewStart) viewStart = addDays(start, -14);
    if (end > viewEnd) viewEnd = addDays(end, 14);
  }

  function refresh() { renderSidebar(); renderChart(); }

  // ---- sidebar (JS-built: title, start, end, duration, edit button) ------
  function buildRow(section) {
    var item = itemForSection(section.id);
    var row = document.createElement("div");
    row.className = "gantt-row-label" + (item ? " is-scheduled" : "");
    row.dataset.sectionId = section.id;

    var title = document.createElement("span");
    title.className = "gantt-row-title";
    title.title = section.title;
    title.textContent = section.title;
    row.appendChild(title);

    var durSpan = document.createElement("span"); durSpan.className = "gantt-row-dur";
    durSpan.textContent = item ? workingDaysBetween(parseISO(item.start_date), parseISO(item.end_date)) + "d" : "—";
    row.appendChild(durSpan);

    var btn = document.createElement("button");
    btn.type = "button"; btn.className = "gantt-row-btn"; btn.dataset.sectionId = section.id;
    btn.textContent = item ? "✎" : "+";
    btn.title = item ? "Edit on the Gantt" : "Add to the Gantt";
    btn.setAttribute("aria-label", (item ? "Edit " : "Add ") + section.title + (item ? " on the Gantt" : " to the Gantt"));
    row.appendChild(btn);
    return row;
  }

  function renderSidebar() {
    if (!sidebarRowsEl) return;
    sidebarRowsEl.innerHTML = "";
    var visible = visibleSections();
    visible.forEach(function (s) { sidebarRowsEl.appendChild(buildRow(s)); });
    if (sidebarEmptyEl) sidebarEmptyEl.hidden = visible.length !== 0;
    syncRowHeights();
  }

  function syncRowHeights() {
    if (colHeadEl) colHeadEl.style.height = HEAD_H + "px";
    [].slice.call((sidebarRowsEl || sidebarEl).querySelectorAll(".gantt-row-label")).forEach(function (row) { row.style.height = ROW_H + "px"; });
  }

  // ---- chart render (viewport-relative; panning/zoom shift viewStart/dayW) ----
  function renderChart() {
    if (!chartEl) return;
    var rows = visibleSections();
    var chartW = Math.max(1, dayDiff(viewStart, viewEnd) * dayW);
    var chartH = HEAD_H + rows.length * ROW_H;
    var holidayRanges = D.holidays.map(function (h) { return [parseISO(h.start_date), parseISO(h.end_date)]; });
    var today = new Date(); today.setHours(0, 0, 0, 0);

    var svg = [];
    svg.push('<svg xmlns="' + SVGNS + '" width="' + chartW + '" height="' + chartH + '" viewBox="0 0 ' + chartW + ' ' + chartH + '">');
    svg.push('<defs>');
    svg.push('<pattern id="gantt-hatch" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">' +
             '<line x1="0" y1="0" x2="0" y2="7" stroke="' + COL_INK_SOFT + '" stroke-opacity="0.35" stroke-width="1.5"></line></pattern>');
    svg.push('<pattern id="gantt-weekend-hatch" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">' +
             '<line x1="0" y1="0" x2="0" y2="7" stroke="' + COL_INK_SOFT + '" stroke-opacity="0.10" stroke-width="1.5"></line></pattern>');
    svg.push('</defs>');

    rows.forEach(function (s, i) {
      if (i % 2 === 1) svg.push('<rect x="0" y="' + (HEAD_H + i * ROW_H) + '" width="' + chartW + '" height="' + ROW_H + '" fill="' + COL_GLASS + '"></rect>');
    });

    var wknd = new Date(viewStart);
    while (wknd <= viewEnd) {
      if (isWeekend(wknd)) {
        var wkx = xOf(wknd);
        svg.push('<rect x="' + wkx + '" y="' + HEAD_H + '" width="' + dayW + '" height="' + (chartH - HEAD_H) +
                 '" fill="url(#gantt-weekend-hatch)"></rect>');
      }
      wknd = addDays(wknd, 1);
    }

    var d = new Date(viewStart.getFullYear(), viewStart.getMonth(), 1);
    while (d <= viewEnd) {
      var gx = xOf(d);
      if (gx >= 0 && gx <= chartW) {
        svg.push('<line x1="' + gx + '" y1="0" x2="' + gx + '" y2="' + chartH + '" stroke="' + COL_INK_SOFT + '" stroke-opacity="0.16" stroke-width="1"></line>');
        svg.push('<text x="' + (gx + 5) + '" y="15" font-family="' + FONT_UI + '" font-size="11" fill="' + COL_INK_SOFT + '">' + MONTHS[d.getMonth()] + " " + d.getFullYear() + '</text>');
      }
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }

    var wd = new Date(viewStart);
    while (wd.getDay() !== 1) wd = addDays(wd, 1);
    while (wd <= viewEnd) {
      var wx = xOf(wd);
      if (wx >= 0 && wx <= chartW) svg.push('<line x1="' + wx + '" y1="' + HEAD_H + '" x2="' + wx + '" y2="' + chartH + '" stroke="' + COL_INK_SOFT + '" stroke-opacity="0.06" stroke-width="1"></line>');
      wd = addDays(wd, 7);
    }

    D.holidays.forEach(function (h) {
      var hx0 = Math.max(0, xOf(parseISO(h.start_date)));
      var hx1 = Math.min(chartW, xOf(addDays(parseISO(h.end_date), 1)));
      if (hx1 <= hx0) return;
      svg.push('<g class="gantt-holiday" data-holiday-id="' + h.id + '">');
      svg.push('<rect x="' + hx0 + '" y="' + HEAD_H + '" width="' + (hx1 - hx0) + '" height="' + (chartH - HEAD_H) + '" fill="url(#gantt-hatch)"></rect>');
      svg.push('<text x="' + (hx0 + 4) + '" y="' + (HEAD_H + 12) + '" font-family="' + FONT_UI + '" font-size="10" font-style="italic" fill="' + COL_INK_SOFT + '">' + esc(h.label) + '</text>');
      svg.push('</g>');
    });

    rows.forEach(function (s, i) {
      var it = itemForSection(s.id);
      if (!it) return;
      var rowY = HEAD_H + i * ROW_H;
      var barH = ROW_H * 0.6;
      var barY = rowY + (ROW_H - barH) / 2;
      var iStart = parseISO(it.start_date);
      var iEnd = computeEffectiveEnd(iStart, parseISO(it.end_date), holidayRanges);
      var segs = splitAroundHolidays(iStart, iEnd, holidayRanges);
      var lastX = 0;
      segs.forEach(function (seg, si) {
        var bx = xOf(seg[0]);
        var bw = Math.max(2, xOf(addDays(seg[1], 1)) - bx);
        lastX = bx + bw;
        svg.push('<g class="gantt-bar" data-item-id="' + it.id + '" data-section-id="' + s.id +
                 '" data-is-first="' + (si === 0 ? 1 : 0) + '" data-is-last="' + (si === segs.length - 1 ? 1 : 0) + '">');
        svg.push('<path d="' + barPath(bx, barY, bw, barH, D.shape) + '" fill="' + it.colour + '"></path>');
        if (bw > 80) {
          var label = fmtDisplayDate(iStart) + " – " + fmtDisplayDate(iEnd);
          svg.push('<text x="' + (bx + bw / 2) + '" y="' + (barY + barH / 2 + 4) + '" text-anchor="middle" font-family="' +
                   FONT_MONO + '" font-size="10" fill="' + textColourFor(it.colour) + '" pointer-events="none">' + esc(label) + '</text>');
        }
        svg.push('</g>');
      });
      svg.push('<text x="' + (lastX + 8) + '" y="' + (barY + barH / 2 + 4) + '" font-family="' + FONT_UI +
               '" font-size="11" fill="' + COL_INK + '" pointer-events="none">' + esc(s.title) + '</text>');
    });

    if (today >= viewStart && today <= viewEnd) {
      var tx = xOf(today);
      svg.push('<line x1="' + tx + '" y1="0" x2="' + tx + '" y2="' + chartH + '" stroke="' + COL_REDLINE + '" stroke-width="1.5"></line>');
      svg.push('<text x="' + (tx + 4) + '" y="12" font-family="' + FONT_MONO + '" font-size="10" fill="' + COL_REDLINE + '">Today</text>');
    }

    svg.push("</svg>");
    chartEl.innerHTML = svg.join("");
    syncRowHeights();
  }

  // ---- vertical scroll sync (sidebar <-> chart) + horizontal edge-extend ---
  var scrollSyncing = false, extending = false;
  function checkEdges() {
    if (extending || !chartEl) return;
    if (chartEl.scrollLeft < EDGE_PX) {
      extending = true;
      viewStart = addDays(viewStart, -EXTEND_DAYS);
      var addedPx = EXTEND_DAYS * dayW;
      renderChart();
      chartEl.scrollLeft += addedPx;
      extending = false;
    } else if (chartEl.scrollWidth - chartEl.clientWidth - chartEl.scrollLeft < EDGE_PX) {
      extending = true;
      viewEnd = addDays(viewEnd, EXTEND_DAYS);
      renderChart();
      extending = false;
    }
  }
  if (sidebarEl && chartEl) {
    chartEl.addEventListener("scroll", function () {
      if (!scrollSyncing) { scrollSyncing = true; sidebarEl.scrollTop = chartEl.scrollTop; scrollSyncing = false; }
      checkEdges();
    });
    sidebarEl.addEventListener("scroll", function () {
      if (scrollSyncing) return;
      scrollSyncing = true; chartEl.scrollTop = sidebarEl.scrollTop; scrollSyncing = false;
    });
  }

  // ---- zoom ------------------------------------------------------------
  function setZoom(newIdx) {
    newIdx = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, newIdx));
    if (newIdx === zoomIdx || !chartEl) return;
    var centerDate = dateAtX(chartEl.scrollLeft + chartEl.clientWidth / 2);
    zoomIdx = newIdx;
    dayW = ZOOM_LEVELS[zoomIdx];
    renderChart();
    chartEl.scrollLeft = Math.max(0, xOf(centerDate) - chartEl.clientWidth / 2);
  }

  function zoomToFit() {
    if (!chartEl) return;
    var allDates = [];
    D.items.forEach(function (it) { allDates.push(parseISO(it.start_date), parseISO(it.end_date)); });
    D.holidays.forEach(function (h) { allDates.push(parseISO(h.start_date), parseISO(h.end_date)); });
    if (!allDates.length) { var r = computeDefaultRange(); viewStart = r.start; viewEnd = r.end; renderChart(); chartEl.scrollLeft = 0; return; }
    var minD = new Date(Math.min.apply(null, allDates)), maxD = new Date(Math.max.apply(null, allDates));
    viewStart = addDays(minD, -3); viewEnd = addDays(maxD, 3);
    var totalDays = Math.max(1, dayDiff(viewStart, viewEnd));
    var fitted = Math.floor(chartEl.clientWidth / totalDays);
    dayW = Math.max(4, Math.min(ZOOM_LEVELS[ZOOM_LEVELS.length - 1], fitted));
    var closestIdx = 0, closestDiff = Infinity;
    ZOOM_LEVELS.forEach(function (lvl, i) { var diff = Math.abs(lvl - dayW); if (diff < closestDiff) { closestDiff = diff; closestIdx = i; } });
    zoomIdx = closestIdx;
    renderChart();
    chartEl.scrollLeft = 0;
  }

  // ---- pan: click-drag on empty chart area scrolls it -----------------
  var panDragging = false, panStartX, panStartY, panScrollLeft, panScrollTop;
  function startPan(e) {
    e.preventDefault();
    panDragging = true;
    panStartX = e.clientX; panStartY = e.clientY;
    panScrollLeft = chartEl.scrollLeft; panScrollTop = chartEl.scrollTop;
    chartEl.classList.add("is-panning");
    document.addEventListener("mousemove", onPanMove);
    document.addEventListener("mouseup", onPanUp);
  }
  function onPanMove(e) {
    if (!panDragging) return;
    chartEl.scrollLeft = panScrollLeft - (e.clientX - panStartX);
    chartEl.scrollTop = panScrollTop - (e.clientY - panStartY);
  }
  function onPanUp() {
    panDragging = false;
    chartEl.classList.remove("is-panning");
    document.removeEventListener("mousemove", onPanMove);
    document.removeEventListener("mouseup", onPanUp);
  }

  // ---- bars: drag to move, drag an end to resize -----------------------
  function hitMode(barGroup, clientX) {
    var isFirst = barGroup.dataset.isFirst === "1", isLast = barGroup.dataset.isLast === "1";
    var bbox = barGroup.querySelector("path").getBBox();
    var svgEl = chartEl.querySelector("svg");
    var localX = clientX - svgEl.getBoundingClientRect().left - bbox.x;
    if (isFirst && localX < EDGE_ZONE_PX) return "resize-start";
    if (isLast && (bbox.width - localX) < EDGE_ZONE_PX) return "resize-end";
    return "move";
  }
  function itemBoundsPx(item) {
    var x0 = xOf(parseISO(item.start_date));
    var x1 = xOf(addDays(parseISO(item.end_date), 1));
    return { x: x0, w: Math.max(2, x1 - x0) };
  }
  var justDraggedBar = false;

  chartEl.addEventListener("mousemove", function (e) {
    if (panDragging) return;
    var barGroup = e.target.closest(".gantt-bar");
    if (!barGroup) return;
    barGroup.style.cursor = hitMode(barGroup, e.clientX) === "move" ? "grab" : "ew-resize";
  });

  chartEl.addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    var barGroup = e.target.closest(".gantt-bar");
    if (!barGroup) { startPan(e); return; }
    e.preventDefault();
    var itemId = Number(barGroup.dataset.itemId);
    var item = D.items.filter(function (it) { return it.id === itemId; })[0];
    if (!item) return;
    var mode = hitMode(barGroup, e.clientX);
    var bbox = barGroup.querySelector("path").getBBox();
    var svgEl = chartEl.querySelector("svg");
    var svgRect = svgEl.getBoundingClientRect();
    function toSvgX(clientX) { return clientX - svgRect.left; }

    var startSvgX = toSvgX(e.clientX);
    var origStart = parseISO(item.start_date), origEnd = parseISO(item.end_date);
    var bounds = itemBoundsPx(item);
    var moved = false, pending = null;

    var ghost = document.createElementNS(SVGNS, "rect");
    ghost.setAttribute("class", "gantt-ghost");
    ghost.setAttribute("x", bounds.x); ghost.setAttribute("y", bbox.y);
    ghost.setAttribute("width", bounds.w); ghost.setAttribute("height", bbox.height);
    ghost.setAttribute("rx", 4);
    svgEl.appendChild(ghost);
    var label = document.createElementNS(SVGNS, "text");
    label.setAttribute("class", "gantt-ghost-label");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-family", FONT_MONO); label.setAttribute("font-size", "10");
    label.setAttribute("fill", COL_INK);
    svgEl.appendChild(label);

    function updateGhost(newStart, newEnd) {
      var gx = xOf(newStart), gw = Math.max(dayW, xOf(addDays(newEnd, 1)) - gx);
      ghost.setAttribute("x", gx); ghost.setAttribute("width", gw);
      label.setAttribute("x", gx + gw / 2); label.setAttribute("y", bbox.y - 6);
      label.textContent = fmtDisplayDate(newStart) + " – " + fmtDisplayDate(newEnd);
    }
    updateGhost(origStart, origEnd);

    function onMove(e2) {
      var dx = toSvgX(e2.clientX) - startSvgX;
      if (Math.abs(dx) > 3) moved = true;
      var deltaDays = Math.round(dx / dayW);
      var newStart = origStart, newEnd = origEnd;
      if (mode === "move") { newStart = addDays(origStart, deltaDays); newEnd = addDays(origEnd, deltaDays); }
      else if (mode === "resize-start") { newStart = addDays(origStart, deltaDays); if (newStart > newEnd) newStart = newEnd; }
      else if (mode === "resize-end") { newEnd = addDays(origEnd, deltaDays); if (newEnd < newStart) newEnd = newStart; }
      updateGhost(newStart, newEnd);
      pending = { start: newStart, end: newEnd };
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      ghost.remove(); label.remove();
      if (moved && pending) {
        justDraggedBar = true;
        setTimeout(function () { justDraggedBar = false; }, 0);
        api("/api/gantt/" + itemId, { start_date: toISO(pending.start), end_date: toISO(pending.end) }).then(function (r) {
          if (r) { D.items = D.items.filter(function (it) { return it.id !== r.item.id; }); D.items.push(r.item); }
          refresh();
        });
      }
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  // ---- resizable sidebar width -------------------------------------------
  var LS_SIDEBAR_W = "arckanban-gantt-sidebar-w";
  (function initSidebarWidth() {
    var saved = null;
    try { saved = parseInt(localStorage.getItem(LS_SIDEBAR_W), 10); } catch (e) {}
    if (saved && sidebarEl) sidebarEl.style.flexBasis = Math.max(240, Math.min(640, saved)) + "px";
  })();
  if (resizeHandle && sidebarEl) {
    var rsStartX, rsStartW, rsDragging = false;
    resizeHandle.addEventListener("mousedown", function (e) {
      rsDragging = true; rsStartX = e.clientX; rsStartW = sidebarEl.getBoundingClientRect().width;
      document.addEventListener("mousemove", onResizeMove);
      document.addEventListener("mouseup", onResizeUp);
      e.preventDefault();
    });
    function onResizeMove(e) {
      if (!rsDragging) return;
      sidebarEl.style.flexBasis = Math.max(240, Math.min(640, rsStartW + (e.clientX - rsStartX))) + "px";
    }
    function onResizeUp() {
      if (!rsDragging) return;
      rsDragging = false;
      document.removeEventListener("mousemove", onResizeMove);
      document.removeEventListener("mouseup", onResizeUp);
      try { localStorage.setItem(LS_SIDEBAR_W, Math.round(sidebarEl.getBoundingClientRect().width)); } catch (e) {}
    }
  }

  // ---- settings popup (cog): bar shape + live preview ---------------------
  var settingsPop = document.getElementById("gantt-settings-pop");
  var shapeSelect = document.getElementById("gantt-shape-select");
  var shapePreview = document.getElementById("gantt-shape-preview");

  function renderShapePreview() {
    if (!shapePreview) return;
    var w = 140, h = 30;
    shapePreview.innerHTML = '<svg xmlns="' + SVGNS + '" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<path d="' + barPath(6, 6, w - 12, h - 12, D.shape) + '" fill="' + COL_BLUE + '"></path></svg>';
  }
  function closeSettingsPop() { if (settingsPop) settingsPop.hidden = true; }
  function toggleSettingsPop() { if (settingsPop) settingsPop.hidden = !settingsPop.hidden; }

  if (shapeSelect) {
    shapeSelect.addEventListener("change", async function () {
      var shape = shapeSelect.value, prev = D.shape;
      var r = await api("/api/projects/" + D.projectId + "/gantt/settings", { shape: shape });
      if (!r) { shapeSelect.value = prev; return; }
      D.shape = r.shape;
      renderShapePreview();
      renderChart();
    });
  }

  // ---- item editor (start / end / duration / colour) ----------------------
  var itemModal = document.getElementById("item-modal");
  var itemStart = document.getElementById("item-start");
  var itemEnd = document.getElementById("item-end");
  var itemDuration = document.getElementById("item-duration");
  var itemColour = document.getElementById("item-colour");
  var itemDelete = document.getElementById("item-delete");
  var itemSectionName = document.getElementById("item-section-name");
  var editingSectionId = null, editingItemId = null;

  function openItemEditor(sectionId) {
    var section = sectionsById[sectionId];
    if (!section || !itemModal) return;
    editingSectionId = sectionId;
    var item = itemForSection(sectionId);
    editingItemId = item ? item.id : null;
    if (itemSectionName) itemSectionName.textContent = section.title;
    var start = item ? parseISO(item.start_date) : new Date();
    var end = item ? parseISO(item.end_date) : addDays(start, 6);
    itemStart.value = toISO(start);
    itemEnd.value = toISO(end);
    itemDuration.value = workingDaysBetween(start, end);
    itemColour.value = item ? item.colour : "#5B8DEF";
    if (itemDelete) itemDelete.hidden = !item;
    itemModal.hidden = false;
  }
  function closeItemEditor() { if (itemModal) itemModal.hidden = true; editingSectionId = null; editingItemId = null; }

  if (itemStart) itemStart.addEventListener("change", function () {
    var s = parseISO(itemStart.value);
    var dur = parseInt(itemDuration.value, 10);
    if (!isNaN(dur) && dur > 0) itemEnd.value = toISO(addWorkingDays(s, dur));
  });
  if (itemEnd) itemEnd.addEventListener("change", function () {
    var s = parseISO(itemStart.value), e = parseISO(itemEnd.value);
    if (e < s) { itemEnd.value = itemStart.value; e = s; }
    itemDuration.value = workingDaysBetween(s, e);
  });
  if (itemDuration) itemDuration.addEventListener("input", function () {
    var s = parseISO(itemStart.value), dur = parseInt(itemDuration.value, 10);
    if (!isNaN(dur) && dur > 0) itemEnd.value = toISO(addWorkingDays(s, dur));
  });

  async function saveItem() {
    if (!editingSectionId) return;
    var start = itemStart.value, end = itemEnd.value, colour = itemColour.value;
    if (!start || !end) { alert("Pick a start and end date."); return; }
    var body = { start_date: start, end_date: end, colour: colour };
    var r = editingItemId ? await api("/api/gantt/" + editingItemId, body)
                          : await api("/api/projects/" + D.projectId + "/gantt", (function () { body.section_id = editingSectionId; return body; })());
    if (!r) return;
    var item = r.item;
    D.items = D.items.filter(function (it) { return it.id !== item.id; });
    D.items.push(item);
    D.scheduledIds.add(editingSectionId);
    ensureRangeVisible(parseISO(item.start_date), parseISO(item.end_date));
    closeItemEditor();
    refresh();
  }
  async function deleteItem() {
    if (!editingItemId) return;
    var r = await api("/api/gantt/" + editingItemId + "/delete", {});
    if (!r) return;
    var sid = editingSectionId;
    D.items = D.items.filter(function (it) { return it.id !== editingItemId; });
    D.scheduledIds.delete(sid);
    closeItemEditor();
    refresh();
  }

  // ---- holiday editor -------------------------------------------------------
  var holidayModal = document.getElementById("holiday-modal");
  var holidayLabel = document.getElementById("holiday-label");
  var holidayStart = document.getElementById("holiday-start");
  var holidayEnd = document.getElementById("holiday-end");
  var holidayDelete = document.getElementById("holiday-delete");
  var editingHolidayId = null;

  function openHolidayEditor(holiday) {
    if (!holidayModal) return;
    editingHolidayId = holiday ? holiday.id : null;
    holidayLabel.value = holiday ? holiday.label : "Holiday";
    var start = holiday ? parseISO(holiday.start_date) : new Date();
    var end = holiday ? parseISO(holiday.end_date) : addDays(start, 6);
    holidayStart.value = toISO(start);
    holidayEnd.value = toISO(end);
    if (holidayDelete) holidayDelete.hidden = !holiday;
    holidayModal.hidden = false;
  }
  function closeHolidayEditor() { if (holidayModal) holidayModal.hidden = true; editingHolidayId = null; }

  async function saveHoliday() {
    var label = holidayLabel.value, start = holidayStart.value, end = holidayEnd.value;
    if (!start || !end) { alert("Pick a start and end date."); return; }
    var body = { label: label, start_date: start, end_date: end };
    var r = editingHolidayId ? await api("/api/gantt/holidays/" + editingHolidayId, body)
                             : await api("/api/projects/" + D.projectId + "/gantt/holidays", body);
    if (!r) return;
    var h = r.holiday;
    D.holidays = D.holidays.filter(function (x) { return x.id !== h.id; });
    D.holidays.push(h);
    ensureRangeVisible(parseISO(h.start_date), parseISO(h.end_date));
    closeHolidayEditor();
    refresh();
  }
  async function deleteHoliday() {
    if (!editingHolidayId) return;
    var r = await api("/api/gantt/holidays/" + editingHolidayId + "/delete", {});
    if (!r) return;
    var hid = editingHolidayId;
    D.holidays = D.holidays.filter(function (x) { return x.id !== hid; });
    closeHolidayEditor();
    refresh();
  }

  // ---- add a new section of work (bottom of the sidebar list) ------------
  var addForm = document.getElementById("gantt-add-row");
  var addTitleInput = document.getElementById("gantt-add-title");
  if (addForm) {
    addForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      var title = (addTitleInput.value || "").trim();
      if (!title) return;
      var stage = view === "all" ? currentStage : view;
      var r = await api("/api/projects/" + D.projectId + "/sections", { title: title, stage: stage });
      if (!r) return;
      var sec = r.section;
      var entry = { id: sec.id, title: sec.title, stage: sec.stage, substage: sec.substage || 0 };
      D.allSections.push(entry);
      sectionsById[sec.id] = entry;
      addTitleInput.value = "";
      addTitleInput.focus();
      renderSidebar();
    });
  }

  // ---- clicks: rows, bars, holidays, popup, modal actions, pager ----------
  document.addEventListener("click", function (e) {
    var bar = e.target.closest(".gantt-bar");
    if (bar) { if (justDraggedBar) return; openItemEditor(Number(bar.dataset.sectionId)); return; }
    var hol = e.target.closest("[data-holiday-id]");
    if (hol) {
      var matches = D.holidays.filter(function (x) { return String(x.id) === hol.dataset.holidayId; });
      if (matches.length) openHolidayEditor(matches[0]);
      return;
    }
    var rowLabel = e.target.closest(".gantt-row-label");
    if (rowLabel) { openItemEditor(Number(rowLabel.dataset.sectionId)); return; }

    var trigger = e.target.closest('[data-action="gantt-settings"]');
    if (trigger) { toggleSettingsPop(); return; }
    if (!e.target.closest("#gantt-settings-pop")) closeSettingsPop();

    var el = e.target.closest("[data-action]");
    if (!el) return;
    switch (el.dataset.action) {
      case "add-holiday": openHolidayEditor(null); break;
      case "holiday-cancel": closeHolidayEditor(); break;
      case "holiday-save": saveHoliday(); break;
      case "holiday-delete": deleteHoliday(); break;
      case "item-cancel": closeItemEditor(); break;
      case "item-save": saveItem(); break;
      case "item-delete": deleteItem(); break;
      case "gantt-prev": goStage(nextEnabledStage(view === "all" ? lastStage : view, -1)); break;
      case "gantt-next": goStage(nextEnabledStage(view === "all" ? lastStage : view, +1)); break;
      case "gantt-toggle-all": toggleAllStages(); break;
      case "gantt-zoom-in": setZoom(zoomIdx + 1); break;
      case "gantt-zoom-out": setZoom(zoomIdx - 1); break;
      case "gantt-zoom-fit": zoomToFit(); break;
    }
  });
  if (itemModal) itemModal.addEventListener("click", function (e) { if (e.target === itemModal) closeItemEditor(); });
  if (holidayModal) holidayModal.addEventListener("click", function (e) { if (e.target === holidayModal) closeHolidayEditor(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { closeItemEditor(); closeHolidayEditor(); closeSettingsPop(); }
    if (e.target.matches("input, textarea, select")) return;
    if (e.key === "ArrowLeft") goStage(nextEnabledStage(view === "all" ? lastStage : view, -1));
    else if (e.key === "ArrowRight") goStage(nextEnabledStage(view === "all" ? lastStage : view, +1));
  });

  // ---- init ----------------------------------------------------------------
  var initialRange = computeDefaultRange();
  viewStart = initialRange.start; viewEnd = initialRange.end;
  renderShapePreview();
  applyStagePager();
})();
