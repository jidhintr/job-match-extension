import { state } from "../state/store.js";
import { createStatusLine } from "../ui/statusLine.js";
import { el, svg, createChartTooltip } from "../ui/chartKit.js";
import { ensureTrackerItems, enabledStatuses, colorForStatus, trackerSourceLabel } from "./tracker.js";
import {
  headline,
  pipelineByStatus,
  activityOverTime,
  scoreBands,
  scoreScatter,
  topMissingSkills,
  topTitles,
  topCompanies,
  withinRange
} from "./kpiMetrics.js";
import {
  kpiView,
  kpiRangeSelect,
  refreshKpiBtn,
  kpiGmailBtn,
  kpiStatusLine,
  kpiBody,
  kpiEmptyState
} from "../ui/dom.js";

const setKpiStatus = createStatusLine(kpiStatusLine);
const { interactive } = createChartTooltip(kpiView);

function section(title, subtitle) {
  const card = el("div", "kpi-section");
  const head = el("div", "kpi-section-head");
  head.appendChild(el("div", "kpi-section-title", title));
  if (subtitle) head.appendChild(el("div", "kpi-section-note", subtitle));
  card.appendChild(head);
  return card;
}

function goToTracker(detail) {
  window.dispatchEvent(new CustomEvent("app:navigate", { detail: { tab: "tracker", ...detail } }));
}

function renderHeadline(stats) {
  const grid = el("div", "kpi-tile-grid");
  const tiles = [
    { label: "Tracked jobs", value: String(stats.total), tone: "accent" },
    { label: "Companies", value: String(stats.companies), tone: "violet" },
    { label: "Avg ATS", value: stats.avgAts == null ? "—" : `${stats.avgAts}%`, tone: toneFor(stats.avgAts) },
    { label: "Avg chance", value: stats.avgChance == null ? "—" : `${stats.avgChance}%`, tone: toneFor(stats.avgChance) },
    { label: "Applications / week", value: String(stats.perWeek), tone: "accent" }
  ];
  tiles.forEach(({ label, value, tone }) => {
    const tile = el("div", `kpi-tile tone-${tone}`);
    tile.append(el("div", "kpi-tile-value", value), el("div", "kpi-tile-label", label));
    grid.appendChild(tile);
  });
  return grid;
}

function toneFor(score) {
  if (score == null) return "muted";
  if (score > 75) return "green";
  if (score >= 50) return "yellow";
  return "red";
}

function donutSlice(cx, cy, r, width, startFrac, endFrac, color) {
  const circumference = 2 * Math.PI * r;
  const dash = (endFrac - startFrac) * circumference;
  const circle = svg("circle", {
    cx,
    cy,
    r,
    fill: "none",
    stroke: color,
    "stroke-width": width,
    "stroke-dasharray": `${dash} ${circumference - dash}`,
    "stroke-dashoffset": -startFrac * circumference,
    transform: `rotate(-90 ${cx} ${cy})`
  });
  circle.classList.add("kpi-donut-slice");
  return circle;
}

