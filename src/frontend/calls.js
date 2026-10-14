/* Frontend calls: fetch/XHR requests captured by Faro tracing that were slow or failed.
   Rows come from this panel's Loki queries at render time. URLs are URL templates without query strings, and are masked again here. */

/* ===================== CONSTANTS (defaults) ===================== */
const MAX_ROWS = 60;          // calls listed
const DEFAULT_SLOW_MS = 1000; // used when the slow_ms variable is empty
const VERY_SLOW_FACTOR = 10;  // calls at slow_ms x this are drawn in red
const TRACE_LINK_FROM = "now-7d"; // time range opened by the trace id link in Explore

/* ===================== TEXTS (lang variable: en | pt-BR) ===================== */
const I18N = {
  en: {
    title: "Frontend calls", sub: (s) => `Fetch/XHR calls slower than ${s} or answered with HTTP ≥ 400`,
    statCalls: "Calls", statSlow: "Slow", statErr: "Failed", statMax: "Slowest", slow: "Slow",
    tabAll: "All", tabSlow: "Slow", tabErr: "Errors", search: "Search endpoint, status or trace id…",
    colTime: "Time", colStatus: "Status", colDur: "Duration (log scale)", colEp: "Endpoint", colTrace: "Trace",
    emptyFilter: "No call for this filter", foot: "Click a trace id to open the full trace in Explore (Tempo).",
    empty: "No slow or failed calls in the period. Check that app is selected and that Faro tracing (faro.tracing.fetch / xml-http-request events) is enabled.",
  },
  pt: {
    title: "Chamadas do front-end", sub: (s) => `Chamadas fetch/XHR mais lentas que ${s} ou com HTTP ≥ 400`,
    statCalls: "Chamadas", statSlow: "Lentas", statErr: "Com erro", statMax: "Mais lenta", slow: "Lenta",
    tabAll: "Todas", tabSlow: "Lentas", tabErr: "Erros", search: "Buscar endpoint, status ou trace id…",
    colTime: "Horário", colStatus: "Status", colDur: "Duração (escala log)", colEp: "Endpoint", colTrace: "Trace",
    emptyFilter: "Nenhuma chamada para este filtro", foot: "Clique no trace id para abrir o trace completo no Explore (Tempo).",
    empty: "Nenhuma chamada lenta ou com erro no período. Verifique se app está selecionado e se o tracing do Faro (eventos faro.tracing.fetch / xml-http-request) está ativo.",
  },
};

/*@@RUNTIME@@*/

/* ===================== DATA: buildData(data) ===================== */
function buildData(d) {
  const S = (d && d.series) || [], rows = [], seen = {};
  const two = (n) => ("0" + n).slice(-2), TM = (ts) => { const x = new Date(ts); return two(x.getHours()) + ":" + two(x.getMinutes()) + ":" + two(x.getSeconds()) + "." + Math.floor(x.getMilliseconds() / 100); };
  S.forEach((fr) => {
    const tf = (fr.fields || []).find((f) => f.type === "time"), lf = (fr.fields || []).find((f) => f.type === "string" && f.name !== "labels" && f.name !== "id" && f.name !== "tsNs");
    if (!lf) return; const L = RT.vals(lf), T = tf ? RT.vals(tf) : [];
    L.forEach((line, j) => {
      const p = String(line == null ? "" : line).split("|||"); if (p.length < 4) return;
      const tr = (p[3] || "").trim(), ts = T[j] || 0, key = tr + "@" + ts; if (seen[key]) return; seen[key] = 1;
      rows.push({ ts, t: TM(ts), status: parseInt(p[0], 10) || 0, ms: Math.round((parseFloat(p[1]) || 0) / 1e6), url: RT.cleanUrl((p[2] || "").trim()), method: (p[4] || "").trim(), trace: /^[0-9a-f]{16,32}$/i.test(tr) ? tr : "" });
    });
  });
  rows.sort((a, b) => b.ts - a.ts);
  return { traces: rows.slice(0, MAX_ROWS), slowMs: RT.num("slow_ms", DEFAULT_SLOW_MS), ds: RT.v("tempo_ds", "") };
}

