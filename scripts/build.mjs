import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rd = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const b64 = (p) => fs.readFileSync(path.join(ROOT, p)).toString("base64");
const PLUGIN = { id: "gapit-htmlgraphics-panel", name: "HTML graphics", version: "2.2.3" };

const FONTS = {
  poppins: [["OTD Poppins", "400", "src/fonts/poppins-latin-400-normal.woff2"], ["OTD Poppins", "500", "src/fonts/poppins-latin-500-normal.woff2"], ["OTD Poppins", "600", "src/fonts/poppins-latin-600-normal.woff2"]],
  inter: [["OTD Inter", "100 900", "src/fonts/inter-latin-wght-normal.woff2"]],
  mono: [["OTD JetBrains Mono", "100 800", "src/fonts/jetbrains-mono-latin-wght-normal.woff2"]],
};
const fontBlock = (families) => {
  const rows = families.flatMap((f) => FONTS[f]).map(([fam, w, file]) => `    [${JSON.stringify(fam)}, ${JSON.stringify(w)}, "${b64(file)}"],`);
  return `function FONT_FILES() {\n  return [\n${rows.join("\n")}\n  ];\n}\n`;
};

const panelCode = (file, families) => {
  let s = rd(file);
  s = s.replace("\"@@RUNTIME@@\";", () => rd("src/shared/runtime.js").trim());
  s = s.replace("\"@@FONTS@@\";", () => fontBlock(families));
  s = s.replace("@@OTEL_LOGO@@", () => b64("src/assets/opentelemetry-icon-color.svg"));
  s = s.replace("@@FARO_LOGO@@", () => b64("src/assets/grafana-faro-icon.png"));
  if (/@@[A-Z_]+@@/.test(s)) throw new Error("unresolved placeholder in " + file);
  return s;
};

const opts = (css, html, onRender) => ({
  SVGBaseFix: false, add100Percentage: true, centerAlignContent: false, overflow: "auto", panelupdateOnMount: true,
  reloadOnDataChange: true, renderOnMount: true, rootCSS: "", useSVGBuilder: false, css, html, onInit: "", onRender,
});
const panel = (id, gridPos, ds, description, base, rootId, families, targets, { css, ...extra } = {}) => ({
  id, type: PLUGIN.id, title: "", description, transparent: true, datasource: ds, gridPos, targets: targets.map((t) => ({ datasource: ds, ...t })),
  options: opts(rd(`src/${css || base}.css`), `<div id="${rootId}" class="${rootId === "ot-root" || rootId === "oc-root" ? "ot" : rootId === "ff-root" ? "ff" : "fw"}"></div>`, panelCode(`src/${base}.js`, families)), ...extra,
});
const textbox = (name, label, value, description) => ({ name, label, type: "textbox", query: value, current: { text: value, value }, options: [{ selected: true, text: value, value }], hide: 0, description });
const custom = (name, label, values, def, description, multi = false) => ({
  name, label, type: "custom", query: values.map(([t, v]) => (t === v ? v : `${t} : ${v}`)).join(","), description, hide: 0,
  multi, includeAll: multi, allValue: multi ? ".*" : undefined,
  current: multi ? { text: ["All"], value: ["$__all"] } : { text: values.find((x) => x[1] === def)[0], value: def },
  options: (multi ? [{ text: "All", value: "$__all", selected: true }] : []).concat(values.map(([t, v]) => ({ text: t, value: v, selected: !multi && v === def }))),
});
const dsVar = (name, label, type, input) => ({ name, label, type: "datasource", query: type, current: { text: "${" + input + "}", value: "${" + input + "}" }, hide: 0, refresh: 1, regex: "", options: [] });
const input = (name, label, pluginId, pluginName, description) => ({ name, label, description, type: "datasource", pluginId, pluginName });
const requires = (dsList) => [{ type: "grafana", id: "grafana", name: "Grafana", version: "13.0.0" }, { type: "panel", ...PLUGIN }, ...dsList.map(([id, name]) => ({ type: "datasource", id, name, version: "1.0.0" }))];

