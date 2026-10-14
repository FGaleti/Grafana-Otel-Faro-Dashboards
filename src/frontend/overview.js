/* Frontend overview: Grafana Faro events stored in Loki (sessions, page views, errors, Web Vitals, audience).
   Every value comes from this panel's queries at render time; app, environment and filters come from dashboard variables.
   view_name and browser_name are parsed fields (not Loki labels), so their filters are picked in this panel. */

/* ===================== CONSTANTS (defaults) ===================== */
const MAX_BARS = 8;           // rows in "Slowest views" and "Views with most errors"
const MAX_BROWSERS = 3;       // browsers listed before "Others"
const MAX_FILTER_VIEWS = 24;  // views offered as filter buttons (busiest first)
const MAX_ERRORS = 6;         // rows in "Recent errors"
const SCORE_GOOD = 75, SCORE_WARN = 50; // experience score bands (% of good page views)
/* Web Vitals thresholds published by Google (good, poor); the unit of CLS is unitless */
const VITALS = [["LCP", "ms", 2500, 4000], ["INP", "ms", 200, 500], ["CLS", "", 0.1, 0.25], ["FCP", "ms", 1800, 3000], ["TTFB", "ms", 800, 1800]];

/* ===================== TEXTS (lang variable: en | pt-BR) ===================== */
const I18N = {
  en: {
    title: "Frontend (Faro)", subtitle: "Real user monitoring · Web Vitals, errors and views", app: "App", env: "Environment", experience: (s) => `Experience: ${s}`,
    good: "Good", warn: "Needs attention", bad: "Poor", neutral: "No samples",
    kSessions: "Sessions", kViews: "Page views", kErrRate: "Error rate", kErrSessions: "Sessions with errors", vsPrev: "vs. previous period",
    scoreTitle: "Experience score", scoreHint: "p75 · Google thresholds", scoreFoot: "% of page views with good LCP, INP and CLS",
    vitalsTitle: "Web Vitals over the period", vitalsHint: "p75 per interval · dashed = 'good' limit", samples: (n) => `${n} samples`, noSamples: "no",
    LCP: "Largest Contentful Paint", INP: "Interaction to Next Paint", CLS: "Cumulative Layout Shift", FCP: "First Contentful Paint", TTFB: "Time to First Byte",
    slowTitle: "Slowest views", slowHint: "p75 LCP per view", errTitle: "Views with most errors", errHint: "affected sessions",
    audTitle: "Audience", audHint: "sessions", browser: "Browser", others: "Others", desktop: "Desktop", mobile: "Mobile",
    recentTitle: "Recent errors", recentHint: "benign noise excluded (ignore_errors_regex)", colTime: "Time", colMsg: "Message", colView: "View", colType: "Type",
    filterView: "View", filterBrowser: "Browser", all: "All", clickHint: "Click a view or browser to filter the whole dashboard.", more: (n) => `+${n} more`,
    noErrors: "No errors in the period.", noAudience: "No session started with the current filters.", noSlow: "No Web Vitals with a view name in the period.",
    empty: "No Faro data in the selected period. Check that app is selected and that Faro events reach Loki with the labels service_name and kind.",
    days: (n) => `Last ${n} days`, hours: (n) => `Last ${n} h`, selected: "Selected period",
  },
  pt: {
    title: "Front-end (Faro)", subtitle: "Experiência real do usuário (RUM) · Web Vitals, erros e views", app: "App", env: "Ambiente", experience: (s) => `Experiência: ${s}`,
    good: "Bom", warn: "Atenção", bad: "Ruim", neutral: "Sem amostras",
    kSessions: "Sessões", kViews: "Page views", kErrRate: "Taxa de erro", kErrSessions: "Sessões com erro", vsPrev: "vs. período anterior",
    scoreTitle: "Score de experiência", scoreHint: "p75 · limiares Google", scoreFoot: "% de page views com LCP, INP e CLS bons",
    vitalsTitle: "Web Vitals ao longo do período", vitalsHint: "p75 por intervalo · tracejado = limite \"bom\"", samples: (n) => `${n} amostras`, noSamples: "sem",
    LCP: "Largest Contentful Paint", INP: "Interaction to Next Paint", CLS: "Cumulative Layout Shift", FCP: "First Contentful Paint", TTFB: "Time to First Byte",
    slowTitle: "Views mais lentas", slowHint: "p75 LCP por view", errTitle: "Views com mais erros", errHint: "sessões afetadas",
    audTitle: "Audiência", audHint: "sessões", browser: "Navegador", others: "Outros", desktop: "Desktop", mobile: "Mobile",
    recentTitle: "Erros recentes", recentHint: "ruído benigno excluído (ignore_errors_regex)", colTime: "Horário", colMsg: "Mensagem", colView: "View", colType: "Tipo",
    filterView: "View", filterBrowser: "Navegador", all: "Todas", clickHint: "Clique numa view ou navegador para filtrar o dashboard inteiro.", more: (n) => `+${n}`,
    noErrors: "Nenhum erro no período.", noAudience: "Nenhuma sessão começou com os filtros atuais.", noSlow: "Nenhum Web Vital com nome de view no período.",
    empty: "Sem dados do Faro no período. Verifique se app está selecionado e se os eventos do Faro chegam ao Loki com os labels service_name e kind.",
    days: (n) => `Últimos ${n} dias`, hours: (n) => `Últimas ${n} h`, selected: "Período selecionado",
  },
};

