"use strict";

const byId = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]));
const percent = (value) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const policyRoster = ["InternW0-Delta", "DeepSeek-Flash", "VPP2", "Simate-beta"];
const untestedCell = '<span class="untested">Untested</span>';
const policyColors = {"InternW0-Delta":"#166855", "DeepSeek-Flash":"#4269a9",
  "VPP2":"#b16b2b", "Simate-beta":"#8052a0", "Awomo0.5":"#9a6478"};
let currentMetric = byId("sr-tab").getAttribute("aria-selected") === "true" ? "sr" : "score";
let currentCost = byId("latency-button").getAttribute("aria-pressed") === "true" ? "latency" : "rollout";
let chartCandidates = [];
let inferenceMachines = {};

function chartData(candidates, tasks, runs) {
  return candidates.map((candidate) => {
    const selected = tasks.map((task) => runs.get(candidate.tasks[task.id])).filter((run) => run?.complete);
    if (!selected.length) return null;
    const measuredFrames = selected.filter((run) => Number.isFinite(run.rollout_frames));
    const rollout = measuredFrames.length ? measuredFrames.reduce((sum, run) =>
      sum + run.rollout_frames, 0) / measuredFrames.length : null;
    const timed = selected.filter((run) => Number.isFinite(run.inference_latency_s) &&
      Number.isInteger(run.inference_latency_calls) && run.inference_latency_calls > 0);
    const latencyReady = timed.length && timed.every((run) =>
      run.inference_latency_source === timed[0].inference_latency_source);
    const latency = latencyReady ? timed.reduce((sum, run) =>
      sum + run.inference_latency_s, 0) / timed.length : null;
    return {label: candidate.policy_label,
      sr: selected.reduce((sum, run) => sum + run.success_rate, 0) / selected.length,
      score: selected.reduce((sum, run) => sum + run.score, 0) / selected.length,
      latency, rollout};
  }).filter(Boolean);
}