const TEMPO = { type: "tempo", uid: "${tempo_ds}" };
const SVC = 'resource.service.name="$service"';
const F = `${SVC} && kind=server && span.http.route != nil`;
const OUT = `(span.db.system != nil || span.db.system.name != nil || span.messaging.system != nil || span.server.address != nil || span.peer.service != nil)`;
const DEPC = `${SVC} && kind=client && ${OUT}`;
const DB = `${SVC} && kind=client && (span.db.system != nil || span.db.system.name != nil)`;
const MSG = `${SVC} && (kind=client || kind=producer) && span.messaging.system != nil`;
const NET = `${SVC} && kind=client && (span.http.request.method != nil || span.rpc.system != nil)`;
const METHOD = "span.http.request.method";
const CODE = "span.http.response.status_code";
const CACHE = "redis|valkey|memcached|dragonfly|hazelcast|ignite|aerospike";
const STEP = "2m";
const m = (refId, query, type) => ({ refId, queryType: "traceql", query, metricsQueryType: type, ...(type === "range" ? { step: STEP } : {}) });
const s = (refId, query, limit, spss) => ({ refId, queryType: "traceql", query, tableType: "spans", limit, spss });

const backendTargets = {
  api: [
    m("KR", `{${F}} | rate() by (kind, status, ${CODE})`, "range"),
    m("KP", `{${F}} | quantile_over_time(duration, .95) by (kind)`, "range"),
    m("PI", `{${F}} | quantile_over_time(duration, .95) by (kind)`, "instant"),
    m("DC", `{${DEPC}} | sum_over_time(duration) by (kind)`, "range"),
    m("DCI", `{${DEPC}} | sum_over_time(duration) by (kind)`, "instant"),
    m("DS", `{${F}} | sum_over_time(duration) by (kind)`, "range"),
    m("DSI", `{${F}} | sum_over_time(duration) by (kind)`, "instant"),
    m("RN", `{${F}} | count_over_time() by (status, span.http.route, ${METHOD}, ${CODE})`, "instant"),
    m("RT", `{${F}} | count_over_time() by (status, span.http.route, ${METHOD})`, "range"),
    m("RQ", `{${F}} | quantile_over_time(duration, .95, .99) by (resource.service.name, span.http.route, ${METHOD})`, "instant"),
    m("CB", `{${F}} | count_over_time() by (resource.service.name, trace:rootService)`, "instant"),
    m("CN", `{${SVC} && (kind=consumer || (kind=server && span.rpc.system != nil))} | count_over_time() by (kind, resource.service.name, span.messaging.system, span.rpc.system)`, "instant"),
    m("DN", `{${DB}} | count_over_time() by (kind, status, span.db.system, span.db.system.name)`, "instant"),
    m("DNM", `{${MSG}} | count_over_time() by (kind, status, span.messaging.system)`, "instant"),
    m("DNH", `{${NET}} | count_over_time() by (kind, status, span.server.address, span.peer.service, ${CODE})`, "instant"),
    m("DP", `{${DB}} | quantile_over_time(duration, .95) by (kind, span.db.system, span.db.system.name)`, "instant"),
    m("DPM", `{${MSG}} | quantile_over_time(duration, .95) by (kind, span.messaging.system)`, "instant"),
    m("DPH", `{${NET}} | quantile_over_time(duration, .95) by (kind, span.server.address, span.peer.service)`, "instant"),
    m("ST", `{${F}} | count_over_time() by (resource.telemetry.sdk.language, resource.process.runtime.name, resource.process.runtime.version)`, "instant"),
  ],
  traces: [
    s("P", `{${F} && (duration > \${slow_ms}ms || span.http.response.status_code >= 400)} &>> {kind=client || kind=producer} | select(${METHOD}, ${CODE}, span.db.system, span.db.system.name, span.messaging.system, span.rpc.system)`, 100, 100),
  ],
  queries: [
    s("Q", `{${F}} &>> {(span.db.query.text != nil || span.db.statement != nil) && (span.db.system.name !~ "${CACHE}" || span.db.system !~ "${CACHE}")} | select(${METHOD}, span.db.query.text, span.db.statement, span.db.system, span.db.system.name, span.db.collection.name, span.db.sql.table)`, 500, 100),
  ],
};

