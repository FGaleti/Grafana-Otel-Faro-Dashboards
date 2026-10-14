const SPSS = 100;
const MAX_TRACES = 20;
const DEFAULT_SLOW_MS = 1000;
const TRACE_LINK_FROM = "now-7d";
const CACHE_SYSTEMS = ["redis", "valkey", "memcached", "dragonfly", "hazelcast", "ignite", "aerospike"];

const I18N = {
  en: {
    title: "Slow and failed requests", sub: "Each row is a real request. The bar shows how long it took and where that time went.",
    statTraces: "Traces", statSlow: "Slow", statErr: "Failed", statTop: "Biggest share",
    partApp: "Service code", partDb: "Database", partCache: "Cache", partExt: "Other services and APIs",
    inApp: "in the service's own code", inDb: "waiting on the database", inCache: "waiting on the cache", inExt: "waiting on other services and APIs",
    shortApp: "Code", shortDb: "DB", shortCache: "Cache", shortExt: "Calls",
    how: "How to read:", howRight: "Longer bar = slower request. All rows share the same scale.",
    tabAll: "All", tabSlow: "Slow", tabErr: "Errors", search: "Search route, status or trace id…",
    colTime: "Time", colResult: "Result", colRoute: "Route", colTrace: "Trace",
    pillErr: (c) => `Error ${c}`, pillSlow: "Slow", pillOk: "OK", responded: (c) => `Responded ${c}.`,
    almostAll: (w, v, tot) => `Almost all the time ${w}: ${v} of ${tot}`, mostly: (w, v, tot) => `Most of the time ${w}: ${v} of ${tot}`,
    split: (a, b) => `Time split between ${a} and ${b}`, noParts: (n) => `Breakdown unavailable: trace with more than ${n} calls`,
    segTitle: (l, v, p) => `${l}: ${v} (${p}% of the time)`, emptyFilter: "No trace for this filter",
    foot: "Hover a bar segment to see its exact time. The trace id opens the full trace in Explore.",
    empty: "No slow or failed requests in the period. Check the service variable, the slow_ms threshold and that server spans carry http.route.",
  },
  pt: {
    title: "Traces lentos e com erro", sub: "Cada linha é uma requisição real. A barra mostra quanto ela demorou e com o que esse tempo foi gasto.",
    statTraces: "Traces", statSlow: "Lentos", statErr: "Com erro", statTop: "Maior parcela",
    partApp: "Código do serviço", partDb: "Banco de dados", partCache: "Cache", partExt: "Outros serviços e APIs",
    inApp: "no código do próprio serviço", inDb: "esperando o banco de dados", inCache: "esperando o cache", inExt: "esperando outros serviços e APIs",
    shortApp: "Código", shortDb: "Banco", shortCache: "Cache", shortExt: "Chamadas",
    how: "Como ler:", howRight: "Barra mais longa = requisição mais demorada. Todas usam a mesma escala.",
    tabAll: "Todos", tabSlow: "Lentos", tabErr: "Erros", search: "Buscar rota, status ou trace id…",
    colTime: "Horário", colResult: "Resultado", colRoute: "Rota", colTrace: "Trace",
    pillErr: (c) => `Erro ${c}`, pillSlow: "Lenta", pillOk: "OK", responded: (c) => `Respondeu ${c}.`,
    almostAll: (w, v, tot) => `Quase todo o tempo ${w}: ${v} de ${tot}`, mostly: (w, v, tot) => `A maior parte ${w}: ${v} de ${tot}`,
    split: (a, b) => `Tempo dividido entre ${a} e ${b}`, noParts: (n) => `Detalhamento indisponível: trace com mais de ${n} chamadas`,
    segTitle: (l, v, p) => `${l}: ${v} (${p}% do tempo)`, emptyFilter: "Nenhum trace para este filtro",
    foot: "Passe o mouse em um trecho da barra para ver o tempo exato. O trace id abre o trace completo no Explore.",
    empty: "Nenhuma requisição lenta ou com erro no período. Verifique a variável service, o limite slow_ms e se os spans server trazem http.route.",
  },
};

"@@RUNTIME@@";