function renderFrontier() {
  const points = chartCandidates.map((candidate) => ({...candidate,
    x: candidate[currentCost], y: candidate[currentMetric]})).filter((point) =>
    Number.isFinite(point.x) && Number.isFinite(point.y) && point.y >= 0 && point.y <= 1);
  const chart = byId("frontier-chart");
  const legend = byId("chart-legend");
  const costLabel = currentCost === "latency" ? "Inference latency (s / action request)" :
    "Average rollout length (control frames / task)";
  const metricLabel = currentMetric === "sr" ? "SR" : "Score";
  chart.setAttribute("aria-label", `${metricLabel} versus ${costLabel}. ${points.length} measured policies.`);
  if (!points.length) {
    chart.innerHTML = '<p class="chart-empty">No policies have measurements for this view yet.</p>';
    legend.innerHTML = "";
    return;
  }

  const frontier = points.filter((point) => !points.some((other) => other !== point &&
    other.x <= point.x && other.y >= point.y && (other.x < point.x || other.y > point.y)))
    .sort((left, right) => left.x - right.x || left.y - right.y);
  const width = 860, height = 430, left = 82, right = 32, top = 24, bottom = 75;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const values = points.map((point) => point.x);
  const logarithmic = currentCost === "latency" && values.every((value) => value > 0);
  let xMin, xMax, ticks;
  if (logarithmic) {
    xMin = Math.min(...values) * 0.8;
    xMax = Math.max(...values) * 1.25;
    ticks = [];
    for (let power = Math.floor(Math.log10(xMin)); power <= Math.ceil(Math.log10(xMax)); power++) {
      for (const multiple of [1, 2, 5]) {
        const tick = multiple * 10 ** power;
        if (tick >= xMin && tick <= xMax) ticks.push(tick);
      }
    }
  } else {
    const minimum = Math.min(...values), maximum = Math.max(...values);
    const span = Math.max(maximum - minimum, maximum * 0.1, 1);
    const magnitude = 10 ** Math.floor(Math.log10(span / 4));
    const step = [1, 2, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= span / 4);
    xMin = Math.max(0, Math.floor((minimum - span * 0.1) / step) * step);
    xMax = Math.ceil((maximum + span * 0.1) / step) * step;
    if (xMax === xMin) xMax += step;
    ticks = Array.from({length: Math.floor((xMax - xMin) / step) + 1}, (_, index) => xMin + index * step);
  }
  const xPosition = (value) => left + (logarithmic ?
    (Math.log(value) - Math.log(xMin)) / (Math.log(xMax) - Math.log(xMin)) :
    (value - xMin) / (xMax - xMin)) * plotWidth;
  const yPosition = (value) => top + (1 - value) * plotHeight;
  const xText = (value) => currentCost === "latency" ? `${Number(value.toPrecision(2))}` :
    Math.round(value).toLocaleString("en-US");
  const valueText = (point) => currentCost === "latency" ? `${point.x.toFixed(2)} s` :
    `${Math.round(point.x).toLocaleString("en-US")} frames / task`;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((value) =>
    `<line x1="${left}" x2="${width - right}" y1="${yPosition(value)}" y2="${yPosition(value)}" class="grid-line"/><text x="${left - 13}" y="${yPosition(value) + 4}" text-anchor="end" class="axis-tick">${Math.round(value * 100)}</text>`).join("");
  const xTicks = ticks.map((value) =>
    `<line x1="${xPosition(value)}" x2="${xPosition(value)}" y1="${height - bottom}" y2="${height - bottom + 6}" class="axis-line"/><text x="${xPosition(value)}" y="${height - bottom + 23}" text-anchor="middle" class="axis-tick">${xText(value)}</text>`).join("");
  const path = frontier.map((point, index) => `${index ? "L" : "M"}${xPosition(point.x).toFixed(1)},${yPosition(point.y).toFixed(1)}`).join(" ");
  const circles = points.map((point) => {
    const color = policyColors[point.label] || "#455e6a";
    const onFrontier = frontier.includes(point);
    return `<circle cx="${xPosition(point.x).toFixed(1)}" cy="${yPosition(point.y).toFixed(1)}" r="${onFrontier ? 8 : 7}" fill="${color}" stroke="white" class="${onFrontier ? "frontier-point" : "dominated-point"}"><title>${escapeHtml(point.label)}: ${valueText(point)}, ${metricLabel} ${percent(point.y)}; ${onFrontier ? "Pareto frontier" : "dominated"}</title></circle>`;
  }).join("");
  chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false"><g>${grid}${xTicks}<line x1="${left}" x2="${width - right}" y1="${height - bottom}" y2="${height - bottom}" class="axis-line"/><line x1="${left}" x2="${left}" y1="${top}" y2="${height - bottom}" class="axis-line"/><path d="${path}" class="frontier-line"/>${circles}<text x="${left + plotWidth / 2}" y="${height - 17}" text-anchor="middle" class="axis-label">${costLabel}</text><text x="19" y="${top + plotHeight / 2}" text-anchor="middle" transform="rotate(-90 19 ${top + plotHeight / 2})" class="axis-label">${metricLabel} (%)</text></g></svg>`;
  legend.innerHTML = points.map((point) => {
    const color = policyColors[point.label] || "#455e6a";
    const machine = inferenceMachines[point.label];
    return `<div class="legend-item"><span class="legend-dot" style="background:${color}"></span><span><strong>${escapeHtml(point.label)}</strong>${machine ? `<span class="legend-machine"> (${escapeHtml(machine)})</span>` : ""}<span class="legend-value">${valueText(point)} · ${metricLabel} ${percent(point.y)}${frontier.includes(point) ? " · Frontier" : ""}</span></span></div>`;
  }).join("");
}

function metricCell(score, successRate, view) {
  const primary = view === "score" ? score : successRate;
  const secondary = view === "score" ? successRate : score;
  const label = view === "score" ? "SR" : "Score";
  return `<span class="score">${percent(primary)}</span><span class="subtext">${label} ${percent(secondary)}</span>`;
}

function observedMeans(candidate, tasks, runs) {
  const measured = tasks.map((task) => runs.get(candidate.tasks[task.id])).filter((run) => run?.complete);
  if (!measured.length) return {score: null, sr: null};
  return {
    score: measured.reduce((sum, run) => sum + run.score, 0) / measured.length,
    sr: measured.reduce((sum, run) => sum + run.success_rate, 0) / measured.length,
  };
}

