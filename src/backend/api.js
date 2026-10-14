/* Backend overview: OpenTelemetry traces in Tempo, read with TraceQL Metrics.
   Every route, dependency, caller and number below comes from this panel's queries at render time.
   Service, frontend service, internal hosts, slow threshold, aliases and language come from dashboard variables. */

/* ===================== CONSTANTS (defaults) ===================== */
const MAX_ROUTES = 12;        // rows in "Busiest routes"
const MAX_SLOW = 8;           // rows in "Slowest routes"
const MAX_GROUPS = 8;         // rows in "Load by route group"
const MAX_ERRORS = 8;         // rows in "5xx errors"
const MAX_CALLERS = 4;        // inbound sources drawn on the map; the rest is summed into "Others"
const MAX_DATA = 4;           // databases drawn on the map
const MAX_INTERNAL = 4;       // internal services drawn on the map
const MAX_EXTERNAL = 5;       // external hosts drawn on the map
const DEFAULT_SLOW_MS = 1000; // used when the slow_ms variable is empty; p95 at or above it is "slow"
const FEW_REQUESTS = 20;      // routes with fewer requests than this get a "few samples" hint
const REFRESH_SEC = 300;      // expected refresh interval; data older than 3x this is flagged as stale
const ERR_RATE_BAD = 1;       // % of 5xx responses that turns the header red
const DEP_ERR_BAD = 50;       // % of failed calls that marks a dependency as failing
const DEP_ERR_WARN = 5;       // % of failed calls that marks a dependency as degraded
/* display names for well-known semantic-convention values (db.system, messaging.system, rpc.system, process.runtime.name) */
const KNOWN_NAMES = {
  mysql: "MySQL", mariadb: "MariaDB", postgresql: "PostgreSQL", mssql: "SQL Server", "microsoft.sql_server": "SQL Server", oracle: "Oracle", "oracle.db": "Oracle",
  sqlite: "SQLite", redis: "Redis", valkey: "Valkey", memcached: "Memcached", mongodb: "MongoDB", cassandra: "Cassandra", elasticsearch: "Elasticsearch",
  opensearch: "OpenSearch", dynamodb: "DynamoDB", "aws.dynamodb": "DynamoDB", couchbase: "Couchbase", neo4j: "Neo4j", clickhouse: "ClickHouse", cockroachdb: "CockroachDB",
  kafka: "Kafka", rabbitmq: "RabbitMQ", nats: "NATS", aws_sqs: "Amazon SQS", "aws.sqs": "Amazon SQS", gcp_pubsub: "Pub/Sub", servicebus: "Service Bus", pulsar: "Pulsar", "socket.io": "Socket.IO",
  grpc: "gRPC", "connect_rpc": "Connect RPC", dotnet_wcf: "WCF", java_rmi: "Java RMI",
  nodejs: "Node.js", node: "Node.js", cpython: "CPython", python: "Python", go: "Go", java: "Java", dotnet: ".NET", ruby: "Ruby", php: "PHP", rust: "Rust", cpp: "C++", erlang: "Erlang", swift: "Swift", webjs: "JavaScript",
};