function buildData(d) {
  const S = (d && d.series) || [];
  const tbl = S.find((x) => (x.fields || []).some((y) => /traceid/i.test(y.name)));
  const rows = [];
  if (tbl) {
    const cols = tbl.fields.map((x) => [x.name, RT.vals(x)]), n = cols.length ? cols[0][1].length : 0;
    for (let i = 0; i < n; i++) { const o = {}; cols.forEach(([k, v]) => (o[k] = v[i])); rows.push(o); }
  }
  const pick = (o, re) => { for (const k in o) if (re.test(k)) return o[k]; return undefined; };
  const tid = (r) => pick(r, /^traceid/i), t0 = (r) => +pick(r, /^(time|startTime)$/) || 0, dur = (r) => (+pick(r, /^duration$/) || 0) / 1e6;
  const attr = (r, ...names) => { for (const nm of names) { const re = new RegExp("^(span\\.)?" + nm.replace(/\./g, "\\.") + "$"); const v = RT.nn(pick(r, re)); if (v != null) return v; } return null; };
  const kind = (r) => RT.nn(pick(r, /^kind$/));
  const isSrv = (r) => kind(r) === "server" && attr(r, "http.route");
  const typeOf = (r) => {
    const k = kind(r); if (k !== "client" && k !== "producer") return null;
    const db = attr(r, "db.system.name", "db.system");
    if (db) return CACHE_SYSTEMS.includes(String(db).toLowerCase()) ? "cache" : "db";
    return "ext";
  };
  const union = (iv) => { if (!iv.length) return 0; iv.sort((a, b) => a[0] - b[0]); let tt = 0, [s, e] = iv[0];
    for (let i = 1; i < iv.length; i++) { const [a, b] = iv[i]; if (a <= e) e = Math.max(e, b); else { tt += e - s; s = a; e = b; } } return tt + (e - s); };
  const two = (n) => ("0" + n).slice(-2), TM = (x) => { const z = new Date(x); return two(z.getHours()) + ":" + two(z.getMinutes()) + ":" + two(z.getSeconds()) + "." + ("00" + z.getMilliseconds()).slice(-3); };

  const P = {}, SRV = [];
  rows.forEach((r) => { const id = tid(r); if (!id) return; const o = P[id] || (P[id] = { c: [], n: 0 }); o.n++;
    if (isSrv(r)) SRV.push(r); else { const ty = typeOf(r); if (ty) o.c.push({ ty, s: t0(r), e: t0(r) + dur(r) }); } });
  const parts = (id, s, ms) => { const o = P[id];
    if (o.n >= SPSS) return null;
    const e = s + ms, iv = (ty) => o.c.filter((c) => !ty || c.ty === ty).map((c) => [Math.max(s, c.s), Math.min(e, c.e)]).filter((x) => x[1] > x[0]);
    const all = union(iv(null));
    return { app: Math.max(0, Math.round(ms - all)), db: Math.round(union(iv("db"))), cache: Math.round(union(iv("cache"))), ext: Math.round(union(iv("ext"))) }; };

  const seen = {}, out = [];
  for (const r of SRV.sort((a, b) => t0(b) - t0(a))) {
    const id = tid(r); if (seen[id]) continue; seen[id] = 1;
    const ms = dur(r);
    out.push({ t: TM(t0(r)), method: attr(r, "http.request.method", "http.method") || "—", route: attr(r, "http.route"), status: +attr(r, "http.response.status_code", "http.status_code") || 0, ms: Math.round(ms), parts: parts(id, t0(r), ms), trace: id });
    if (out.length >= MAX_TRACES) break;
  }
  return { slowMs: RT.num("slow_ms", DEFAULT_SLOW_MS), ds: RT.v("tempo_ds", ""), traces: out };
}