/*@@RUNTIME@@*/

/* ===================== DATA: buildData(data) ===================== */
function buildData(d) {
  const S = (d && d.series) || [];
  const FS = (id) => S.filter((f) => f.refId === id);
  const NUMF = (fr) => (fr.fields || []).find((f) => f.type === "number") || null;
  const SF = (fr) => (fr.fields || []).find((f) => f.type === "string" && f.name !== "labels" && f.name !== "id" && f.name !== "tsNs") || null;
  const last = (id) => { for (const fr of FS(id)) { const n = NUMF(fr); if (!n) continue; const a = RT.vals(n); for (let j = a.length - 1; j >= 0; j--) if (a[j] != null && isFinite(a[j])) return +a[j]; } return null; };
  const ser = (id) => { const fr = FS(id)[0]; if (!fr) return null; const n = NUMF(fr); if (!n) return null; const a = RT.vals(n).filter((x) => x != null && isFinite(x)).map(Number); return a.length > 1 ? a : null; };
  const pairs = (id) => {
    const o = [];
    FS(id).forEach((fr) => { const n = NUMF(fr); if (!n) return; const s = SF(fr), nv = RT.vals(n);
      if (s) { const kv = RT.vals(s); nv.forEach((v, j) => { const k = kv[j]; if (k != null && k !== "" && v != null && isFinite(v)) o.push([String(k), +v]); }); }
      else { const l = n.labels || {}, lb = l.view_name || l.browser_name || l.browser_mobile; if (!lb) return; for (let j = nv.length - 1; j >= 0; j--) if (nv[j] != null && isFinite(nv[j])) { o.push([String(lb), +nv[j]]); break; } } });
    return o.sort((a, b) => b[1] - a[1]);
  };
  const dl = (c, p) => (c == null || p == null || !p ? null : ((c - p) / p) * 100);
  const logs = (id) => {
    const out = [];
    FS(id).forEach((fr) => { const tf = fr.fields.find((f) => f.type === "time"), lf = SF(fr); if (!lf) return; const L = RT.vals(lf), T = tf ? RT.vals(tf) : []; L.forEach((x, j) => out.push([T[j] || 0, String(x == null ? "" : x)])); });
    return out.sort((a, b) => b[0] - a[0]).slice(0, MAX_ERRORS).map(([ts, line]) => {
      const p = line.split("|||"), m = (p[0] || "").trim(), v = (p[1] || "").trim(), ty = (p[2] || "").trim();
      const m5 = m.match(/status code (5\d\d)/i), m4 = m.match(/status code (4\d\d)/i), dt = new Date(ts), two = (n) => ("0" + n).slice(-2);
      return { t: two(dt.getDate()) + "/" + two(dt.getMonth() + 1) + " " + two(dt.getHours()) + ":" + two(dt.getMinutes()), msg: RT.mask(m), view: v || "—", type: m5 ? "HTTP " + m5[1] : m4 ? "HTTP " + m4[1] : ty || "Exception" };
    });
  };
  const br = pairs("BROWSER"), top = br.slice(0, MAX_BROWSERS); let rest = 0; br.slice(MAX_BROWSERS).forEach((b) => (rest += b[1]));
  if (rest > 0) top.push([null, rest]);
  const dm = {}; pairs("DEVICE").forEach(([k, v]) => (dm[k] = v));
  const devs = []; if (dm["false"] != null) devs.push([t("desktop"), dm["false"]]); if (dm["true"] != null) devs.push([t("mobile"), dm["true"]]);
  let range = t("selected");
  try { const tr = d && d.timeRange; if (tr && tr.from && tr.to) { const hs = (+tr.to.valueOf() - +tr.from.valueOf()) / 3600000; range = hs >= 24 ? t("days", Math.round(hs / 24)) : t("hours", Math.round(hs)); } } catch (e) {}
  const sess = last("SESS"), pv = last("PV"), er = last("ERR"), ers = last("ERRS");
  return {
    app: RT.v("app", "—"), env: RT.v("environment:text", "—"), range,
    view: RT.v("view", ".*"), browser: RT.v("browser", ".*"),
    kpis: [
      { label: t("kSessions"), value: sess, fmt: "int", delta: dl(sess, last("SESS_PREV")), upIsGood: true, spark: ser("SESS_TS") },
      { label: t("kViews"), value: pv, fmt: "k", delta: dl(pv, last("PV_PREV")), upIsGood: true, spark: ser("PV_TS") },
      { label: t("kErrRate"), value: er, fmt: "pct", delta: dl(er, last("ERR_PREV")), upIsGood: false, spark: ser("ERR_TS") },
      { label: t("kErrSessions"), value: ers, fmt: "int", delta: dl(ers, last("ERRS_PREV")), upIsGood: false, spark: ser("ERRS_TS") },
    ],
    score: last("SCORE"),
    vitals: VITALS.map(([k, unit, good, poor]) => ({ k, name: t(k), v: last(k), unit, good, poor, n: last(k + "_N"), spark: ser(k + "_TS") })),
    slowRoutes: pairs("SLOW").slice(0, MAX_BARS), errorRoutes: pairs("ERR_ROUTES").slice(0, MAX_BARS), views: pairs("VIEWS"),
    browsers: top, devices: devs, errors: logs("ERR_LIST"),
  };
}

