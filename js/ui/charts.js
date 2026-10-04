/**
 * Small SVG chart library (no dependencies).
 *
 * Views call chart(spec) while building HTML; it returns a placeholder and
 * keeps the spec. After the HTML is in the DOM, mountCharts() draws every
 * placeholder at its real width and redraws on resize, so text never
 * stretches. Every chart also gets a collapsible data table for screen-reader
 * and keyboard users.
 *
 * Types: bar (stacked or grouped), line, hbar, donut, heatmap.
 */
import { esc } from '../utils/dom.js';
import { fmtNumber } from '../utils/format.js';

const specs = new Map();
let seq = 0;
let ro = null;

export function chart(spec) {
  const id = `c${++seq}`;
  specs.set(id, spec);
  const table = spec.table ? `<details class="chart__table"><summary>Show data as a table</summary><div class="table-scroll">${dataTable(spec.table)}</div></details>` : '';
  const legend = spec.legend !== false && spec.series && spec.series.length > 1 && spec.type !== 'hbar'
    ? `<div class="chart__legend">${spec.series.map((s) => `<span class="legend-item"><span class="legend-swatch${s.dashed ? ' is-dashed' : ''}" style="--c:${s.color}"></span>${esc(s.name)}</span>`).join('')}</div>` : '';
  return `<figure class="chart chart--${spec.type}" ${spec.label ? `aria-label="${esc(spec.label)}"` : ''}>
    ${legend}<div class="chart__canvas" data-chart="${id}" style="height:${spec.height || 200}px" role="img" aria-label="${esc(spec.label || 'Chart')}"></div>${table}</figure>`;
}