function polar(cx, cy, r, degrees) {
  const rad = ((degrees - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function sectorPath(cx, cy, inner, outer, startDeg, endDeg) {
  const [ox1, oy1] = polar(cx, cy, outer, startDeg);
  const [ox2, oy2] = polar(cx, cy, outer, endDeg);
  const [ix1, iy1] = polar(cx, cy, inner, endDeg);
  const [ix2, iy2] = polar(cx, cy, inner, startDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${ox1} ${oy1} A ${outer} ${outer} 0 ${large} 1 ${ox2} ${oy2} L ${ix1} ${iy1} A ${inner} ${inner} 0 ${large} 0 ${ix2} ${iy2} Z`;
}

function renderPipeline(rows, total) {
  const card = section("Pipeline", "Hover a slice, click to open it in Tracker");
  const wrap = el("div", "kpi-donut-wrap");

  const chart = svg("svg", { viewBox: "0 0 120 120", class: "kpi-donut" });

  const centerValue = svg("text", { x: 60, y: 58, "text-anchor": "middle", class: "kpi-donut-center-value" });
  centerValue.textContent = String(total);
  const centerLabel = svg("text", { x: 60, y: 72, "text-anchor": "middle", class: "kpi-donut-center-label" });
  centerLabel.textContent = "jobs";

  const legend = el("div", "kpi-donut-legend");
  const slices = [];
  let cursor = 0;

  rows.forEach((row) => {
    const entry = el("div", "kpi-legend-row");
    const dot = el("span", "kpi-legend-dot");
    dot.style.backgroundColor = colorForStatus(row.status);
    entry.append(dot, el("span", "kpi-legend-text", row.status), el("span", "kpi-legend-value", `${row.count} · ${row.pct}%`));
    legend.appendChild(entry);

    let slice = null;
    if (row.count > 0) {
      const frac = row.count / total;
      slice = donutSlice(60, 60, 42, 18, cursor, cursor + frac, colorForStatus(row.status));
      chart.appendChild(slice);
      cursor += frac;
      slices.push(slice);
    }

    const config = {
      title: row.status,
      rows: [
        `${row.count} of ${total} jobs · ${row.pct}%`,
        row.avgAts == null ? null : `Average ATS ${row.avgAts}%`
      ],
      hint: row.count > 0 ? "Click to filter the Tracker" : "No jobs at this stage",
      onClick: row.count > 0 ? () => goToTracker({ status: row.status }) : null
    };

    if (slice) {
      interactive(slice, { ...config, peers: [entry] });
      entry.addEventListener("mouseenter", () => slice.classList.add("is-active"));
      entry.addEventListener("mouseleave", () => slice.classList.remove("is-active"));
    }
    interactive(entry, config);
  });

  chart.addEventListener("mouseleave", () => slices.forEach((s) => s.classList.remove("is-active")));
  chart.append(centerValue, centerLabel);

  wrap.append(chart, legend);
  card.appendChild(wrap);
  return card;
}

function renderActivity(buckets, byDay) {
  const card = section("Activity", byDay ? "Jobs saved per day" : "Jobs saved per week");
  const max = Math.max(...buckets.map((b) => b.count), 1);
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  const chart = el("div", "kpi-column-chart");

  buckets.forEach((b) => {
    const col = el("div", "kpi-column");
    if (b.count === 0) col.classList.add("is-empty");

    const barWrap = el("div", "kpi-column-bar-wrap");
    const bar = el("div", "kpi-column-bar");
    bar.style.height = `${Math.max(3, Math.round((b.count / max) * 100))}%`;
    barWrap.appendChild(bar);

    col.append(el("div", "kpi-column-count", b.count > 0 ? String(b.count) : ""), barWrap, el("div", "kpi-column-label", b.label));

    interactive(col, {
      title: byDay ? b.full : `Week of ${b.full}`,
      rows: [
        `${b.count} job${b.count === 1 ? "" : "s"} saved`,
        total > 0 ? `${Math.round((b.count / total) * 100)}% of this period` : null,
        b.count === max && max > 0 ? "Busiest in this range" : null
      ]
    });

    chart.appendChild(col);
  });

  card.appendChild(chart);
  return card;
}

function renderBandRow(title, bands, field) {
  const wrap = el("div", "kpi-band-group");
  wrap.appendChild(el("div", "kpi-band-title", title));

  const scored = bands.reduce((sum, b) => sum + b.count, 0);
  const stack = el("div", "kpi-stack");
  const segments = new Map();

  bands.forEach((band) => {
    if (band.pct === 0) return;
    const seg = el("div", "kpi-stack-seg", band.pct >= 18 ? `${band.pct}%` : "");
    seg.style.width = `${band.pct}%`;
    seg.style.backgroundColor = `var(${band.colorVar})`;
    stack.appendChild(seg);
    segments.set(band.label, seg);
  });
  wrap.appendChild(stack);

  const legend = el("div", "kpi-legend");
  bands.forEach((band) => {
    const entry = el("span", "kpi-legend-item");
    const dot = el("span", "kpi-legend-dot");
    dot.style.backgroundColor = `var(${band.colorVar})`;
    entry.append(dot, el("span", null, `${band.label} — ${band.count}`));
    legend.appendChild(entry);

    const seg = segments.get(band.label);
    const config = {
      title: `${field} — ${band.label}`,
      rows: [
        `${band.count} of ${scored} scored job${scored === 1 ? "" : "s"}`,
        `${band.pct}% of this range`,
        `Score range ${band.min}–${band.max}%`
      ]
    };
    if (seg) interactive(seg, { ...config, peers: [entry] });
    interactive(entry, { ...config, peers: seg ? [seg] : [] });
  });
  wrap.appendChild(legend);

  return wrap;
}

function renderScatter(points) {
  const card = section("Match quality map", "ATS score vs recruiter chance");
  if (points.length === 0) {
    card.appendChild(el("p", "kpi-muted", "No scored jobs in this range."));
    return card;
  }

  const chart = svg("svg", { viewBox: "0 0 220 160", class: "kpi-scatter" });

  chart.appendChild(svg("rect", { x: 130, y: 20, width: 70, height: 60, class: "kpi-scatter-zone strong" }));
  chart.appendChild(svg("rect", { x: 30, y: 80, width: 100, height: 60, class: "kpi-scatter-zone weak" }));

  [0, 25, 50, 75, 100].forEach((v) => {
    const x = 30 + (v / 100) * 170;
    const y = 140 - (v / 100) * 120;
    chart.appendChild(svg("line", { x1: 30, y1: y, x2: 200, y2: y, class: "kpi-scatter-grid" }));
    chart.appendChild(svg("line", { x1: x, y1: 20, x2: x, y2: 140, class: "kpi-scatter-grid" }));
  });

  chart.appendChild(svg("line", { x1: 30, y1: 140, x2: 200, y2: 140, class: "kpi-scatter-axis" }));
  chart.appendChild(svg("line", { x1: 30, y1: 20, x2: 30, y2: 140, class: "kpi-scatter-axis" }));

  points.forEach((p) => {
    const dot = svg("circle", {
      cx: 30 + (p.ats / 100) * 170,
      cy: 140 - (p.chance / 100) * 120,
      r: 4,
      fill: colorForStatus(p.status),
      class: "kpi-scatter-dot"
    });
    interactive(dot, {
      title: p.label,
      rows: [`ATS ${p.ats}% · Chance ${p.chance}%`, `Status: ${p.status}`],
      hint: "Click to find it in Tracker",
      onClick: () => goToTracker({ search: p.company })
    });
    chart.appendChild(dot);
  });

  const xLabel = svg("text", { x: 115, y: 155, "text-anchor": "middle", class: "kpi-axis-label" });
  xLabel.textContent = "ATS score →";
  const yLabel = svg("text", { x: 12, y: 80, "text-anchor": "middle", transform: "rotate(-90 12 80)", class: "kpi-axis-label" });
  yLabel.textContent = "Chance →";
  chart.append(xLabel, yLabel);

  card.appendChild(chart);
  return card;
}

function renderScoreQuality(items) {
  const card = section("Score spread", "Are you applying to roles you actually match?");
  card.append(
    renderBandRow("ATS score", scoreBands(items, "atsScore"), "ATS score"),
    renderBandRow("Chance", scoreBands(items, "interviewChance"), "Chance")
  );
  return card;
}

const TITLE_PALETTE = ["#a78bfa", "#38bdf8", "#fbbf24", "#4ade80", "#fb7185", "#22d3ee"];

function renderTitleRose(entries, total) {
  const card = section("Roles you chase", "Hover a petal, click to open it in Tracker");
  if (entries.length === 0) {
    card.appendChild(el("p", "kpi-muted", "No job titles recorded yet."));
    return card;
  }

  const chart = svg("svg", { viewBox: "0 0 200 200", class: "kpi-rose" });
  const max = entries[0].count;
  const step = 360 / entries.length;
  const gap = entries.length > 1 ? 3 : 0;

  [34, 58, 82].forEach((r) => chart.appendChild(svg("circle", { cx: 100, cy: 100, r, class: "kpi-rose-grid" })));

  const legend = el("div", "kpi-rose-legend");

  entries.forEach((entry, i) => {
    const color = TITLE_PALETTE[i % TITLE_PALETTE.length];
    const outer = 34 + (entry.count / max) * 52;
    const petal = svg("path", {
      d: sectorPath(100, 100, 14, outer, i * step + gap / 2, (i + 1) * step - gap / 2),
      fill: color,
      class: "kpi-rose-petal"
    });

    const legendRow = el("div", "kpi-legend-row");
    const dot = el("span", "kpi-legend-dot");
    dot.style.backgroundColor = color;
    legendRow.append(dot, el("span", "kpi-legend-text", entry.label), el("span", "kpi-legend-value", String(entry.count)));

    const config = {
      title: entry.label,
      rows: [
        `${entry.count} application${entry.count === 1 ? "" : "s"}`,
        `${Math.round((entry.count / total) * 100)}% of tracked jobs in range`,
        `Ranked #${i + 1} of ${entries.length}`
      ],
      hint: "Click to open it in Tracker",
      onClick: () => goToTracker({ search: entry.label })
    };

    interactive(petal, { ...config, peers: [legendRow] });
    interactive(legendRow, { ...config, peers: [petal] });

    chart.appendChild(petal);
    legend.appendChild(legendRow);
  });

  chart.appendChild(svg("circle", { cx: 100, cy: 100, r: 12, class: "kpi-rose-hub" }));

  const wrap = el("div", "kpi-rose-wrap");
  wrap.append(chart, legend);
  card.appendChild(wrap);
  return card;
}