function selectView(view) {
  currentMetric = view;
  for (const name of ["score", "sr"]) {
    const selected = name === view;
    byId(`${name}-tab`).setAttribute("aria-selected", String(selected));
    byId(`${name}-tab`).tabIndex = selected ? 0 : -1;
    byId(`${name}-panel`).hidden = !selected;
  }
  if (chartCandidates.length) renderFrontier();
}

function selectCost(cost) {
  currentCost = cost;
  for (const name of ["latency", "rollout"]) {
    byId(`${name}-button`).setAttribute("aria-pressed", String(name === cost));
  }
  renderFrontier();
}

function renderTable(view, candidates, tasks, runs, ranked) {
  const table = byId(`${view}-table`);
  const primary = (row) => view === "score" ? row.mean.score : row.mean.sr;
  const secondary = (row) => view === "score" ? row.mean.sr : row.mean.score;
  const sorted = candidates.map((candidate) => ({candidate, mean: observedMeans(candidate, tasks, runs)}))
    .sort((left, right) =>
      (primary(right) ?? -1) - (primary(left) ?? -1) ||
      (secondary(right) ?? -1) - (secondary(left) ?? -1) ||
      left.candidate.policy_label.localeCompare(right.candidate.policy_label));
  table.querySelector("thead").innerHTML = `<tr>${ranked ? '<th scope="col">Rank</th>' : ""}<th scope="col">Policy</th>${tasks.map((task) => `<th scope="col">${escapeHtml(task.label)}</th>`).join("")}<th scope="col">${view === "score" ? "Mean score" : "Mean SR"}</th></tr>`;
  table.querySelector("tbody").innerHTML = sorted.map(({candidate, mean}, index) => {
    const rankCell = ranked ? `<td>${mean.sr == null ? '<span class="unranked" aria-label="Unranked">—</span>' : index + 1}</td>` : "";
    const cells = tasks.map((task) => {
      const run = runs.get(candidate.tasks[task.id]);
      return run?.complete ? `<td>${metricCell(run.score, run.success_rate, view)}</td>` : `<td>${untestedCell}</td>`;
    }).join("");
    const meanCell = mean.sr == null ? untestedCell : metricCell(mean.score, mean.sr, view);
    const machine = inferenceMachines[candidate.policy_label];
    return `<tr>${rankCell}<td class="policy">${escapeHtml(candidate.policy_label)}${machine ? `<span class="policy-machine">${escapeHtml(machine)}</span>` : ""}</td>${cells}<td>${meanCell}</td></tr>`;
  }).join("");
}

function render(data) {
  if (data.schema_version !== 1 || !Array.isArray(data.candidates) || !data.benchmark?.tasks?.length) throw new Error("No evaluation results available.");
  const runs = new Map(data.runs.map((run) => [run.id, run]));
  const tasks = data.benchmark.tasks;
  const candidates = [...data.candidates];
  inferenceMachines = data.benchmark.inference_machines || {};
  for (const label of [...policyRoster, ...(data.benchmark.pending_policies || [])]) {
    if (!candidates.some((candidate) => candidate.policy_label === label)) {
      candidates.push({policy_label: label, official_score: null, mean_score: null,
        success_rate: null, tasks: {}});
    }
  }
  const ranked = data.benchmark.ranked;
  for (const view of ["score", "sr"]) renderTable(view, candidates, tasks, runs, ranked);
  chartCandidates = chartData(candidates, tasks, runs);
  renderFrontier();
  byId("status").hidden = true;
  byId("metric-switch").hidden = false;
  byId("app").hidden = false;
}

for (const cost of ["latency", "rollout"]) {
  byId(`${cost}-button`).addEventListener("click", () => selectCost(cost));
}

for (const view of ["score", "sr"]) {
  const tab = byId(`${view}-tab`);
  tab.addEventListener("click", () => selectView(view));
  tab.addEventListener("keydown", (event) => {
    const next = {ArrowLeft: view === "score" ? "sr" : "score",
                  ArrowRight: view === "score" ? "sr" : "score", Home: "sr", End: "score"}[event.key];
    if (!next) return;
    event.preventDefault();
    selectView(next);
    byId(`${next}-tab`).focus();
  });
}

fetch("data.json", {cache: "no-cache"}).then((response) => {
  if (!response.ok) throw new Error("Could not load evaluation results.");
  return response.json();
}).then(render).catch((error) => {
  byId("status").hidden = true;
  byId("error").hidden = false;
  byId("error").textContent = error.message;
});