const fmtMs = (v) => (v >= 1000 ? NF(2).format(v / 1000) + " s" : NF(0).format(v) + " ms");
const PARTS = () => [
  ["app", t("partApp"), "var(--c-app)", t("inApp"), t("shortApp")],
  ["cache", t("partCache"), "var(--c-cache)", t("inCache"), t("shortCache")],
  ["db", t("partDb"), "var(--c-db)", t("inDb"), t("shortDb")],
  ["ext", t("partExt"), "var(--c-ext)", t("inExt"), t("shortExt")],
];
const kindOf = (r, slow) => (r.status >= 500 ? "e5" : r.status >= 400 ? "e4" : r.ms >= slow ? "slow" : "ok");
function pill(k, r) { return k === "e5" ? `<span class="pill bad">${esc(t("pillErr", r.status))}</span>` : k === "e4" ? `<span class="pill warn">${esc(t("pillErr", r.status))}</span>` : k === "slow" ? `<span class="pill slow">${esc(t("pillSlow"))}</span>` : `<span class="pill good">${esc(t("pillOk"))}</span>`; }
function niceMax(v) { const st = v > 4000 ? 1000 : 500; return Math.ceil((v * 1.08) / st) * st; }
function story(r) {
  const err = r.status >= 400 ? `<b style="color:${r.status >= 500 ? "var(--bad)" : "var(--warn)"}">${esc(t("responded", r.status))}</b> ` : "";
  if (r.parts == null) return err + esc(t("noParts", SPSS));
  const PS = PARTS(), sum = PS.reduce((a, [k]) => a + (r.parts[k] || 0), 0) || 1;
  const sorted = PS.slice().sort((a, b) => (r.parts[b[0]] || 0) - (r.parts[a[0]] || 0)), top = sorted[0], pct = ((r.parts[top[0]] || 0) / sum) * 100;
  const val = `<b style="color:${top[2]}">${fmtMs(r.parts[top[0]])}</b>`;
  if (pct >= 70) return err + t("almostAll", esc(top[3]), val, fmtMs(r.ms));
  if (pct >= 45) return err + t("mostly", esc(top[3]), val, fmtMs(r.ms));
  return err + esc(t("split", top[1].toLowerCase(), sorted[1][1].toLowerCase()));
}