/* ===================== RENDER ===================== */
const fmtMs = (v) => (v >= 1000 ? NF(v >= 10000 ? 1 : 2).format(v / 1000) + " s" : NF(0).format(v) + " ms");
const kind = (r, slow) => (r.status >= 500 ? "e5" : r.status >= 400 ? "e4" : r.ms >= slow ? "slow" : "ok");
const pillFor = (k, r) => (k === "e5" ? `<span class="pill bad">HTTP ${r.status}</span>` : k === "e4" ? `<span class="pill warn">HTTP ${r.status}</span>` : k === "slow" ? `<span class="pill bad" style="color:#FDA4AF">${esc(t("slow"))}</span>` : `<span class="pill good">OK</span>`);
const splitUrl = (u) => { const m = String(u).match(/^(https?:\/\/[^/]+)(.*)$/); return m ? [m[1].replace(/^https?:\/\//, ""), m[2] || "/"] : ["", u]; };
const STATE = window.__otelFaroCallState || (window.__otelFaroCallState = { tab: "all", q: "" });
function render(root, D) {
  const slow = D.slowMs, rows = D.traces.map((r) => ({ ...r, k: kind(r, slow) }));
  const nSlow = rows.filter((r) => r.k === "slow").length, nErr = rows.filter((r) => r.k === "e4" || r.k === "e5").length, maxMs = Math.max(...rows.map((r) => r.ms), 1);
  const logW = (v) => Math.max(3, (Math.log10(v + 1) / Math.log10(maxMs + 1)) * 100);
  const durColor = (r) => (r.k === "e5" || r.k === "e4" ? "var(--warn)" : r.ms >= slow * VERY_SLOW_FACTOR ? "var(--bad)" : r.ms >= slow ? "#FB923C" : "var(--accent)");
  const q = STATE.q.toLowerCase();
  const vis = rows.filter((r) => (STATE.tab === "all" || (STATE.tab === "slow" ? r.k === "slow" : r.k === "e4" || r.k === "e5")) && (!q || (r.url + r.trace + r.status).toLowerCase().includes(q)));
  const body = vis.length ? vis.map((r) => { const [h, p] = splitUrl(r.url), href = RT.exploreTrace(D.ds, r.trace, TRACE_LINK_FROM); return `<div class="row">
      <span class="mono" style="color:var(--muted)">${esc(r.t)}</span><span>${pillFor(r.k, r)}</span>
      <div class="dur"><div class="t"><div class="f" style="width:${logW(r.ms).toFixed(1)}%;background:${durColor(r)}"></div></div><span class="v num">${fmtMs(r.ms)}</span></div>
      <div class="ep" title="${esc((r.method ? r.method + " " : "") + r.url)}"><span class="host">${esc(h)}</span>${esc(p)}</div>
      ${href ? `<a class="tr mono" href="${esc(href)}" target="_blank" rel="noopener" title="${esc(r.trace)}">${esc(r.trace.slice(0, 12))}… ↗</a>` : `<span class="tr mono">—</span>`}</div>`; }).join("") : `<div class="empty">${esc(t("emptyFilter"))}</div>`;
  root.innerHTML = `<div class="hdr"><div><h2>${esc(t("title"))}</h2><div class="sub">${esc(t("sub", fmtMs(slow)))}</div></div>
      <div class="stats"><div class="stat"><div class="l">${esc(t("statCalls"))}</div><div class="v num">${rows.length}</div></div>
        <div class="stat"><div class="l">${esc(t("statSlow"))}</div><div class="v num" style="color:#FB923C">${nSlow}</div></div>
        <div class="stat"><div class="l">${esc(t("statErr"))}</div><div class="v num" style="color:var(--bad)">${nErr}</div></div>
        <div class="stat"><div class="l">${esc(t("statMax"))}</div><div class="v num">${rows.length ? fmtMs(maxMs) : "—"}</div></div></div></div>
    <div class="bar"><div class="tabs">
        <button data-tab="all" class="${STATE.tab === "all" ? "on" : ""}">${esc(t("tabAll"))}<b>${rows.length}</b></button>
        <button data-tab="slow" class="${STATE.tab === "slow" ? "on" : ""}">${esc(t("tabSlow"))}<b>${nSlow}</b></button>
        <button data-tab="err" class="${STATE.tab === "err" ? "on" : ""}">${esc(t("tabErr"))}<b>${nErr}</b></button></div>
      <input class="q" placeholder="${esc(t("search"))}" value="${esc(STATE.q)}"></div>
    <div class="list"><div class="row h"><span>${esc(t("colTime"))}</span><span>${esc(t("colStatus"))}</span><span>${esc(t("colDur"))}</span><span>${esc(t("colEp"))}</span><span>${esc(t("colTrace"))}</span></div>${body}</div>
    <div class="foot">${esc(t("foot"))}</div>`;
  root.onclick = (e) => { const b = e.target.closest("[data-tab]"); if (b) { STATE.tab = b.dataset.tab; render(root, D); } };
  root.oninput = (e) => { if (e.target.matches("input.q")) { STATE.q = e.target.value; const pos = e.target.selectionStart; render(root, D); const i = root.querySelector("input.q"); i.focus(); i.setSelectionRange(pos, pos); } };
}

RT.run("#ft-root", buildData, render, (D) => !D.traces.length, "empty");

/* ===================== ASSETS ===================== */
/*@@FONTS@@*/