function renderFrequencyList(title, subtitle, entries, emptyText, options = {}) {
  const card = section(title, subtitle);
  if (entries.length === 0) {
    card.appendChild(el("p", "kpi-muted", emptyText));
    return card;
  }

  const { accent, total, unit, searchable } = options;
  const max = entries[0].count;

  entries.forEach((entry, i) => {
    const line = el("div", "kpi-bar-row");
    const head = el("div", "kpi-bar-head");
    head.append(el("span", "kpi-bar-label", entry.label), el("span", "kpi-bar-value", String(entry.count)));

    const track = el("div", "kpi-bar-track");
    const fill = el("div", "kpi-bar-fill");
    fill.style.width = `${Math.round((entry.count / max) * 100)}%`;
    fill.style.opacity = String(1 - i * 0.07);
    if (accent) fill.style.background = accent;
    track.appendChild(fill);

    line.append(head, track);

    interactive(line, {
      title: entry.label,
      rows: [
        `${entry.count} ${unit}${entry.count === 1 ? "" : "s"}`,
        total ? `${Math.round((entry.count / total) * 100)}% of tracked jobs in range` : null,
        `Ranked #${i + 1}`
      ],
      hint: searchable ? "Click to find it in Tracker" : null,
      onClick: searchable ? () => goToTracker({ search: entry.label }) : null
    });

    card.appendChild(line);
  });
  return card;
}