const backend = {
  __inputs: [input("DS_TEMPO", "Tempo", "tempo", "Tempo", "Tempo datasource with TraceQL Metrics (local-blocks processor) enabled")],
  __elements: {},
  __requires: requires([["tempo", "Tempo"]]),
  annotations: { list: [] }, editable: true, fiscalYearStartMonth: 0, graphTooltip: 0, id: null, links: [], liveNow: false,
  panels: [
    panel(1, { h: 41, w: 24, x: 0, y: 0 }, TEMPO, "Overview of one service: requests, latency, errors, callers, dependencies and routes. Built from TraceQL Metrics on server and client spans of $service.", "backend/api", "ot-root", ["poppins", "inter", "mono"], backendTargets.api),
    panel(2, { h: 26, w: 24, x: 0, y: 41 }, TEMPO, "Recent requests slower than slow_ms or answered with HTTP >= 400, with the time split between the service code and its dependencies (TraceQL search, up to 100 traces).", "backend/traces", "bt-root", ["poppins", "inter", "mono"], backendTargets.traces),
    panel(3, { h: 21, w: 24, x: 0, y: 67 }, TEMPO, "Slowest database statements (db.query.text or db.statement) under the service's routes, with literal values replaced by ?. Cache commands are excluded in the query.", "backend/queries", "bq-root", ["poppins", "inter", "mono"], backendTargets.queries),
  ],
  refresh: "5m", schemaVersion: 39, tags: ["opentelemetry", "tempo", "traceql", "backend"],
  templating: { list: [
    dsVar("tempo_ds", "Tempo", "tempo", "DS_TEMPO"),
    { name: "service", label: "Service", type: "query", datasource: TEMPO, query: { refId: "TempoDatasourceVariableQueryEditor-VariableQuery", type: 1, label: "service.name" }, definition: "service.name", refresh: 2, sort: 1, hide: 0, includeAll: false, multi: false, current: {}, options: [], description: "service.name of the backend to inspect (values discovered in Tempo)." },
    textbox("frontend_service", "Frontend service", "", "Optional. service.name of the browser app (Faro). Traces whose root is this service are shown as the Browser caller. Empty: they appear under their service name."),
    textbox("internal_hosts_regex", "Internal hosts (regex)", "", "Regex matched against server.address / peer.service. Matching hosts are drawn as internal services; empty puts every non-database host under External."),
    textbox("slow_ms", "Slow threshold (ms)", "1000", "Integer, in milliseconds. Requests and statements at or above it are 'slow'."),
    textbox("name_overrides", "Dependency aliases (JSON)", "{}", "Optional JSON object: host, db.system, messaging.system or service name -> display name (string) or {\"name\":…,\"kind\":…}."),
    custom("lang", "Language", [["English", "en"], ["Português (Brasil)", "pt-BR"]], "en", "Language of the panel texts."),
  ] },
  time: { from: "now-3h", to: "now" }, timepicker: {}, timezone: "browser", title: "Backend — OpenTelemetry", uid: "otel-backend-overview", version: 1, weekStart: "",
};