/* ===================== HELPERS ===================== */
let UID = 0;
function fmtKpi(k) {
  if (k.value == null) return "—";
  if (k.fmt === "k") return k.value >= 1000 ? NF(1).format(k.value / 1000) + "<small>k</small>" : NF(0).format(k.value);
  if (k.fmt === "pct") return NF(2).format(k.value) + "<small>%</small>";
  return NF(0).format(k.value);
}
function fmtVital(v) { if (v.v == null) return "—"; if (v.unit === "") return NF(3).format(v.v); if (v.v >= 1000) return NF(2).format(v.v / 1000) + "<small>s</small>"; return NF(0).format(v.v) + "<small>ms</small>"; }
const fmtMs = (v) => (v >= 1000 ? NF(2).format(v / 1000) + " s" : NF(0).format(v) + " ms");
const status = (v, good, poor) => (v == null ? "neutral" : v <= good ? "good" : v <= poor ? "warn" : "bad");
const COLOR = { good: "var(--good)", warn: "var(--warn)", bad: "var(--bad)", neutral: "var(--muted)" };
function sparkline(vals, w, h, color, opt = {}) {
  if (!vals || !vals.length) return `<svg viewBox="0 0 ${w} ${h}"></svg>`;
  const id = "g" + ++UID, max = Math.max(...vals, opt.ref || 0) * 1.1 || 1, min = opt.zero ? 0 : Math.min(...vals) * 0.9;
  const x = (i) => i * (w / (vals.length - 1)), y = (v) => h - ((v - min) / (max - min || 1)) * (h - 4) - 2;
  const d = vals.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" ");
  const ref = opt.ref != null ? `<line x1="0" x2="${w}" y1="${y(opt.ref)}" y2="${y(opt.ref)}" stroke="var(--good)" stroke-opacity=".5" stroke-dasharray="3 4" stroke-width="1"/>` : "";
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    ${ref}<path d="${d} L${w} ${h} L0 ${h}Z" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}
const scoreSt = (s) => (s == null ? "neutral" : s >= SCORE_GOOD ? "good" : s >= SCORE_WARN ? "warn" : "bad");
const isOn = (cur, name) => cur !== ".*" && cur === RT.reEscape(name);

