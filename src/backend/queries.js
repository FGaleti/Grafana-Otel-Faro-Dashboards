const MAX_QUERIES = 7;
const DEFAULT_SLOW_MS = 1000;
const TRACE_LINK_FROM = "now-7d";
const CACHE_SYSTEMS = ["redis", "valkey", "memcached", "dragonfly", "hazelcast", "ignite", "aerospike"];
const DOUBLE_QUOTE_IDENTIFIERS = ["postgresql", "sqlite", "oracle", "oracle.db", "db2", "ibm.db2", "cockroachdb", "h2", "hsqldb", "derby", "trino", "presto", "snowflake", "redshift", "duckdb"];

const I18N = {
  en: {
    title: "Slowest queries", sub: (s) => `Statements sent by the service, with literal values replaced by ?. Sorted by p95.${s}`, based: (n) => ` Based on ${n} traces returned by the search.`,
    statDistinct: "Distinct queries", statSlow: (s) => `Above ${s}`, statWorst: "Worst query", statWeight: "Share of the worst", ofTime: " of time",
    colN: "#", colQuery: "Query and source route", colP95: "p95 (white mark = max)", colTrace: "Trace",
    table: "table", runs: "runs", max: "max", traceTip: "example trace",
    foot: "Share = p95 × runs, compared with the other queries. Cache commands are left out because they carry keys such as session ids.",
    empty: "No database statements in the period. Check the service variable and that client spans carry db.query.text (or db.statement).",
  },
  pt: {
    title: "Consultas mais lentas", sub: (s) => `Comandos enviados pelo serviço, com os valores trocados por ?. Ordenado por p95.${s}`, based: (n) => ` Baseado em ${n} traces retornados pela busca.`,
    statDistinct: "Consultas distintas", statSlow: (s) => `Acima de ${s}`, statWorst: "Pior consulta", statWeight: "Peso da pior", ofTime: " do tempo",
    colN: "#", colQuery: "Consulta e rota de origem", colP95: "p95 (traço branco = máximo)", colTrace: "Trace",
    table: "tabela", runs: "execuções", max: "máx", traceTip: "trace de exemplo",
    foot: "Peso é o p95 vezes as execuções, comparado às outras consultas. Comandos de cache ficam de fora porque trazem chaves como ids de sessão.",
    empty: "Nenhum comando de banco no período. Verifique a variável service e se os spans client trazem db.query.text (ou db.statement).",
  },
};

"@@RUNTIME@@";

function normalize(sql, system) {
  let s = String(sql == null ? "" : sql);
  s = s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
  s = s.replace(/'(?:[^'\\]|\\.|'')*'/g, "?").replace(/\$\$[\s\S]*?\$\$/g, "?");
  if (!DOUBLE_QUOTE_IDENTIFIERS.includes(String(system || "").toLowerCase())) s = s.replace(/"(?:[^"\\]|\\.|"")*"/g, "?");
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "?")
    .replace(/\b0x[0-9a-f]+\b/gi, "?").replace(/\bx'[0-9a-f]*'/gi, "?")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "?")
    .replace(/(?<![\w$:@])-?\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/gi, "?")
    .replace(/\b(true|false)\b/gi, "?")
    .replace(/\bIN\s*\(\s*\?(?:\s*,\s*\?)*\s*\)/gi, "IN (?…)")
    .replace(/\bVALUES\s*\(\s*\?(?:\s*,\s*\?)*\s*\)(?:\s*,\s*\(\s*\?(?:\s*,\s*\?)*\s*\))*/gi, "VALUES (?…)")
    .replace(/\s+/g, " ").trim();
  return RT.mask(s);
}
function buildData(d) {
  const S = (d && d.series) || [];
  const tbl = S.find((x) => (x.fields || []).some((y) => /traceid/i.test(y.name)));
  const rows = [];
  if (tbl) { const cols = tbl.fields.map((x) => [x.name, RT.vals(x)]), n = cols.length ? cols[0][1].length : 0; for (let i = 0; i < n; i++) { const o = {}; cols.forEach(([k, v]) => (o[k] = v[i])); rows.push(o); } }
  const pick = (o, re) => { for (const k in o) if (re.test(k)) return o[k]; return undefined; };
  const attr = (r, ...names) => { for (const nm of names) { const re = new RegExp("^(span\\.)?" + nm.replace(/\./g, "\\.") + "$"); const v = RT.nn(pick(r, re)); if (v != null) return v; } return null; };
  const tid = (r) => pick(r, /^traceid/i), dur = (r) => (+pick(r, /^duration$/) || 0) / 1e6;
  const q95 = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]; };
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0];

  const T = {};
  rows.forEach((r) => {
    const id = tid(r); if (!id) return; const o = T[id] || (T[id] = { srv: null, q: [] });
    const text = attr(r, "db.query.text", "db.statement"), system = attr(r, "db.system.name", "db.system");
    if (text) { if (!CACHE_SYSTEMS.includes(String(system || "").toLowerCase())) o.q.push({ sql: normalize(text, system), ms: dur(r), table: attr(r, "db.collection.name", "db.sql.table", "db.mongodb.collection", "db.cosmosdb.container") }); }
    else if (RT.nn(pick(r, /^kind$/)) === "server" && attr(r, "http.route")) o.srv = { route: attr(r, "http.route"), method: attr(r, "http.request.method", "http.method") || "—" };
  });
  const G = {};
  Object.entries(T).forEach(([id, o]) => { if (!o.srv) return;
    o.q.forEach((x) => { const g = G[x.sql] || (G[x.sql] = { sql: x.sql, d: [], rt: {}, tb: {}, max: -1, trace: null });
      g.d.push(x.ms); if (x.ms > g.max) { g.max = x.ms; g.trace = id; }
      const rk = o.srv.method + " " + o.srv.route; g.rt[rk] = (g.rt[rk] || 0) + 1; const tk = x.table || "—"; g.tb[tk] = (g.tb[tk] || 0) + 1; }); });
  const queries = Object.values(G).map((g) => { const r = top(g.rt)[0], sp = r.indexOf(" "), tb = top(g.tb)[0];
    return { sql: g.sql, p95: Math.round(q95(g.d)), max: Math.round(g.max), n: g.d.length, method: r.slice(0, sp), route: r.slice(sp + 1), table: tb === "—" ? null : tb, trace: g.trace }; })
    .sort((a, b) => b.p95 - a.p95).slice(0, MAX_QUERIES);
  const nT = Object.values(T).filter((o) => o.srv).length;
  return { queries, traces: nT, slowMs: RT.num("slow_ms", DEFAULT_SLOW_MS), ds: RT.v("tempo_ds", "") };
}