const LOKI = { type: "loki", uid: "${loki_ds}" };
const SEL = (kind) => `{service_name="$app", deployment_environment=~"\${environment:regex}", kind=${kind}}`;
const VIEW = 'view_name=~"$view"', BROWSER = 'browser_name=~"$browser"', DEVICE = 'browser_mobile=~"${device:regex}"';
const NOISE = 'value!~"$ignore_errors_regex"';
const filt = (...xs) => xs.filter(Boolean).join(" | ");
const SESS = (rng) => `sum(count_over_time(${SEL('"event"')} | logfmt | ${filt('event_name="session_start"', BROWSER, DEVICE)} [${rng}]))`;
const PVS = (rng) => `sum(count_over_time(${SEL('"event"')} | logfmt | ${filt('event_name="view_changed"', VIEW, BROWSER, DEVICE)} [${rng}]))`;
const EXC = (rng) => `count(count by (session_id) (count_over_time(${SEL('"exception"')} | logfmt | ${filt(NOISE, VIEW, BROWSER, DEVICE)} [${rng}])))`;
const VIT = (k, extra = "") => `${SEL('"measurement"')} | logfmt | ${filt('type="web-vitals"', `${k}!=""`, extra, VIEW, BROWSER, DEVICE)}`;
const lq = (refId, expr, queryType, more = {}) => ({ refId, expr, queryType, ...more });
const off = (q) => q.replace(/\[\$__range\]/g, "[$__range] offset $__range");
const vitals = ["lcp", "inp", "cls", "fcp", "ttfb"].flatMap((k) => {
  const K = k.toUpperCase();
  return [
    lq(K, `quantile_over_time(0.75, ${VIT(k)} | unwrap ${k} [$__range]) by ()`, "instant"),
    lq(K + "_N", `sum(count_over_time(${VIT(k)} [$__range]))`, "instant"),
    lq(K + "_TS", `quantile_over_time(0.75, ${VIT(k)} | unwrap ${k} [$__interval]) by ()`, "range"),
  ];
});
const good = (k) => `100 * sum(count_over_time(${VIT(k, 'context_rating="good"')} [$__range])) / sum(count_over_time(${VIT(k)} [$__range]))`;
const frontendTargets = {
  overview: [
    lq("SESS", SESS("$__range"), "instant"), lq("SESS_PREV", off(SESS("$__range")), "instant"), lq("SESS_TS", SESS("$__interval"), "range"),
    lq("PV", PVS("$__range"), "instant"), lq("PV_PREV", off(PVS("$__range")), "instant"), lq("PV_TS", PVS("$__interval"), "range"),
    lq("ERR", `100 * ${EXC("$__range")} / ${SESS("$__range")}`, "instant"), lq("ERR_PREV", off(`100 * ${EXC("$__range")} / ${SESS("$__range")}`), "instant"),
    lq("ERR_TS", `100 * ${EXC("$__interval")} / ${SESS("$__interval")}`, "range"),
    lq("ERRS", EXC("$__range"), "instant"), lq("ERRS_PREV", off(EXC("$__range")), "instant"), lq("ERRS_TS", EXC("$__interval"), "range"),
    lq("SCORE", `(${good("lcp")} + ${good("inp")} + ${good("cls")}) / 3`, "instant"),
    ...vitals,
    lq("SLOW", `topk(8, quantile_over_time(0.75, ${SEL('"measurement"')} | logfmt | ${filt('type="web-vitals"', 'lcp!=""', 'view_name!=""', VIEW, BROWSER, DEVICE)} | unwrap lcp [$__range]) by (view_name))`, "instant"),
    lq("ERR_ROUTES", `topk(8, count by (view_name) (count by (view_name, session_id) (count_over_time(${SEL('"exception"')} | logfmt | ${filt(NOISE, 'view_name!=""', BROWSER, DEVICE)} [$__range]))))`, "instant"),
    lq("BROWSER", `sum by (browser_name) (count_over_time(${SEL('"event"')} | logfmt | ${filt('event_name="session_start"', 'browser_name!=""', VIEW, DEVICE)} [$__range]))`, "instant"),
    lq("DEVICE", `sum by (browser_mobile) (count_over_time(${SEL('"event"')} | logfmt | ${filt('event_name="session_start"', 'browser_mobile!=""', VIEW, BROWSER)} [$__range]))`, "instant"),
    lq("VIEWS", `topk(60, sum by (view_name) (count_over_time(${SEL('"event"')} | logfmt | ${filt('event_name="view_changed"', 'view_name!=""', BROWSER, DEVICE)} [$__range])))`, "instant"),
    lq("ERR_LIST", `${SEL('"exception"')} | logfmt | ${filt(NOISE, VIEW, BROWSER, DEVICE)} | line_format "{{.value}}|||{{.view_name}}|||{{.type}}" | keep kind`, "range", { maxLines: 20 }),
  ],
  calls: [
    lq("A", `${SEL('"event"')} | logfmt | ${filt('event_name=~"faro.tracing.fetch|faro.tracing.xml-http-request"', "event_data_http_response_status_code>=400", VIEW, BROWSER, DEVICE)} | line_format "{{.event_data_http_response_status_code}}|||{{.event_data_duration_ns}}|||{{if .event_data_url_template}}{{.event_data_url_template}}{{else}}{{.event_data_url_full}}{{end}}|||{{.traceID}}|||{{.event_data_http_request_method}}" | keep kind`, "range", { maxLines: 200 }),
    lq("B", `${SEL('"event"')} | logfmt | ${filt('event_name=~"faro.tracing.fetch|faro.tracing.xml-http-request"', "event_data_duration_ns > ${slow_ms}000000", VIEW, BROWSER, DEVICE)} | line_format "{{.event_data_http_response_status_code}}|||{{.event_data_duration_ns}}|||{{if .event_data_url_template}}{{.event_data_url_template}}{{else}}{{.event_data_url_full}}{{end}}|||{{.traceID}}|||{{.event_data_http_request_method}}" | keep kind`, "range", { maxLines: 200 }),
  ],
};
const EVENT_FIELDS = JSON.parse(rd("src/frontend/events.js").match(/const EVENT_FIELDS = (\[[\s\S]*?\]);/)[1]);
frontendTargets.events = [
  lq("A", `{service_name="$app", deployment_environment=~"\${environment:regex}", kind=~"event|measurement|exception|log"} | logfmt | ${filt(VIEW, BROWSER, DEVICE)} | line_format "${EVENT_FIELDS.map((f) => (f === "event_data_url_template" ? `{{if .${f}}}{{.${f}}}{{else}}{{.event_data_url_full}}{{end}}` : `{{.${f}}}`)).join("|||")}" | keep kind`, "range", { maxLines: 200 }),
];