/* ===================== TEXTS (lang variable: en | pt-BR) ===================== */
const I18N = {
  en: {
    subtitle: "Backend instrumented with OpenTelemetry",
    healthOk: "Operating normally", healthBad: "Errors above normal", healthDeps: (n) => `Operating, with ${n} failing ${n > 1 ? "dependencies" : "dependency"}`,
    stale: "Stale data", staleHint: (a) => `${a}, check collection`, noRecent: "no recent data", updSec: (s) => `updated ${s} s ago`, updMin: (m) => `updated ${m} min ago`,
    last: (n, u) => `Last ${n === 1 ? "" : n + " "}${u}`, units: { m: ["minute", "minutes"], h: ["hour", "hours"], d: ["day", "days"], w: ["week", "weeks"] },
    kRpm: "Requests per minute", k5xx: "5xx errors", kP95: "p95 latency", kDep: "Cumulative time in dependencies",
    flowTitle: "Where each request goes", flowHint: "Line width is proportional to call volume.", callersHead: "Callers", groupData: "Data", groupInternal: "Internal services", groupExternal: "External",
    reqMin: "req/min", perMin: "/min", routes: "routes", groups: "route groups", p95: "p95",
    callerBrowser: "Browser", callerVia: (s) => `via ${s}`, callerDirect: "No upstream trace", callerDirectKind: "jobs, scripts, untraced clients", callerUnknown: "Unknown origin",
    callerUnknownKind: "root span not received", callerUpstream: "upstream service", callerConsumer: "message consumer", callerRpc: "RPC server", callerOthers: "Others", callerOthersKind: (n) => `${n} more sources`,
    kindDatabase: "database", kindMessaging: "messaging", depOk: "normal", depWarn: "slow", depBad: "failing", errPct: (p) => `${p}% errors`,
    noteNoResponse: "no HTTP response (connection failure)", noteHttp: (c) => `HTTP ${c}`, note4xx: " (4xx is not counted as an error)",
    noDeps: "No outgoing calls found. Dependencies appear when client spans carry db.system / db.system.name, messaging.system or server.address.",
    noCallers: "No inbound traffic found for the map.", badRegex: "internal_hosts_regex is not a valid regular expression; every host is shown as External.",
    badOverrides: "name_overrides is not valid JSON; aliases were ignored.",
    routesTitle: "Busiest routes", routesHint: "Bar shows p95", colRoute: "Route", colRpm: "req/min", colP99: "p99", colErr: "Errors", colTrend: "Trend",
    slowTitle: "Slowest routes", slowHint: "Approximate p95, with request count", onlyReq: (n) => `only ${n} req`, req: (n) => `${n} req`,
    groupsTitle: "Load by route group", groupsHint: "req/min",
    errTitle: "5xx errors", errHint: "by route", errN: (n) => `${n} ${n > 1 ? "errors" : "error"}`, errOf: (n) => ` in ${n} requests`, noErrors: "No 5xx responses in the period.",
    mapAria: "Request flow map", depAria: (n, k, c, p, s) => `${n}, ${k}: ${c} calls per minute, p95 ${p}, ${s}`, noValue: "no data",
  },
  pt: {
    subtitle: "Back-end instrumentado com OpenTelemetry",
    healthOk: "Operando normalmente", healthBad: "Erros acima do normal", healthDeps: (n) => `Operando, com ${n} dependência${n > 1 ? "s" : ""} falhando`,
    stale: "Dados desatualizados", staleHint: (a) => `${a}, verifique a coleta`, noRecent: "sem dados recentes", updSec: (s) => `atualizado há ${s} s`, updMin: (m) => `atualizado há ${m} min`,
    last: (n, u) => (n === 1 ? `Última ${u}` : `Últimas ${n} ${u}`), units: { m: ["minuto", "minutos"], h: ["hora", "horas"], d: ["dia", "dias"], w: ["semana", "semanas"] },
    kRpm: "Requisições por minuto", k5xx: "Erros 5xx", kP95: "Latência p95", kDep: "Tempo acumulado em dependências",
    flowTitle: "Por onde passa cada requisição", flowHint: "Espessura proporcional ao volume de chamadas.", callersHead: "Quem chama", groupData: "Dados", groupInternal: "Serviços internos", groupExternal: "Externos",
    reqMin: "req/min", perMin: "/min", routes: "rotas", groups: "grupos de rotas", p95: "p95",
    callerBrowser: "Navegador", callerVia: (s) => `via ${s}`, callerDirect: "Sem trace de origem", callerDirectKind: "jobs, scripts, clientes sem trace", callerUnknown: "Origem desconhecida",
    callerUnknownKind: "span raiz não recebido", callerUpstream: "serviço de origem", callerConsumer: "consumidor de mensagens", callerRpc: "servidor RPC", callerOthers: "Outros", callerOthersKind: (n) => `mais ${n} origens`,
    kindDatabase: "banco de dados", kindMessaging: "mensageria", depOk: "normal", depWarn: "lenta", depBad: "falhando", errPct: (p) => `${p}% erro`,
    noteNoResponse: "sem resposta HTTP (falha de conexão)", noteHttp: (c) => `HTTP ${c}`, note4xx: " (4xx não conta como erro)",
    noDeps: "Nenhuma chamada de saída encontrada. As dependências aparecem quando os spans client trazem db.system / db.system.name, messaging.system ou server.address.",
    noCallers: "Nenhum tráfego de entrada encontrado para o mapa.", badRegex: "internal_hosts_regex não é uma expressão regular válida; todos os hosts aparecem como Externos.",
    badOverrides: "name_overrides não é um JSON válido; os apelidos foram ignorados.",
    routesTitle: "Rotas com mais tráfego", routesHint: "Barra mostra o p95", colRoute: "Rota", colRpm: "req/min", colP99: "p99", colErr: "Erros", colTrend: "Tendência",
    slowTitle: "Rotas mais lentas", slowHint: "p95 aproximado, com número de requisições", onlyReq: (n) => `só ${n} req`, req: (n) => `${n} req`,
    groupsTitle: "Carga por grupo de rotas", groupsHint: "req/min",
    errTitle: "Erros 5xx", errHint: "por rota", errN: (n) => `${n} ${n > 1 ? "erros" : "erro"}`, errOf: (n) => ` em ${n} requisições`, noErrors: "Nenhuma resposta 5xx no período.",
    mapAria: "Mapa de fluxo das requisições", depAria: (n, k, c, p, s) => `${n}, ${k}: ${c} chamadas por minuto, p95 ${p}, ${s}`, noValue: "sem dado",
  },
};

/*@@RUNTIME@@*/

/* ===================== DATA: buildData(data) ===================== */
/* The Tempo datasource renames metric frames, so each frame is recognised by the intrinsic labels its query groups by:
   kind, status, resource.service.name and rootServiceName are never empty, and each query uses a different combination. */