function dataTable({ head, rows }) {
  return `<table class="data-table"><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join('')}</tr>`).join('')}</tbody></table>`;
}

export function mountCharts(root = document) {
  if (!ro && 'ResizeObserver' in window) {
    ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const el = e.target;
        const w = Math.round(e.contentRect.width);
        if (w && Number(el.dataset.w) !== w) drawEl(el, w);
      }
    });
  }
  for (const el of root.querySelectorAll('[data-chart]')) {
    if (el.dataset.mounted) continue;
    el.dataset.mounted = '1';
    drawEl(el, el.clientWidth);
    ro?.observe(el);
  }
  // forget specs whose elements are gone
  for (const id of specs.keys()) if (!document.querySelector(`[data-chart="${id}"]`)) specs.delete(id);
}

function drawEl(el, width) {
  const spec = specs.get(el.dataset.chart);
  if (!spec || !width) return;
  el.dataset.w = width;
  const h = spec.height || 200;
  try {
    el.innerHTML = DRAW[spec.type](spec, width, h);
  } catch (err) {
    console.error('[chart] draw failed', err);
    el.innerHTML = '<p class="muted">This chart could not be drawn.</p>';
  }
}

function scaleMax(v, unit) {
  if (unit === 'minutes') {
    const steps = v > 90 ? [60, 90, 120, 180, 240, 360, 480, 720, 1440] : [5, 10, 15, 20, 30];
    const step = steps.find((x) => x * 4 >= v) || steps[steps.length - 1];
    return Math.max(step * 4, 1);
  }
  if (v <= 20) return Math.max(4, Math.ceil(v / 4) * 4); // small counts: whole-number ticks
  return niceMax(v);
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}

function axisY(max, x0, x1, y0, y1, fmt) {
  let out = '';
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    const y = y0 - ((y0 - y1) * i) / 4;
    out += `<line x1="${x0}" x2="${x1}" y1="${y}" y2="${y}" class="grid${i === 0 ? ' grid--base' : ''}"/>`;
    out += `<text x="${x0 - 6}" y="${y + 4}" class="axis-label" text-anchor="end">${esc(fmt(v))}</text>`;
  }
  return out;
}

function xLabels(labels, xAt, y, width, minGap = 46) {
  const n = labels.length;
  const every = Math.max(1, Math.ceil((n * minGap) / width));
  let out = '';
  labels.forEach((l, i) => {
    if (i % every !== 0 && i !== n - 1) return;
    if (i === n - 1 && n > 1 && i % every !== 0 && (n - 1) % every < every * 0.6) return;
    out += `<text x="${xAt(i)}" y="${y}" class="axis-label" text-anchor="middle">${esc(l)}</text>`;
  });
  return out;
}

const tipAttr = (html) => (html ? `data-tip="${esc(html)}"` : '');

const DRAW = {
  bar(spec, W, H) {
    const fmt = spec.yFormat || ((v) => fmtNumber(v, 1));
    const n = spec.labels.length;
    const pad = { l: spec.padLeft ?? 40, r: 8, t: 10, b: 24 };
    const x0 = pad.l; const x1 = W - pad.r; const y0 = H - pad.b; const y1 = pad.t;
    const totals = spec.labels.map((_, i) => (spec.stacked
      ? spec.series.reduce((s, se) => s + (se.values[i] || 0), 0)
      : Math.max(0, ...spec.series.map((se) => se.values[i] || 0))));
    const max = scaleMax(Math.max(spec.minMax || 0, ...totals, ...(spec.goal ? [spec.goal] : [])), spec.yUnit);
    const band = (x1 - x0) / Math.max(1, n);
    const bw = Math.max(1, Math.min(42, band * 0.72));
    const xAt = (i) => x0 + band * i + band / 2;
    const yAt = (v) => y0 - ((y0 - y1) * v) / max;
    let bars = '';
    spec.labels.forEach((_, i) => {
      const tip = spec.tip ? spec.tip(i) : `${spec.labels[i]}: ${fmt(totals[i])}`;
      if (spec.stacked || spec.series.length === 1) {
        let acc = 0;
        spec.series.forEach((se) => {
          const v = se.values[i] || 0;
          if (v <= 0) return;
          const ya = yAt(acc + v); const yb = yAt(acc);
          bars += `<rect x="${(xAt(i) - bw / 2).toFixed(1)}" y="${ya.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, yb - ya).toFixed(1)}" rx="${Math.min(3, bw / 4)}" style="fill:${se.color}" class="bar-rect"/>`;
          acc += v;
        });
      } else {
        const k = spec.series.length;
        const sub = bw / k;
        spec.series.forEach((se, j) => {
          const v = se.values[i] || 0;
          if (v <= 0) return;
          const ya = yAt(v);
          bars += `<rect x="${(xAt(i) - bw / 2 + sub * j).toFixed(1)}" y="${ya.toFixed(1)}" width="${Math.max(1, sub - 1).toFixed(1)}" height="${Math.max(0.5, y0 - ya).toFixed(1)}" rx="2" style="fill:${se.color}" class="bar-rect${se.dashed ? ' is-hollow' : ''}"/>`;
        });
      }
      bars += `<rect x="${(x0 + band * i).toFixed(1)}" y="${y1}" width="${band.toFixed(1)}" height="${y0 - y1}" class="hit" ${tipAttr(tip)}/>`;
    });
    const goal = spec.goal ? `<line x1="${x0}" x2="${x1}" y1="${yAt(spec.goal)}" y2="${yAt(spec.goal)}" class="goal-line"/><text x="${x1}" y="${yAt(spec.goal) - 4}" class="axis-label goal-label" text-anchor="end">${esc(spec.goalLabel || 'Goal')}</text>` : '';
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${axisY(max, x0, x1, y0, y1, fmt)}${goal}${bars}${xLabels(spec.labels, xAt, H - 6, W)}</svg>`;
  },

  line(spec, W, H) {
    const fmt = spec.yFormat || ((v) => fmtNumber(v, 1));
    const n = spec.labels.length;
    const pad = { l: spec.padLeft ?? 40, r: 12, t: 12, b: 24 };
    const x0 = pad.l; const x1 = W - pad.r; const y0 = H - pad.b; const y1 = pad.t;
    const all = spec.series.flatMap((s) => s.values.filter((v) => v != null));
    const max = scaleMax(Math.max(spec.minMax || 0, ...all, 0), spec.yUnit);
    const xAt = (i) => (n <= 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (n - 1));
    const yAt = (v) => y0 - ((y0 - y1) * v) / max;
    let paths = '';
    for (const se of spec.series) {
      let d = ''; let started = false;
      se.values.forEach((v, i) => {
        if (v == null) { started = false; return; }
        d += `${started ? 'L' : 'M'}${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`;
        started = true;
      });
      if (se.area) paths += `<path d="${d}L${xAt(n - 1)} ${y0}L${xAt(0)} ${y0}Z" class="line-area" style="fill:${se.color}"/>`;
      paths += `<path d="${d}" class="line-path${se.dashed ? ' is-dashed' : ''}" style="stroke:${se.color}"/>`;
      if (n <= 40) se.values.forEach((v, i) => { if (v != null) paths += `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(v).toFixed(1)}" r="2.6" class="line-dot" style="fill:${se.color}"/>`; });
    }
    let hits = '';
    const band = (x1 - x0) / Math.max(1, n - 1);
    spec.labels.forEach((l, i) => {
      const tip = spec.tip ? spec.tip(i) : `${l}: ${spec.series.map((s) => `${s.name} ${fmt(s.values[i] ?? 0)}`).join(', ')}`;
      hits += `<rect x="${(xAt(i) - band / 2).toFixed(1)}" y="${y1}" width="${Math.max(2, band).toFixed(1)}" height="${y0 - y1}" class="hit" ${tipAttr(tip)}/>`;
    });
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${axisY(max, x0, x1, y0, y1, fmt)}${paths}${hits}${xLabels(spec.labels, xAt, H - 6, W)}</svg>`;
  },

  hbar(spec, W, H) {
    const fmt = spec.format || ((v) => fmtNumber(v, 1));
    const rows = spec.rows;
    if (!rows.length) return '<p class="chart__empty">No data in this period.</p>';
    const labelW = Math.min(spec.labelWidth || 150, W * 0.38);
    const rowH = (H - 4) / rows.length;
    const max = Math.max(...rows.map((r) => Math.max(r.value, r.secondary || 0)), 0.0001);
    const valW = 64;
    const bx = labelW + 8; const bw = W - bx - valW;
    let out = '';
    rows.forEach((r, i) => {
      const y = 2 + rowH * i;
      const bh = Math.min(18, rowH * 0.6);
      const cy = y + rowH / 2;
      const label = r.label.length > 26 ? `${r.label.slice(0, 25)}…` : r.label;
      out += `<text x="${labelW}" y="${cy + 4}" class="axis-label hbar-label" text-anchor="end">${esc(label)}</text>`;
      out += `<rect x="${bx}" y="${cy - bh / 2}" width="${bw}" height="${bh}" rx="${bh / 2}" class="hbar-track"/>`;
      if (r.secondary != null) out += `<rect x="${bx}" y="${cy - bh / 2}" width="${Math.max(0, (bw * r.secondary) / max).toFixed(1)}" height="${bh}" rx="${bh / 2}" class="hbar-secondary"/>`;
      out += `<rect x="${bx}" y="${cy - bh / 2}" width="${Math.max(r.value > 0 ? 3 : 0, (bw * r.value) / max).toFixed(1)}" height="${bh}" rx="${bh / 2}" style="fill:${r.color || 'var(--accent)'}"/>`;
      out += `<text x="${W - 2}" y="${cy + 4}" class="axis-label hbar-value" text-anchor="end">${esc(r.display ?? fmt(r.value))}</text>`;
      out += `<rect x="0" y="${y}" width="${W}" height="${rowH}" class="hit" ${tipAttr(r.tip || `${r.label}: ${fmt(r.value)}`)}/>`;
    });
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out}</svg>`;
  },

  donut(spec, W, H) {
    const total = spec.slices.reduce((s, x) => s + x.value, 0);
    const size = Math.min(W, H);
    const c = size / 2; const r = c - 6; const inner = r * 0.62;
    if (!total) return `<svg width="${W}" height="${H}"><circle cx="${W / 2}" cy="${H / 2}" r="${r}" class="hbar-track"/><text x="${W / 2}" y="${H / 2 + 4}" text-anchor="middle" class="axis-label">No data</text></svg>`;
    let a0 = -Math.PI / 2;
    let out = '';
    for (const s of spec.slices) {
      if (s.value <= 0) continue;
      const frac = s.value / total;
      const a1 = a0 + frac * Math.PI * 2 - (frac < 1 ? 0.012 : 0);
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (rad, rr) => `${(c + rr * Math.cos(rad)).toFixed(2)} ${(c + rr * Math.sin(rad)).toFixed(2)}`;
      const d = frac >= 0.999
        ? `M${c} ${c - r}A${r} ${r} 0 1 1 ${c - 0.01} ${c - r}L${c - 0.01} ${c - inner}A${inner} ${inner} 0 1 0 ${c} ${c - inner}Z`
        : `M${p(a0, r)}A${r} ${r} 0 ${large} 1 ${p(a1, r)}L${p(a1, inner)}A${inner} ${inner} 0 ${large} 0 ${p(a0, inner)}Z`;
      out += `<path d="${d}" style="fill:${s.color}" class="donut-slice" ${tipAttr(s.tip || `${s.label}: ${fmtNumber(s.value, 1)} (${Math.round(frac * 100)}%)`)}/>`;
      a0 += frac * Math.PI * 2;
    }
    const center = spec.center ? `<text x="${c}" y="${c}" text-anchor="middle" class="donut-value">${esc(spec.center.value)}</text><text x="${c}" y="${c + 18}" text-anchor="middle" class="axis-label">${esc(spec.center.label)}</text>` : '';
    return `<svg width="${W}" height="${H}" viewBox="${-(W - size) / 2} ${-(H - size) / 2} ${W} ${H}">${out}${center}</svg>`;
  },

  heatmap(spec, W) {
    const days = spec.days;
    if (!days.length) return '';
    const ws = spec.weekStart ?? 1;
    const first = new Date(`${days[0].date}T12:00:00`);
    const lead = (first.getDay() - ws + 7) % 7;
    const cols = Math.ceil((lead + days.length) / 7);
    const labelW = 26;
    const gap = 3;
    const cell = Math.max(8, Math.min(16, Math.floor((W - labelW) / cols) - gap));
    const width = labelW + cols * (cell + gap);
    const height = 16 + 7 * (cell + gap);
    let out = '';
    let lastMonth = '';
    days.forEach((d, i) => {
      const idx = lead + i;
      const col = Math.floor(idx / 7); const row = idx % 7;
      const x = labelW + col * (cell + gap); const y = 16 + row * (cell + gap);
      const mon = d.date.slice(0, 7);
      if (row === 0 || i === 0) {
        if (mon !== lastMonth && (d.date.slice(8) <= '07' || i === 0)) {
          out += `<text x="${x}" y="10" class="axis-label">${esc(new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short' }))}</text>`;
          lastMonth = mon;
        }
      }
      out += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="${Math.max(2, cell / 5)}" class="heat heat--${d.level}${d.future ? ' is-future' : ''}" ${tipAttr(d.tip)}/>`;
    });
    const names = spec.weekdayNames || [];
    [1, 3, 5].forEach((r) => { if (names[r]) out += `<text x="0" y="${16 + r * (cell + gap) + cell - 1}" class="axis-label">${esc(names[r].slice(0, 3))}</text>`; });
    return `<div class="heatmap-scroll"><svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${out}</svg></div>`;
  },
};

// ---------- tooltip ----------
let tipEl = null;
export function installTooltips() {
  tipEl = document.getElementById('tooltip');
  if (!tipEl) return;
  const show = (target, x, y) => {
    const html = target.getAttribute('data-tip');
    if (!html) return;
    tipEl.textContent = html;
    tipEl.classList.add('is-visible');
    const r = tipEl.getBoundingClientRect();
    let left = x + 12; let top = y - r.height - 10;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 12;
    if (top < 8) top = y + 16;
    tipEl.style.left = `${Math.max(8, left)}px`;
    tipEl.style.top = `${top}px`;
  };
  const hide = () => tipEl.classList.remove('is-visible');
  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (t) show(t, e.clientX, e.clientY); else hide();
  }, { passive: true });
  document.addEventListener('pointerdown', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (t && e.pointerType !== 'mouse') show(t, e.clientX, e.clientY);
  }, { passive: true });
  document.addEventListener('focusin', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (t) { const r = t.getBoundingClientRect(); show(t, r.left + r.width / 2, r.top); } else hide();
  });
  window.addEventListener('scroll', hide, { passive: true, capture: true });
}