/* ===================== SECTIONS ===================== */
function header(D) {
  const st = scoreSt(D.score);
  return `<div class="hdr"><div class="brand">
      <div class="logo"><img src="${faroLogo()}" alt="Grafana Faro"></div>
      <div><h1>${esc(t("title"))}</h1><div class="sub">${esc(t("subtitle"))}</div></div></div>
    <div class="chips"><span class="chip">${esc(t("app"))} <b>${esc(D.app)}</b></span><span class="chip">${esc(t("env"))} <b>${esc(D.env)}</b></span>
      <span class="chip"><b>${esc(D.range)}</b></span><span class="pill ${st}" style="padding:6px 12px;font-size:12px">${esc(t("experience", t(st)))}</span></div></div>`;
}
function filters(D) {
  const views = D.views.slice(0, MAX_FILTER_VIEWS), extra = D.views.length - views.length;
  const b = (kind, name, label, on) => `<button data-pick="${kind}:${esc(name == null ? "" : name)}" class="${on ? "on" : ""}">${esc(label)}</button>`;
  const brs = D.browsers.filter((x) => x[0] != null);
  return `<div class="filt"><span class="lbl">${esc(t("filterView"))}</span>${b("view", null, t("all"), D.view === ".*")}${views.map(([v]) => b("view", v, v, isOn(D.view, v))).join("")}${extra > 0 ? `<span class="more">${esc(t("more", extra))}</span>` : ""}</div>
    <div class="filt"><span class="lbl">${esc(t("filterBrowser"))}</span>${b("browser", null, t("all"), D.browser === ".*")}${brs.map(([v]) => b("browser", v, v, isOn(D.browser, v))).join("")}<span class="more">${esc(t("clickHint"))}</span></div>`;
}
function kpiCard(k) {
  const up = k.delta >= 0, good = up === k.upIsGood, cls = k.delta == null ? "neutral" : Math.abs(k.delta) < 0.5 ? "neutral" : good ? "good" : "bad";
  return `<div class="card kpi s3"><div class="top"><span class="lbl">${esc(k.label)}</span>
      <span class="delta ${cls} num">${k.delta == null ? "—" : (up ? "▲ " : "▼ ") + NF(1).format(Math.abs(k.delta)) + "%"}</span></div>
    <div class="val num">${fmtKpi(k)}</div><div class="cmp">${esc(t("vsPrev"))}</div>${sparkline(k.spark, 300, 54, k.upIsGood ? "var(--accent)" : "var(--accent-2)", { zero: true })}</div>`;
}
function hero(D) {
  const W = 560, H = 345, cx = 280, cy = 205, R = 116, TR = 142, st = scoreSt(D.score);
  const a0 = 135, sweep = 270, rad = (x) => (x * Math.PI) / 180, pt = (r, deg) => [cx + r * Math.cos(rad(deg)), cy + r * Math.sin(rad(deg))];
  const arc = (r, from, to) => { const [x1, y1] = pt(r, from), [x2, y2] = pt(r, to); return `M${x1} ${y1} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`; };
  const p = Math.max(0, Math.min(100, D.score || 0)) / 100;
  let ticks = ""; for (let i = 0; i <= 54; i++) { const dg = a0 + i * (sweep / 54), [x1, y1] = pt(TR, dg), [x2, y2] = pt(TR + (i % 9 === 0 ? 9 : 5), dg);
    ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(255,255,255,${i / 54 <= p ? 0.35 : 0.1})" stroke-width="1.4"/>`; }
  const [kx, ky] = pt(R, a0 + sweep * p), ang = [205, 152, 90, 28, -25], RX = 214, RY = 170;
  const sats = D.vitals.map((v, i) => { const tt = rad(ang[i]), x = cx + RX * Math.cos(tt), y = cy - RY * Math.sin(tt), s = status(v.v, v.good, v.poor);
    const val = fmtVital(v).replace(/<small>(.*?)<\/small>/, '<tspan font-size="11" fill="var(--muted)"> $1</tspan>');
    return `<g transform="translate(${x - 62},${y - 31})"><rect width="124" height="62" rx="14" fill="rgba(255,255,255,.045)" stroke="rgba(255,255,255,.08)"/>
      <circle cx="16" cy="18" r="4" fill="${COLOR[s]}"/><text x="26" y="22" font-size="11" fill="var(--muted)" letter-spacing=".05em">${v.k}</text>
      <text x="110" y="22" font-size="10" fill="${COLOR[s]}" text-anchor="end">${s === "neutral" ? "—" : esc(t(s))}</text>
      <text x="14" y="49" font-size="20" font-weight="600" fill="var(--text)" style="font-variant-numeric:tabular-nums">${val}</text></g>`; }).join("");
  return `<div class="card hero s5"><div class="ttl" style="padding:4px 10px 0"><h2>${esc(t("scoreTitle"))}</h2><span>${esc(t("scoreHint"))}</span></div>
    <svg viewBox="0 0 ${W} ${H}"><defs>
      <linearGradient id="arcG" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="var(--accent-2)"/><stop offset=".55" stop-color="var(--accent)"/><stop offset="1" stop-color="${COLOR[st]}"/></linearGradient>
      <radialGradient id="glow"><stop offset="0" stop-color="rgba(124,156,255,.28)"/><stop offset="1" stop-color="rgba(124,156,255,0)"/></radialGradient>
      <filter id="blur"><feGaussianBlur stdDeviation="6"/></filter></defs>
      <circle cx="${cx}" cy="${cy}" r="${R + 40}" fill="url(#glow)"/>${ticks}
      <path d="${arc(R, a0, a0 + sweep)}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="16" stroke-linecap="round"/>
      <path d="${arc(R, a0, a0 + sweep * p)}" fill="none" stroke="url(#arcG)" stroke-width="16" stroke-linecap="round" filter="url(#blur)" opacity=".55"/>
      <path d="${arc(R, a0, a0 + sweep * p)}" fill="none" stroke="url(#arcG)" stroke-width="16" stroke-linecap="round"/>
      <circle cx="${kx}" cy="${ky}" r="6" fill="#fff"/>
      <text x="${cx}" y="${cy + 8}" text-anchor="middle" font-size="62" font-weight="600" fill="var(--text)" letter-spacing="-2" style="font-variant-numeric:tabular-nums">${D.score == null ? "—" : NF(1).format(D.score)}<tspan font-size="24" fill="var(--muted)" dx="4">%</tspan></text>
      <g transform="translate(${cx - 44},${cy + 26})"><rect width="88" height="24" rx="12" fill="${COLOR[st]}" fill-opacity=".14"/><text x="44" y="16" text-anchor="middle" font-size="12" font-weight="600" fill="${COLOR[st]}">${esc(t(st))}</text></g>
      <text x="${cx}" y="${cy + 118}" text-anchor="middle" font-size="12" fill="var(--muted)">${esc(t("scoreFoot"))}</text>${sats}</svg></div>`;
}
function vitals(D) {
  const rows = D.vitals.map((v) => { const s = status(v.v, v.good, v.poor);
    return `<div class="vrow"><div class="vname"><b>${v.k}</b><div>${esc(v.name)}</div></div>
      ${sparkline(v.spark, 400, 36, COLOR[s] === "var(--good)" ? "var(--accent)" : COLOR[s], { ref: v.good, zero: true })}
      <div class="vval num">${fmtVital(v)}<div style="font-size:10px;color:var(--dim);font-weight:400">${esc(t("samples", v.n == null ? t("noSamples") : NF(0).format(v.n)))}</div></div>
      <span class="pill ${s}">${esc(t(s))}</span></div>`; }).join("");
  return `<div class="card s7 vit"><div class="ttl"><h2>${esc(t("vitalsTitle"))}</h2><span>${esc(t("vitalsHint"))}</span></div><div class="rows">${rows}</div></div>`;
}
function barList(title, hint, items, fmt, colorFn, span, emptyTxt) {
  const max = Math.max(...items.map((i) => i[1]), 1);
  const rows = items.map((it, i) => `<div class="bar" data-pick="view:${esc(it[0])}"><span class="i">${i + 1}</span><span class="n" title="${esc(it[0])}">${esc(it[0])}</span>
    <div class="t"><div class="f" style="width:${((it[1] / max) * 100).toFixed(1)}%;background:${colorFn(it[1], i)}"></div></div><span class="v num">${fmt(it[1])}</span></div>`).join("");
  return `<div class="card ${span}"><div class="ttl"><h2>${esc(title)}</h2><span>${esc(hint)}</span></div>${items.length ? `<div class="bars">${rows}</div>` : `<p class="note">${esc(emptyTxt)}</p>`}</div>`;
}
function audience(D) {
  const pal = ["var(--accent)", "var(--accent-2)", "#5EEAD4", "#5B6478"];
  const tot = D.browsers.reduce((a, b) => a + b[1], 0) || 1, dt = D.devices.reduce((a, b) => a + b[1], 0) || 1;
  return `<div class="card s3 aud"><div class="ttl"><h2>${esc(t("audTitle"))}</h2><span>${esc(t("audHint"))}</span></div>
    ${D.browsers.length ? "" : `<p class="note">${esc(t("noAudience"))}</p>`}<div class="lbl">${esc(t("browser"))}</div>
    <div class="stack">${D.browsers.map((b, i) => `<div style="flex:${Math.max(b[1] / tot, 0.012)};background:${pal[i % 4]}"></div>`).join("")}</div>
    <div class="leg">${D.browsers.map((b, i) => `<div${b[0] != null ? ` data-pick="browser:${esc(b[0])}"` : ""}><i style="background:${pal[i % 4]}"></i><span>${esc(b[0] == null ? t("others") : b[0])}</span><span class="num">${NF(0).format(b[1])}</span><em class="num">${NF(0).format((b[1] / tot) * 100)}%</em></div>`).join("")}</div>
    <div class="devs">${D.devices.map((x) => `<div class="dev"><div class="lbl">${esc(x[0])}</div><div class="big num">${NF(0).format(x[1])}<small>${NF(0).format((x[1] / dt) * 100)}%</small></div></div>`).join("")}</div></div>`;
}
function errors(D) {
  const typeCls = (x) => (/^HTTP 5/.test(x) ? "bad" : /^HTTP/.test(x) ? "warn" : "bad");
  const rows = D.errors.map((e) => `<tr><td class="mut num">${esc(e.t)}</td><td class="msg" title="${esc(e.msg)}">${esc(e.msg)}</td><td class="mut">${esc(e.view)}</td><td><span class="pill ${typeCls(e.type)}">${esc(e.type)}</span></td></tr>`).join("");
  return `<div class="card s12"><div class="ttl"><h2>${esc(t("recentTitle"))}</h2><span>${esc(t("recentHint"))}</span></div>
    ${D.errors.length ? `<table><colgroup><col style="width:120px"><col><col style="width:200px"><col style="width:130px"></colgroup>
    <thead><tr><th>${esc(t("colTime"))}</th><th>${esc(t("colMsg"))}</th><th>${esc(t("colView"))}</th><th>${esc(t("colType"))}</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="note">${esc(t("noErrors"))}</p>`}</div>`;
}
function render(root, D) {
  const lcp = D.vitals.find((v) => v.k === "LCP");
  root.innerHTML = header(D) + filters(D) + `<div class="grid">${D.kpis.map(kpiCard).join("")}${hero(D)}${vitals(D)}
    ${barList(t("slowTitle"), t("slowHint"), D.slowRoutes, fmtMs, (v) => COLOR[status(v, lcp.good, lcp.poor)], "s5", t("noSlow"))}
    ${barList(t("errTitle"), t("errHint"), D.errorRoutes, (v) => NF(0).format(v), (v, i) => (i < 1 ? "var(--bad)" : i < 4 ? "var(--warn)" : "var(--accent)"), "s4", t("noErrors"))}
    ${audience(D)}${errors(D)}</div>`;
  /* filters: view_name and browser_name values come from the panel's Loki queries; clicking sets the dashboard variable */
  root.onclick = (e) => {
    const el = e.target.closest("[data-pick]"); if (!el) return;
    const [kind, ...rest] = el.getAttribute("data-pick").split(":"), name = rest.join(":");
    const cur = kind === "view" ? D.view : D.browser, val = !name || isOn(cur, name) ? ".*" : RT.reEscape(name);
    RT.setVar(kind, val);
  };
}

RT.run("#ff-root", buildData, render, (D) => D.kpis[0].value == null && D.kpis[1].value == null && D.vitals.every((v) => v.v == null) && !D.errors.length, "empty");

/* ===================== ASSETS ===================== */
/* Grafana Faro icon, cropped from docs/faro_logo_dark.png of github.com/grafana/faro-web-sdk (Apache-2.0). Faro is a trademark of Grafana Labs; no affiliation implied. */
function faroLogo() { return "data:image/png;base64,/*@@FARO_LOGO@@*/"; }
/*@@FONTS@@*/