function renderKpi() {
  const all = state.tracker.items;
  kpiEmptyState.classList.toggle("hidden", all.length > 0);
  kpiBody.innerHTML = "";
  if (all.length === 0) return;

  const items = all.filter((it) => withinRange(it, state.kpi.range));
  if (items.length === 0) {
    kpiBody.appendChild(el("p", "kpi-muted", "No tracked jobs fall in this date range."));
    return;
  }

  const statusOrder = enabledStatuses();

  kpiBody.append(
    renderHeadline(headline(items)),
    renderPipeline(pipelineByStatus(items, statusOrder), items.length),
    renderActivity(activityOverTime(items, state.kpi.range), Number(state.kpi.range) <= 14),
    renderScatter(scoreScatter(items)),
    renderScoreQuality(items),
    renderFrequencyList(
      "Top missing skills",
      "Skills costing you the most opportunities",
      topMissingSkills(items),
      "No missing skills recorded yet.",
      { accent: "linear-gradient(90deg, var(--red), var(--yellow))", total: items.length, unit: "job" }
    ),
    renderTitleRose(topTitles(items), items.length),
    renderFrequencyList("Most applied companies", "Click a company to open it in Tracker", topCompanies(items), "No company names recorded yet.", {
      total: items.length,
      unit: "job",
      searchable: true
    })
  );
}

async function loadKpiData({ force = false } = {}) {
  if (state.tracker.loaded && !force) {
    renderKpi();
    setKpiStatus(`Analysing ${state.tracker.items.length} tracked jobs.${trackerSourceLabel()}`, "ok");
    return;
  }

  refreshKpiBtn.disabled = true;
  if (force) setKpiStatus("Refreshing from Google Sheets...");

  try {
    const items = await ensureTrackerItems({ force });
    renderKpi();
    setKpiStatus(`Analysing ${items.length} tracked job${items.length === 1 ? "" : "s"}.${trackerSourceLabel()}`, "ok");
  } catch (err) {
    console.error(err);
    setKpiStatus(err.message || "Could not load from Sheets.", "err");
  } finally {
    refreshKpiBtn.disabled = false;
  }
}

export function refreshKpiTab() {
  loadKpiData({ force: false });
}

export function renderKpiIfLoaded() {
  if (state.tracker.loaded) renderKpi();
}

window.addEventListener("tracker:updated", renderKpiIfLoaded);

kpiRangeSelect.addEventListener("change", () => {
  state.kpi.range = kpiRangeSelect.value;
  renderKpi();
});

refreshKpiBtn.addEventListener("click", () => loadKpiData({ force: true }));

kpiGmailBtn.addEventListener("click", () => {
  setKpiStatus("Gmail cross-check is not wired up yet — coming in phase 2.");
});