const MARKERS = ["kind", "resource.service.name", "rootServiceName", "status"];
function buildData(d) {
  const S = (d && d.series) || [];
  const SERVICE = RT.v("service", ""), FRONT = RT.v("frontend_service", "").trim(), SLOW = RT.num("slow_ms", DEFAULT_SLOW_MS);
  const rawRe = RT.v("internal_hosts_regex", "").trim();
  let INTERNAL = null, badRegex = false;
  if (rawRe) { try { INTERNAL = new RegExp(rawRe, "i"); } catch (e) { badRegex = true; } }
  const rawOv = RT.v("name_overrides", "").trim(), ALIAS = RT.json("name_overrides", {});
  const badOverrides = !!rawOv && rawOv !== "{}" && !Object.keys(ALIAS).length;
  const alias = (...keys) => { for (const k of keys) { const a = k != null && ALIAS[k]; if (a) return typeof a === "string" ? { name: a } : a; } return null; };

  const isTable = (f) => (f.fields || []).some((x) => /traceid/i.test(x.name));
  const frames = S.filter((f) => f.name !== "exemplar" && f.refId !== "streaming-progress" && !isTable(f)).map((f) => {
    const tf = f.fields.find((x) => x.type === "time"), vf = f.fields.find((x) => x.type === "number"), labels = {};
    Object.entries((vf && vf.labels) || {}).forEach(([k, v]) => { if (k !== "__name__") labels[k] = RT.unq(v); });
    return { labels, range: !!vf && vf.name !== "value", t: tf ? RT.vals(tf) : [], v: vf ? RT.vals(vf).map((x) => (x == null ? null : +x)) : [] };
  });
  const kindOf = (s) => {
    const keys = Object.keys(s.labels), m = MARKERS.filter((x) => keys.includes(x)).join(","), p = keys.includes("p"), k = s.labels.kind;
    if (m === "kind") return p ? (s.range ? "KP" : k === "server" ? "PI" : "DP") : (k === "server" ? "DS" : "DC") + (s.range ? "" : "I");
    if (m === "kind,status") return s.range ? "KR" : "DN";
    if (m === "status") return s.range ? "RT" : "RN";
    if (m === "resource.service.name") return p ? "RQ" : "CB";
    if (m === "resource.service.name,rootServiceName") return "CB";
    if (m === "kind,resource.service.name") return "CN";
    if (m === "" && !p && !s.range) return "ST";
    return null;
  };
  const G = {}; frames.forEach((s) => { const c = kindOf(s); if (c) (G[c] || (G[c] = [])).push(s); });
  const grp = (c) => G[c] || [];
  const last = (s) => { for (let i = s.v.length - 1; i >= 0; i--) if (s.v[i] != null && !isNaN(s.v[i])) return s.v[i]; return null; };
  const one = (c) => { const s = grp(c)[0]; return s ? last(s) : null; };
  const L = (l, ...k) => { for (const x of k) { const v = RT.nn(l[x]); if (v != null) return v; } return null; };
  const method = (l) => L(l, "span.http.request.method", "span.http.method");
  const code = (l) => { const c = L(l, "span.http.response.status_code", "span.http.status_code"); return c == null ? null : +c; };
  const sumBy = (list, keep) => { const T = {}; list.forEach((s) => { if (keep && !keep(s)) return; s.t.forEach((t, i) => { T[t] = (T[t] || 0) + (s.v[i] || 0); }); }); return T; };
  const q = (arr, p) => { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };

  /* time window */
  const tr = d && d.timeRange, from = tr && tr.from ? +tr.from.valueOf() : null, to = tr && tr.to ? +tr.to.valueOf() : null;
  const MIN = from && to ? Math.max(1, (to - from) / 60000) : null;
  const raw = (d && d.request && d.request.rangeRaw) || (tr && tr.raw) || {};
  const rm = String(raw.from || "").match(/^now-(\d+)([mhdw])$/), U = t("units");
  const range = rm && String(raw.to || "now") === "now" ? t("last", +rm[1], U[rm[2]][+rm[1] === 1 ? 0 : 1])
    : from && to ? new Date(from).toLocaleString(RT.locale) + " – " + new Date(to).toLocaleString(RT.locale) : null;
  const ended = d && d.request && (d.request.endTime || d.request.startTime);
  const updatedSecAgo = ended ? Math.max(0, Math.round((Date.now() - ended) / 1000)) : null;
  let refreshSec = REFRESH_SEC;
  try { const r = new URLSearchParams(location.search).get("refresh"), mm = r && r.match(/^(\d+)([smh])$/); if (mm) refreshSec = +mm[1] * { s: 1, m: 60, h: 3600 }[mm[2]]; } catch (e) {}

  /* routes: count by route + method + status code */
  const R = {};
  const route = (l) => { const k = (method(l) || "") + " " + l["span.http.route"]; return R[k] || (R[k] = { method: method(l) || "—", route: l["span.http.route"], n: 0, e5: 0, p95: null, p99: null, trend: [] }); };
  grp("RN").forEach((s) => { if (!s.labels["span.http.route"]) return; const r = route(s.labels), v = last(s) || 0; r.n += v; if (code(s.labels) >= 500) r.e5 += v; });
  grp("RQ").forEach((s) => { if (!s.labels["span.http.route"]) return; const r = route(s.labels), p = +s.labels.p, v = last(s); if (p === 0.95) r.p95 = v == null ? null : v * 1000; if (p === 0.99) r.p99 = v == null ? null : v * 1000; });
  grp("RT").forEach((s) => { if (!s.labels["span.http.route"]) return; const r = route(s.labels); s.v.forEach((x, i) => { r.trend[i] = (r.trend[i] || 0) + (x || 0); }); });
  const RL = Object.values(R).filter((r) => r.route && r.n > 0);
  const total = RL.reduce((a, r) => a + r.n, 0), tot5 = RL.reduce((a, r) => a + r.e5, 0);
  const rpm = MIN && total ? total / MIN : null, err = total ? (tot5 / total) * 100 : null;
  const p95 = ((v) => (v == null ? null : v * 1000))(one("PI"));
  const depI = ((c) => { const s = one("DSI"); return c == null || !s ? null : (c / s) * 100; })(one("DCI"));

  /* KPI series */
  const KA = sumBy(grp("KR")), K5 = sumBy(grp("KR"), (s) => code(s.labels) >= 500), ts = Object.keys(KA).map(Number).sort((a, b) => a - b);
  const kp = grp("KP")[0], dc = grp("DC")[0], ds = grp("DS")[0];
  const at = (s, t) => { if (!s) return null; const i = s.t.indexOf(t); return i < 0 ? null : s.v[i]; };
  const kpis = [
    { label: t("kRpm"), value: rpm, unit: "", dec: 0, delta: null, spark: ts.map((x) => KA[x] * 60) },
    { label: t("k5xx"), value: err, unit: "%", dec: 2, delta: null, spark: ts.map((x) => (KA[x] ? ((K5[x] || 0) / KA[x]) * 100 : 0)) },
    { label: t("kP95"), value: p95, unit: "ms", dec: 0, delta: null, spark: kp ? kp.v.map((x) => (x || 0) * 1000) : [] },
    { label: t("kDep"), value: depI, unit: "%", dec: 0, delta: null, spark: ds ? ds.t.map((x, i) => { const c = at(dc, x), v = ds.v[i]; return v ? ((c || 0) / v) * 100 : 0; }) : [] },
  ];

  /* route groups: first static path segment of http.route */
  const GR = {};
  RL.forEach((r) => { const seg = String(r.route).split("/").filter(Boolean)[0] || "", g = "/" + (seg && !/^[:{*<]/.test(seg) ? seg : ""); GR[g] = (GR[g] || 0) + r.n; });
  const groups = Object.entries(GR).sort((a, b) => b[1] - a[1]);

  /* callers: root service of each trace that reached a route, plus non-HTTP inbound spans */
  const C = {};
  const addCaller = (key, o, n) => { if (!n) return; const c = C[key] || (C[key] = { ...o, n: 0 }); c.n += n; };
  grp("CB").forEach((s) => {
    const root = RT.nn(s.labels.rootServiceName), n = last(s) || 0, a = alias(root);
    if (FRONT && root === FRONT) addCaller("browser", { name: t("callerBrowser"), kind: t("callerVia", FRONT) }, n);
    else if (root && root === SERVICE) addCaller("direct", { name: t("callerDirect"), kind: t("callerDirectKind") }, n);
    else if (!root) addCaller("unknown", { name: t("callerUnknown"), kind: t("callerUnknownKind") }, n);
    else addCaller("svc:" + root, { name: (a && a.name) || root, kind: (a && a.kind) || t("callerUpstream") }, n);
  });
  grp("CN").forEach((s) => {
    const m = L(s.labels, "span.messaging.system"), r = L(s.labels, "span.rpc.system"), n = last(s) || 0, sys = m || r || s.labels.kind, a = alias(sys);
    addCaller((m ? "msg:" : "rpc:") + sys, { name: (a && a.name) || KNOWN_NAMES[sys] || sys, kind: (a && a.kind) || (m ? t("callerConsumer") : t("callerRpc")) }, n);
  });
  let callers = Object.values(C).sort((a, b) => b.n - a.n);
  if (callers.length > MAX_CALLERS) {
    const rest = callers.slice(MAX_CALLERS - 1);
    callers = callers.slice(0, MAX_CALLERS - 1).concat([{ name: t("callerOthers"), kind: t("callerOthersKind", rest.length), n: rest.reduce((a, c) => a + c.n, 0) }]);
  }
  callers = MIN ? callers.map((c) => ({ ...c, rpm: c.n / MIN })) : [];

  /* dependencies: client and producer spans, grouped by database, messaging system or host */
  const depOf = (l) => {
    const db = L(l, "span.db.system.name", "span.db.system");
    if (db) { const a = alias(db); return { key: "db:" + db, group: "data", name: (a && a.name) || KNOWN_NAMES[db] || db, kind: (a && a.kind) || t("kindDatabase") }; }
    const msg = L(l, "span.messaging.system");
    if (msg) { const a = alias(msg); return { key: "msg:" + msg, group: "internal", name: (a && a.name) || KNOWN_NAMES[msg] || msg, kind: (a && a.kind) || t("kindMessaging") }; }
    const peer = L(l, "span.peer.service"), host = L(l, "span.server.address") || peer;
    if (!host) return null;
    const rpc = L(l, "span.rpc.system"), a = alias(host, peer), internal = !!INTERNAL && (INTERNAL.test(host) || (!!peer && INTERNAL.test(peer)));
    return { key: "host:" + host, group: internal ? "internal" : "external", name: (a && a.name) || host, kind: (a && a.kind) || (rpc ? KNOWN_NAMES[rpc] || rpc : "HTTP"), host: true };
  };
  const DEP = {}, why = {};
  grp("DN").forEach((s) => {
    const o = depOf(s.labels); if (!o) return;
    const v = last(s) || 0, c = code(s.labels), isErr = s.labels.status === "error", x = DEP[o.key] || (DEP[o.key] = { ...o, n: 0, e: 0, p95: null });
    x.n += v; if (isErr && (c == null || c >= 500)) x.e += v;
    if (isErr && v > 0 && o.host) (why[o.key] || (why[o.key] = {}))[c == null ? "none" : String(c)] = 1;
  });
  grp("DP").forEach((s) => { const o = depOf(s.labels); if (o && DEP[o.key]) { const v = last(s); if (v != null) DEP[o.key].p95 = Math.max(DEP[o.key].p95 || 0, v * 1000); } });
  const note = (k) => { const w = why[k]; if (!w) return undefined; const cs = Object.keys(w).sort();
    return cs.map((c) => (c === "none" ? t("noteNoResponse") : t("noteHttp", c))).join(", ") + (cs.some((c) => c !== "none" && +c < 500) ? t("note4xx") : ""); };
  const mk = (o, g) => ({ group: g, name: o.name, kind: o.kind, cpm: MIN ? o.n / MIN : 0, p95: o.p95, err: o.n ? Math.min(100, (o.e / o.n) * 100) : 0, note: note(o.key) });
  const list = (g, max) => Object.values(DEP).filter((o) => o.group === g && o.n > 0).sort((a, b) => b.n - a.n).slice(0, max);
  const deps = [].concat(list("data", MAX_DATA).map((o) => mk(o, t("groupData"))), list("internal", MAX_INTERNAL).map((o) => mk(o, t("groupInternal"))), list("external", MAX_EXTERNAL).map((o) => mk(o, t("groupExternal"))));

  /* runtime shown in the central card: resource attributes of the service */
  const st = grp("ST").slice().sort((a, b) => (last(b) || 0) - (last(a) || 0))[0];
  const stack = st ? (() => { const l = st.labels, rn = RT.nn(l["resource.process.runtime.name"]), rv = RT.nn(l["resource.process.runtime.version"]), lg = RT.nn(l["resource.telemetry.sdk.language"]);
    const name = KNOWN_NAMES[rn] || KNOWN_NAMES[lg] || rn || lg; return name ? name + (rv ? " " + rv : "") : null; })() : null;

  return {
    service: SERVICE, front: FRONT, slowMs: SLOW, range, updatedSecAgo, refreshSec, kpis,
    core: { err, stack, routes: new Set(RL.map((r) => r.route)).size, groups: groups.length },
    callers, deps, notes: { badRegex, badOverrides },
    routes: RL.slice().sort((a, b) => b.n - a.n).slice(0, MAX_ROUTES).map((r) => [r.method, r.route, MIN ? r.n / MIN : null, r.p95, r.p99, r.n ? (r.e5 / r.n) * 100 : 0, r.trend]),
    slow: RL.filter((r) => r.p95 != null).sort((a, b) => b.p95 - a.p95).slice(0, MAX_SLOW).map((r) => [r.method, r.route, r.p95, r.n]),
    groups: groups.slice(0, MAX_GROUPS).map(([g, n]) => [g, MIN ? Math.round((n / MIN) * 10) / 10 : null]),
    errors: RL.filter((r) => r.e5 > 0).sort((a, b) => b.e5 - a.e5).slice(0, MAX_ERRORS).map((r) => [r.method, r.route, r.e5, r.n]),
  };
}

/* ===================== HELPERS ===================== */
const ms = (v) => (v == null ? "—" : v >= 1000 ? NF(2).format(v / 1000) + " s" : NF(0).format(v) + " ms");
const rate = (v) => (v == null ? "—" : v > 0 && v < 0.1 ? "<" + NF(1).format(0.1) : v >= 10 ? NF(0).format(v) : NF(1).format(v));
const C = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)", blue: "var(--blue)" };
const HEX = { ok: "#3ED598", warn: "#F5A800", bad: "#FF6B6B", blue: "#5B7BFF" };
let SLOW_MS = DEFAULT_SLOW_MS;
const lat = (v) => (v == null ? "blue" : v < SLOW_MS * 0.3 ? "ok" : v < SLOW_MS ? "warn" : "bad");
const depSt = (d) => (d.err >= DEP_ERR_BAD ? "bad" : d.err >= DEP_ERR_WARN || (d.p95 != null && d.p95 >= SLOW_MS) ? "warn" : "ok");
const depTxt = (s) => t(s === "ok" ? "depOk" : s === "warn" ? "depWarn" : "depBad");
let UID = 0;
function spark(v, w, h, col) {
  if (!v || !v.length) return "";
  const max = Math.max(...v) * 1.08 || 1, min = Math.min(...v) * 0.92, x = (i) => (i * w) / (v.length - 1 || 1), y = (q) => h - ((q - min) / (max - min || 1)) * (h - 4) - 2;
  const d = v.map((q, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(q).toFixed(1)).join(" "), id = "s" + ++UID;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".22"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    <path d="${d} L${w} ${h} L0 ${h}Z" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${col}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}
const route = (m, p) => `<span class="m">${esc(m)}</span>${esc(p)}`;
const note = (txt) => `<p class="note">${esc(txt)}</p>`;

/* ===================== SECTIONS ===================== */
function head(D) {
  const bad = D.deps.filter((d) => depSt(d) === "bad"), st = D.core.err >= ERR_RATE_BAD ? "bad" : bad.length ? "warn" : "ok";
  const txt = st === "ok" ? t("healthOk") : st === "bad" ? t("healthBad") : t("healthDeps", bad.length);
  const age = D.updatedSecAgo, stale = age == null || age > D.refreshSec * 3;
  const ageTxt = age == null ? t("noRecent") : age < 60 ? t("updSec", age) : t("updMin", Math.round(age / 60));
  return `<div class="top"><div class="id"><div class="logo"><img src="${logoSrc()}" alt="OpenTelemetry"></div><div><h1>${esc(D.service)}</h1><div class="tag">${esc(t("subtitle"))}</div></div></div>
    <div class="state"><div class="hs"><span class="health"><span class="dot" style="background:${stale ? C.warn : C[st]};box-shadow:0 0 0 5px ${HEX[stale ? "warn" : st]}24"></span>${esc(stale ? t("stale") : txt)}</span>
      <span class="fresh${stale ? " stale" : ""}">${esc(stale ? t("staleHint", ageTxt) : ageTxt)}</span></div><span class="range">${esc(D.range == null ? "—" : D.range)}</span></div></div>`;
}
function kpis(D) {
  return `<div class="kpis">${D.kpis.map((k) => `<div class="kpi"><div class="l">${esc(k.label)}</div><div class="row"><span class="big n">${k.value == null ? "—" : NF(k.dec).format(k.value)}${k.unit && k.value != null ? `<small>${k.unit}</small>` : ""}</span>
      <span class="d n" style="color:var(--muted)">—</span></div>${spark(k.spark, 300, 34, "#5B7BFF")}</div>`).join("")}</div>`;
}
function flow(D) {
  const W = 1600, groups = [...new Set(D.deps.map((d) => d.group))];
  const ROW = 46, GH = 34, top = 26; let y = top; const rows = [];
  groups.forEach((g) => { rows.push({ g, y: y + 20 }); y += GH; D.deps.filter((d) => d.group === g).forEach((d) => { rows.push({ d, y: y + ROW / 2 }); y += ROW; }); y += 6; });
  const H = Math.max(y + 10, 440), cy = H / 2, CX = 725, NW = 220, NH = 150, NL = CX - NW / 2, NR = CX + NW / 2, NY = cy - NH / 2;
  const maxL = Math.log10(Math.max(...D.deps.map((d) => d.cpm), ...D.callers.map((c) => c.rpm), 1) + 1);
  const wOf = (v) => 1.4 + (7 * Math.log10(v + 1)) / maxL;
  let paths = "", pts = "", labels = "";
  const cTop = cy - ((D.callers.length - 1) * 96) / 2;
  D.callers.forEach((c, i) => {
    const yy = cTop + i * 96, x1 = 330, y2 = cy - 44 + i * (88 / Math.max(1, D.callers.length - 1)), x2 = NL, w = wOf(c.rpm);
    const p = `M${x1} ${yy} C ${x1 + 150} ${yy}, ${x2 - 150} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
    paths += `<path d="${p}" fill="none" stroke="#5B7BFF" stroke-opacity=".38" stroke-width="${w.toFixed(1)}" stroke-linecap="round"/>`;
    const n = Math.max(1, Math.min(6, Math.round(c.rpm / 60))); for (let k = 0; k < n; k++) pts += `<circle r="2.6" fill="#AFC0FF"><animateMotion dur="${(3.2 - (1.6 * Math.log10(c.rpm + 1)) / maxL).toFixed(2)}s" begin="-${(k * 0.9 + 0.3).toFixed(1)}s" repeatCount="indefinite" path="${p}"/></circle>`;
    labels += `<g transform="translate(40,${yy})"><text y="-6" class="nm" font-size="16" fill="#ECEFFA">${esc(c.name)}</text>
      <text y="14" class="lbl">${esc(c.kind)}</text><text x="282" y="-6" text-anchor="end" class="nm" font-size="16" fill="#ECEFFA" style="font-variant-numeric:tabular-nums">${rate(c.rpm)}</text>
      <text x="282" y="14" text-anchor="end" class="lbl">${esc(t("reqMin"))}</text></g>`;
  });
  const depRows = rows.filter((r) => r.d), n = depRows.length;
  rows.forEach((r) => {
    if (r.g) { labels += `<text x="1080" y="${r.y}" class="lbl" style="fill:#838DB5">${esc(r.g)}</text>`; return; }
    const d = r.d, st = depSt(d), i = depRows.indexOf(r), y1 = cy - 56 + (i * 112) / (n - 1 || 1), x1 = NR, x2 = 1060, y2 = r.y, w = wOf(d.cpm);
    const p = `M${x1.toFixed(1)} ${y1.toFixed(1)} C ${x1 + 170} ${y1.toFixed(1)}, ${x2 - 170} ${y2}, ${x2} ${y2}`;
    paths += `<path d="${p}" fill="none" stroke="${HEX[st === "ok" ? "blue" : st]}" stroke-opacity="${st === "ok" ? 0.38 : 0.75}" stroke-width="${w.toFixed(1)}" stroke-linecap="round" ${st === "bad" ? 'stroke-dasharray="6 6"' : ""}/>`;
    if (st !== "bad") { const k = Math.max(1, Math.min(4, Math.round(Math.log10(d.cpm + 1) * 1.3)));
      for (let j = 0; j < k; j++) pts += `<circle r="2.6" fill="${st === "warn" ? "#FFD36B" : "#AFC0FF"}"><animateMotion dur="${(3.4 - (1.8 * Math.log10(d.cpm + 1)) / maxL).toFixed(2)}s" begin="-${(j * 0.85 + 0.2).toFixed(1)}s" repeatCount="indefinite" path="${p}"/></circle>`; }
    else { pts += `<circle r="3" fill="#FF6B6B"><animateMotion dur="1.6s" repeatCount="indefinite" keyPoints="0;0.85" keyTimes="0;1" calcMode="linear" path="${p}"/><animate attributeName="opacity" values="1;1;0" keyTimes="0;.8;1" dur="1.6s" repeatCount="indefinite"/></circle>
      <g transform="translate(${x2 - 14},${y2})"><circle r="9" fill="#2A1830" stroke="#FF6B6B"/><path d="M-3.5 -3.5 L3.5 3.5 M3.5 -3.5 L-3.5 3.5" stroke="#FF6B6B" stroke-width="1.8" stroke-linecap="round"/></g>`; }
    const stTxt = st === "bad" ? t("errPct", NF(0).format(d.err)) : depTxt(st);
    labels += `<g class="dep" tabindex="0" role="listitem" aria-label="${esc(t("depAria", d.name, d.kind, rate(d.cpm), d.p95 == null ? t("noValue") : ms(d.p95), stTxt + (d.note && st === "bad" ? " (" + d.note + ")" : "")))}" transform="translate(1080,${y2})"><title>${esc(d.name + (d.note ? ": " + d.note : ""))}</title>
      <rect class="fr" x="-10" y="-20" width="520" height="44" rx="8" fill="transparent"/>
      <line x1="0" x2="500" y1="${ROW / 2}" y2="${ROW / 2}" stroke="#27315A"/>
      <text y="-1" class="nm" font-size="15" fill="#ECEFFA">${esc(d.name.length > 30 ? d.name.slice(0, 29) + "…" : d.name)}</text>
      <text y="16" class="lbl"${st === "bad" ? ' style="fill:#FF8A8A"' : ""}>${esc(st === "bad" && d.note ? d.note : d.kind)}</text>
      <text x="300" y="5" text-anchor="end" class="nm" font-size="15" fill="#ECEFFA" style="font-variant-numeric:tabular-nums">${rate(d.cpm)}<tspan class="lbl" dx="4">${esc(t("perMin"))}</tspan></text>
      <text x="400" y="5" text-anchor="end" font-size="13" fill="${st === "warn" && d.p95 >= SLOW_MS ? "#F5A800" : "#9099BF"}" style="font-variant-numeric:tabular-nums">${d.p95 == null ? "—" : ms(d.p95)}</text>
      <text x="500" y="5" text-anchor="end" font-size="13" font-weight="500" fill="${HEX[st === "ok" ? "ok" : st]}">${esc(stTxt)}</text></g>`;
  });
  labels += `<text x="40" y="${top + 8}" class="lbl" style="fill:#838DB5">${esc(t("callersHead"))}</text>${D.deps.length ? `<text x="1480" y="${top + 8}" text-anchor="end" class="lbl" style="fill:#838DB5">${esc(t("p95"))}</text>` : ""}`;
  const core = `<g>
    <rect x="${NL}" y="${NY}" width="${NW}" height="${NH}" rx="22" fill="url(#coreg)" stroke="#5B7BFF" stroke-opacity=".55"/>
    <circle cx="${NL + 26}" cy="${NY + 34}" r="4.5" fill="${D.core.err >= ERR_RATE_BAD ? "#FF6B6B" : "#3ED598"}"/>
    <text x="${NL + 40}" y="${NY + 40}" class="nm" font-size="19" fill="#FFFFFF">${esc(D.service.length > 16 ? D.service.slice(0, 15) + "…" : D.service)}</text>
    <text x="${NL + 22}" y="${NY + 62}" font-size="12" fill="#9FAEE8">${esc(D.core.stack || "")}</text>
    <line x1="${NL + 22}" x2="${NR - 22}" y1="${NY + 84}" y2="${NY + 84}" stroke="#FFFFFF" stroke-opacity=".1"/>
    <text x="${NL + 22}" y="${NY + 112}" class="nm" font-size="15" fill="#ECEFFA">${D.core.routes}</text>
    <text x="${NL + 22}" y="${NY + 129}" font-size="12" fill="#8A97CC">${esc(t("routes"))}</text>
    <text x="${NL + 112}" y="${NY + 112}" class="nm" font-size="15" fill="#ECEFFA">${D.core.groups}</text>
    <text x="${NL + 112}" y="${NY + 129}" font-size="12" fill="#8A97CC">${esc(t("groups"))}</text></g>`;
  const notes = [!D.deps.length && t("noDeps"), !D.callers.length && t("noCallers"), D.notes.badRegex && t("badRegex"), D.notes.badOverrides && t("badOverrides")].filter(Boolean).map(note).join("");
  return `<section><div class="sh"><h2>${esc(t("flowTitle"))}</h2><p>${esc(t("flowHint"))}</p></div>
    <div class="flow"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t("mapAria"))}">
      <defs><linearGradient id="coreg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#26357A"/><stop offset="1" stop-color="#1A2352"/></linearGradient></defs>
      ${paths}<g class="pt">${pts}</g>${core}${labels}</svg></div>${notes}</section>`;
}
function routes(D) {
  const max = Math.max(...D.routes.map((r) => r[3] || 0), 1);
  return `<div><div class="sh"><h2>${esc(t("routesTitle"))}</h2><p>${esc(t("routesHint"))}</p></div>
    <div class="tr h"><span>${esc(t("colRoute"))}</span><span class="rt">${esc(t("colRpm"))}</span><span>${esc(t("p95"))}</span><span class="rt">${esc(t("colP99"))}</span><span class="rt">${esc(t("colErr"))}</span><span>${esc(t("colTrend"))}</span></div>
    ${D.routes.map((r) => { const s = lat(r[3]); return `<div class="tr"><span class="r" title="${esc(r[0] + " " + r[1])}">${route(r[0], r[1])}</span><span class="rt n">${r[2] == null ? "—" : NF(1).format(r[2])}</span>
      <div class="pv"><div class="bar"><i style="width:${Math.max(3, ((r[3] || 0) / max) * 100).toFixed(1)}%;background:${s === "ok" ? C.blue : C[s]}"></i></div><b class="n">${ms(r[3])}</b></div>
      <span class="rt n" style="color:var(--muted)">${ms(r[4])}</span><span class="rt n" style="color:${r[5] ? C.bad : "var(--faint)"}">${NF(1).format(r[5])}%</span>${spark(r[6], 120, 24, "#5B7BFF")}</div>`; }).join("")}</div>`;
}
function slow(D) {
  const max = Math.max(...D.slow.map((s) => s[2]), 1);
  return `<div><div class="sh"><h2>${esc(t("slowTitle"))}</h2><p>${esc(t("slowHint"))}</p></div>
    ${D.slow.map((s) => { const st = lat(s[2]); return `<div class="li"><span class="r" title="${esc(s[0] + " " + s[1])}">${route(s[0], s[1])}</span>
      <div class="bar"><i style="width:${((s[2] / max) * 100).toFixed(1)}%;background:${st === "ok" ? C.blue : C[st]}"></i></div>
      <span class="rt n" style="white-space:nowrap"><b style="font-weight:500">${ms(s[2])}</b><br><span style="font-size:12px;color:${s[3] < FEW_REQUESTS ? "var(--warn)" : "var(--faint)"}">${esc(s[3] < FEW_REQUESTS ? t("onlyReq", s[3]) : t("req", NF(0).format(s[3])))}</span></span></div>`; }).join("")}</div>`;
}
function groupsBlock(D) {
  const max = Math.max(...D.groups.map((c) => c[1] || 0), 1);
  return `<div><div class="sh"><h2>${esc(t("groupsTitle"))}</h2><p>${esc(t("groupsHint"))}</p></div>
    ${D.groups.map((c) => `<div class="li" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr) 44px"><span class="r">${esc(c[0])}</span>
      <div class="bar"><i style="width:${(((c[1] || 0) / max) * 100).toFixed(1)}%;background:var(--blue)"></i></div><span class="rt n">${c[1] == null ? "—" : NF(1).format(c[1])}</span></div>`).join("")}</div>`;
}
function errs(D) {
  return `<div><div class="sh"><h2>${esc(t("errTitle"))}</h2><p>${esc(t("errHint"))}</p></div>
    ${D.errors.length ? D.errors.map((e) => { const r = e[3] ? (e[2] / e[3]) * 100 : null, col = r == null || r >= 50 ? C.bad : r < 1 ? "var(--muted)" : C.warn;
      return `<div class="er"><div class="a"><span class="r" title="${esc(e[0] + " " + e[1])}">${route(e[0], e[1])}</span>
        <b class="n" style="color:${col};font-weight:500">${r == null ? e[2] + "×" : r < 0.1 ? "<" + NF(1).format(0.1) + "%" : NF(r < 10 ? 1 : 0).format(r) + "%"}</b></div>
        <div class="b">${esc(t("errN", NF(0).format(e[2])) + (e[3] ? t("errOf", NF(0).format(e[3])) : ""))}</div></div>`; }).join("") : note(t("noErrors"))}</div>`;
}
function render(root, D) {
  root.innerHTML = head(D) + kpis(D) + flow(D)
    + `<section class="cols">${routes(D)}${slow(D)}</section>`
    + `<section class="cols3 two">${groupsBlock(D)}${errs(D)}</section>`;
  try {
    const svg = root.querySelector(".flow svg");
    if (svg && "IntersectionObserver" in window) new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? svg.unpauseAnimations() : svg.pauseAnimations()))).observe(svg);
  } catch (e) {}
}

RT.run("#ot-root", (d) => { const D = buildData(d); SLOW_MS = D.slowMs; return D; }, render, (D) => !D.core.routes);

/* ===================== ASSETS ===================== */
/* OpenTelemetry logo: CNCF artwork (icon, color), used under the CNCF trademark guidelines. No affiliation implied. */
function logoSrc() { return "data:image/svg+xml;base64,/*@@OTEL_LOGO@@*/"; }
/*@@FONTS@@*/