const fmtMs = (v) => (v >= 1000 ? NF(2).format(v / 1000) + " s" : NF(0).format(v) + " ms");
const KW = /\b(SELECT|FROM|WHERE|AND|OR|LEFT JOIN|RIGHT JOIN|INNER JOIN|OUTER JOIN|JOIN|ON|GROUP BY|ORDER BY|HAVING|LIMIT|OFFSET|COUNT|SUM|MAX|MIN|AVG|OVER|AS|IN|IS|NOT|NULL|UPDATE|SET|INSERT|INTO|VALUES|DESC|ASC|DELETE|DISTINCT|CASE|WHEN|THEN|ELSE|END|LIKE|BETWEEN|EXISTS|UNION|WITH|RETURNING)\b/g;
function hl(sql) { return esc(sql).replace(KW, '<span class="kw">$1</span>').replace(/\?/g, '<span class="ph">?</span>').replace(/(FROM|JOIN|UPDATE|INTO)<\/span> ([\w.`"]+)/g, '$1</span> <span class="tb">$2</span>'); }

function render(root, D) {
  const slow = D.slowMs, st = (v) => (v < slow * 0.3 ? "var(--accent)" : v < slow ? "var(--warn)" : "var(--bad)");
  const qs = D.queries, max = Math.max(...qs.map((q) => q.max || q.p95), 1);
  const slowN = qs.filter((q) => q.p95 >= slow).length, tot = qs.reduce((a, q) => a + q.p95 * q.n, 0), topShare = qs[0] && tot ? ((qs[0].p95 * qs[0].n) / tot) * 100 : 0;
  const rows = qs.map((q, i) => { const href = RT.exploreTrace(D.ds, q.trace, TRACE_LINK_FROM); return `<div class="q">
    <span class="rk">${i + 1}</span>
    <div><div class="sql" title="${esc(q.sql)}">${hl(q.sql)}</div>
      <div class="meta"><span class="tag"><span class="m ${esc(q.method)}">${esc(q.method)}</span><i>${esc(q.route)}</i></span><span class="tag">${esc(t("table"))} <i>${esc(q.table == null ? "—" : q.table)}</i></span><span class="tag">${esc(t("runs"))} <i class="num">${NF(0).format(q.n)}</i></span></div></div>
    <div class="d"><div class="v"><b class="num" style="color:${q.p95 >= slow ? "var(--bad)" : "var(--text)"}">${fmtMs(q.p95)}</b><span class="num">${esc(t("max"))} ${fmtMs(q.max)}</span></div>
      <div class="t"><div class="f" style="width:${((q.p95 / max) * 100).toFixed(1)}%;background:${st(q.p95)}"></div><div class="mx" style="left:calc(${((q.max / max) * 100).toFixed(1)}% - 2px)"></div></div></div>
    ${href ? `<a class="tr" href="${esc(href)}" target="_blank" rel="noopener" title="${esc(t("traceTip"))}">${esc(String(q.trace).slice(0, 10))}… ↗</a>` : `<span class="tr">${esc(String(q.trace).slice(0, 10))}…</span>`}</div>`; }).join("");
  root.innerHTML = `<div class="hdr"><div><h2>${esc(t("title"))}</h2><div class="sub">${esc(t("sub", t("based", NF(0).format(D.traces))))}</div></div>
    <div class="stats"><div class="stat"><div class="l">${esc(t("statDistinct"))}</div><div class="v num">${qs.length}</div></div>
      <div class="stat"><div class="l">${esc(t("statSlow", fmtMs(slow)))}</div><div class="v num" style="color:var(--bad)">${slowN}</div></div>
      <div class="stat"><div class="l">${esc(t("statWorst"))}</div><div class="v num">${qs[0] ? fmtMs(qs[0].p95) : "—"}</div></div>
      <div class="stat"><div class="l">${esc(t("statWeight"))}</div><div class="v num">${NF(0).format(topShare)}%<span style="font-size:12px;color:var(--muted)">${esc(t("ofTime"))}</span></div></div></div></div>
    <div class="list"><div class="q h"><span>${esc(t("colN"))}</span><span>${esc(t("colQuery"))}</span><span>${esc(t("colP95"))}</span><span>${esc(t("colTrace"))}</span></div>${rows}</div>
    <div class="foot">${esc(t("foot"))}</div>`;
}

RT.run("#bq-root", buildData, render, (D) => !D.queries.length, "empty");

"@@FONTS@@";