const loki = (name, label, stream, all, description) => ({
  name, label, type: "query", datasource: LOKI, description, refresh: 2, sort: 1, hide: 0,
  query: { refId: "LokiVariableQueryEditor-VariableQuery", type: 1, label: name === "app" ? "service_name" : "deployment_environment", stream },
  definition: `label_values(${stream}, ${name === "app" ? "service_name" : "deployment_environment"})`,
  includeAll: !!all, multi: !!all, allValue: all ? ".*" : undefined, current: all ? { text: ["All"], value: ["$__all"] } : {}, options: [],
});
const frontend = {
  __inputs: [
    input("DS_LOKI", "Loki", "loki", "Loki", "Loki datasource that receives Faro logs (labels service_name, kind, deployment_environment)"),
    input("DS_TEMPO", "Tempo", "tempo", "Tempo", "Tempo datasource used by the trace id links"),
  ],
  __elements: {},
  __requires: requires([["loki", "Loki"], ["tempo", "Tempo"]]),
  annotations: { list: [] }, editable: true, fiscalYearStartMonth: 0, graphTooltip: 1, id: null, links: [], liveNow: false,
  panels: [
    panel(200, { h: 36, w: 24, x: 0, y: 0 }, LOKI, "Real user monitoring for $app: sessions, page views, error rate, Web Vitals (p75, Google thresholds), slow and failing views, audience and recent errors. Click a view or browser to filter the dashboard.", "frontend/overview", "ff-root", ["inter", "mono"], frontendTargets.overview, { maxDataPoints: 48, interval: "1m" }),
    panel(201, { h: 14, w: 24, x: 0, y: 36 }, LOKI, "Fetch/XHR calls captured by Faro tracing that were slower than slow_ms or answered with HTTP >= 400. URLs are shown as templates, without query strings.", "frontend/calls", "ft-root", ["inter", "mono"], frontendTargets.calls),
    panel(202, { h: 18, w: 24, x: 0, y: 50 }, LOKI, "Latest Faro events (limit 200). Only an allow-list of fields leaves Loki; session and user identifiers are never shown, and free text is masked.", "frontend/events", "fl-root", ["inter", "mono"], frontendTargets.events),
  ],
  refresh: "5m", schemaVersion: 39, tags: ["faro", "frontend", "rum", "loki"],
  templating: { list: [
    dsVar("loki_ds", "Loki", "loki", "DS_LOKI"),
    dsVar("tempo_ds", "Tempo", "tempo", "DS_TEMPO"),
    loki("app", "App", '{kind=~"event|measurement|exception|log"}', false, "service_name of the Faro app (values discovered in Loki)."),
    loki("environment", "Environment", '{service_name="$app"}', true, "deployment_environment of the app (values discovered in Loki). Streams without this label match All."),
    textbox("view", "View (regex)", ".*", "Faro view_name filter. view_name is a parsed field, not a Loki label, so Grafana cannot list it here: pick a view in the overview panel or type a regex."),
    textbox("browser", "Browser (regex)", ".*", "browser_name filter. Parsed field, not a Loki label: pick a browser in the overview panel or type a regex."),
    custom("device", "Device", [["Desktop", "false"], ["Mobile", "true"]], null, "browser_mobile filter.", true),
    textbox("slow_ms", "Slow call threshold (ms)", "1000", "Integer, in milliseconds. Fetch/XHR calls at or above it are listed as slow."),
    textbox("ignore_errors_regex", "Ignored errors (regex)", "(?i).*ResizeObserver loop.*", "Exceptions whose message matches this regex are ignored (benign browser noise). Use ^$ to ignore nothing."),
    custom("lang", "Language", [["English", "en"], ["Português (Brasil)", "pt-BR"]], "en", "Language of the panel texts."),
  ] },
  time: { from: "now-24h", to: "now" }, timepicker: {}, timezone: "browser", title: "Frontend — Faro RUM", uid: "faro-frontend-overview", version: 1, weekStart: "",
};

fs.mkdirSync(path.join(ROOT, "dashboards"), { recursive: true });
for (const [file, dash] of [["backend-opentelemetry.json", backend], ["frontend-faro.json", frontend]]) {
  const out = JSON.stringify(dash, null, 2) + "\n";
  fs.writeFileSync(path.join(ROOT, "dashboards", file), out);
  console.log(file, (out.length / 1024).toFixed(0) + " KB", dash.panels.map((p) => p.targets.length).join("/") + " queries");
}