const STATE = window.__otelTraceState || (window.__otelTraceState = { tab: "all", q: "" });
function render(root, D) {
  const PS = PARTS();
  const rows = D.traces.map((r) => ({ ...r, k: kindOf(r, D.slowMs) }));
  const nS = rows.filter((r) => r.k === "slow").length, nE = rows.filter((r) => r.k === "e4" || r.k === "e5").length;
  const tot = { app: 0, db: 0, cache: 0, ext: 0 }; rows.forEach((r) => { if (r.parts) PS.forEach(([k]) => (tot[k] += r.parts[k] || 0)); });
  const all = Object.values(tot).reduce((a, b) => a + b, 0) || 1, top = PS.slice().sort((a, b) => tot[b[0]] - tot[a[0]])[0];
  const q = STATE.q.toLowerCase();
  const vis = rows.filter((r) => (STATE.tab === "all" || (STATE.tab === "slow" ? r.k === "slow" : r.k === "e4" || r.k === "e5")) && (!q || (r.route + r.trace + r.status).toLowerCase().includes(q)));
  const MAX = niceMax(Math.max(...vis.map((r) => r.ms), 1)), stepT = MAX > 4000 ? 1000 : 500, ticks = []; for (let x = 0; x <= MAX; x += stepT) ticks.push(x);
  const gl = ticks.map((x) => `<div class="grid-l" style="left:${((x / MAX) * 100).toFixed(2)}%"></div>`).join("");
  const INK = { app: "#FFFFFF", db: "#FFFFFF", cache: "#0F1530", ext: "#0F1530" };
  const body = vis.length ? vis.map((r) => {
    const wPct = (r.ms / MAX) * 100;
    const segs = r.parts == null ? `<div title="${esc(t("noParts", SPSS))}" style="flex:1;background:#4A5070;padding:0"></div>` : PS.map(([k, l, c, , sh]) => { const v = r.parts[k] || 0; if (!v) return "";
      const segPct = (v / r.ms) * 100, px = (segPct * wPct) / 100, label = px >= 9 ? `${sh} ${fmtMs(v)}` : px >= 4.5 ? fmtMs(v) : "";
      return `<div title="${esc(t("segTitle", l, fmtMs(v), NF(0).format(segPct)))}" style="flex:${v};background:${c};color:${INK[k]};${label ? "" : "padding:0"}">${esc(label)}</div>`; }).join("");
    const href = RT.exploreTrace(D.ds, r.trace, TRACE_LINK_FROM);
    return `<div class="row">
      <span class="mono" style="color:var(--muted)">${esc(r.t)}</span><span>${pill(r.k, r)}</span>
      <span class="rt" title="${esc(r.method + " " + r.route)}"><span class="m ${esc(r.method)}">${esc(r.method)}</span>${esc(r.route)}</span>
      <div><div class="story">${story(r)}</div>
        <div class="track">${gl}<div class="tb" style="width:${wPct.toFixed(2)}%">${segs}</div><span class="tot num" style="left:calc(${wPct.toFixed(2)}% + 8px)">${fmtMs(r.ms)}</span></div></div>
      ${href ? `<a class="tr mono" href="${esc(href)}" target="_blank" rel="noopener" title="${esc(r.trace)}">${esc(String(r.trace).slice(0, 12))}… ↗</a>` : `<span class="tr mono">${esc(String(r.trace).slice(0, 12))}…</span>`}</div>`;
  }).join("") : `<div class="empty">${esc(t("emptyFilter"))}</div>`;
  const axis = `<div class="axis">${ticks.map((x) => `<span style="left:${((x / MAX) * 100).toFixed(2)}%">${x === 0 ? "0" : fmtMs(x)}</span>`).join("")}</div>`;
  root.innerHTML = `<div class="hdr"><div><h2>${esc(t("title"))}</h2><div class="sub">${esc(t("sub"))}</div></div>
      <div class="stats">
        <div class="stat"><div class="l">${esc(t("statTraces"))}</div><div class="v num">${rows.length}</div></div>
        <div class="stat"><div class="l">${esc(t("statSlow"))}</div><div class="v num" style="color:#FB923C">${nS}</div></div>
        <div class="stat"><div class="l">${esc(t("statErr"))}</div><div class="v num" style="color:var(--bad)">${nE}</div></div>
        <div class="stat"><div class="l">${esc(t("statTop"))}</div><div class="v" style="color:${top[2]}">${esc(top[1])} <span class="num" style="font-size:12px;color:var(--muted)">${NF(0).format((tot[top[0]] / all) * 100)}%</span></div></div>
      </div></div>
    <div class="guide"><span class="how">${esc(t("how"))}</span>${PS.map(([, l, c]) => `<span><i style="background:${c}"></i>${esc(l)}</span>`).join("")}<span style="margin-left:auto">${esc(t("howRight"))}</span></div>
    <div class="bar"><div class="tabs">
        <button data-tab="all" class="${STATE.tab === "all" ? "on" : ""}">${esc(t("tabAll"))}<b>${rows.length}</b></button>
        <button data-tab="slow" class="${STATE.tab === "slow" ? "on" : ""}">${esc(t("tabSlow"))}<b>${nS}</b></button>
        <button data-tab="err" class="${STATE.tab === "err" ? "on" : ""}">${esc(t("tabErr"))}<b>${nE}</b></button></div>
      <input class="q" placeholder="${esc(t("search"))}" value="${esc(STATE.q)}"></div>
    <div class="list"><div class="row h"><span>${esc(t("colTime"))}</span><span>${esc(t("colResult"))}</span><span>${esc(t("colRoute"))}</span>${axis}<span style="padding-left:8px">${esc(t("colTrace"))}</span></div>${body}</div>
    <div class="foot">${esc(t("foot"))}</div>`;
  root.onclick = (e) => { const b = e.target.closest("[data-tab]"); if (b) { STATE.tab = b.dataset.tab; render(root, D); } };
  root.oninput = (e) => { if (e.target.matches("input.q")) { STATE.q = e.target.value; const p = e.target.selectionStart; render(root, D); const i = root.querySelector("input.q"); i.focus(); i.setSelectionRange(p, p); } };
}

RT.run("#bt-root", buildData, render, (D) => !D.traces.length, "empty");

"@@FONTS@@";
