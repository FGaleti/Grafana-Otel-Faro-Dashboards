const MAX_EVENTS = 200;
const EVENT_FIELDS = ["kind", "level", "type", "value", "message", "event_name", "event_domain", "view_name", "browser_name", "browser_version", "browser_os", "browser_mobile", "page_url",
  "context_rating", "lcp", "inp", "cls", "fcp", "ttfb", "context_load_state", "context_navigation_type", "context_interaction_type", "context_largest_shift_target",
  "event_data_http_request_method", "event_data_http_response_status_code", "event_data_url_template", "event_data_duration_ns", "event_data_duration", "event_data_cacheHitStatus", "event_data_decodedBodySize", "app_version"];
const FREE_TEXT = ["value", "message", "context_largest_shift_target"];
const URL_FIELDS = ["page_url", "event_data_url_template"];

const I18N = {
  en: {
    title: "Faro events", sub: "Latest RUM events summarised by kind · click a row to see its fields (allow-listed, masked)",
    all: "All", Event: "Event", Measurement: "Measurement", Exception: "Exception", Log: "Log",
    view: "view", target: "target", interaction: "interaction", duration: "duration", cache: "cache", size: "size", resource: "Resource loaded",
    rGood: "good", rPoor: "poor", rWarn: "needs attention", search: "Free filter (view, URL, message, field…)",
    emptyFilter: "No event for this filter", foot: (v, n) => `Showing ${v} of ${n} events · bar left of the time = level (red error, amber warning)`,
    empty: "No Faro events in the period. Check that app is selected and that Faro events reach Loki.",
  },
  pt: {
    title: "Eventos do Faro", sub: "Últimos eventos do RUM resumidos por tipo · clique numa linha para ver os campos (lista permitida, mascarados)",
    all: "Todos", Event: "Event", Measurement: "Measurement", Exception: "Exception", Log: "Log",
    view: "view", target: "alvo", interaction: "interação", duration: "duração", cache: "cache", size: "tamanho", resource: "Recurso carregado",
    rGood: "bom", rPoor: "ruim", rWarn: "atenção", search: "Filtro livre (view, URL, mensagem, campo…)",
    emptyFilter: "Nenhum evento para este filtro", foot: (v, n) => `Mostrando ${v} de ${n} eventos · barra à esquerda do horário = nível (vermelho erro, âmbar aviso)`,
    empty: "Sem eventos do Faro no período. Verifique se app está selecionado e se os eventos do Faro chegam ao Loki.",
  },
};

"@@RUNTIME@@";

function buildData(d) {
  const S = (d && d.series) || [], out = [];
  S.forEach((fr) => {
    const tf = (fr.fields || []).find((f) => f.type === "time"), lf = (fr.fields || []).find((f) => f.type === "string" && f.name !== "labels" && f.name !== "id" && f.name !== "tsNs");
    if (!lf) return; const L = RT.vals(lf), T = tf ? RT.vals(tf) : [];
    L.forEach((line, j) => {
      const p = String(line == null ? "" : line).split("|||"), f = {};
      if (p.length !== EVENT_FIELDS.length) return;
      EVENT_FIELDS.forEach((k, i) => { let v = (p[i] || "").trim(); if (!v || v === "<no value>") return;
        if (FREE_TEXT.includes(k)) v = RT.mask(v); else if (URL_FIELDS.includes(k)) v = RT.cleanUrl(v); f[k] = v; });
      out.push({ ts: T[j] || 0, f });
    });
  });
  out.sort((a, b) => b.ts - a.ts);
  return { lines: out.slice(0, MAX_EVENTS) };
}

const fmtTime = (ts) => { const x = new Date(ts); return x.toLocaleTimeString(RT.locale, { hour12: false }) + "." + String(x.getMilliseconds()).padStart(3, "0"); };
const fmtMs = (v) => (v >= 1000 ? NF(2).format(v / 1000) + " s" : NF(0).format(v) + " ms");
const fmtB = (b) => (b >= 1048576 ? NF(1).format(b / 1048576) + " MB" : b >= 1024 ? NF(1).format(b / 1024) + " KB" : NF(0).format(b) + " B");
const KIND = { event: ["Event", "var(--accent)", "rgba(124,156,255,.14)"], measurement: ["Measurement", "var(--teal)", "rgba(94,234,212,.12)"], exception: ["Exception", "var(--bad)", "rgba(248,113,113,.14)"], log: ["Log", "var(--muted)", "rgba(139,149,169,.14)"] };
const LVL = { error: "var(--bad)", warn: "var(--warn)", warning: "var(--warn)", info: "rgba(255,255,255,.12)", debug: "rgba(255,255,255,.06)" };
const kv = (k, v) => `<span class="kv">${esc(k)} <i>${esc(v)}</i></span>`;
function summarize(f) {
  const view = f.view_name ? kv(t("view"), f.view_name) : "";
  if (f.kind === "exception") return `<span class="name" style="color:var(--bad)">${esc(f.type || "Error")}</span><span style="overflow:hidden;text-overflow:ellipsis">${esc(f.value || "")}</span>${view}`;
  if (f.kind === "measurement") {
    const met = ["lcp", "inp", "cls", "fcp", "ttfb"].find((k) => f[k] != null), val = met === "cls" ? NF(3).format(+f[met]) : met ? fmtMs(+f[met]) : "";
    const r = f.context_rating, rc = r === "good" ? "var(--good)" : r === "poor" ? "var(--bad)" : "var(--warn)";
    return `<span class="name">${met ? met.toUpperCase() : esc(f.type)}</span><span class="num" style="font-weight:600">${val}</span>
      ${r ? `<span class="kv" style="color:${rc}">${esc(r === "good" ? t("rGood") : r === "poor" ? t("rPoor") : t("rWarn"))}</span>` : ""}${view}
      ${f.context_largest_shift_target ? kv(t("target"), f.context_largest_shift_target) : ""}${f.context_interaction_type ? kv(t("interaction"), f.context_interaction_type) : ""}`;
  }
  if (/xml-http-request|fetch/.test(f.event_name || "")) {
    const st = +f.event_data_http_response_status_code, sc = st >= 500 ? "var(--bad)" : st >= 400 ? "var(--warn)" : "var(--good)", url = String(f.event_data_url_template || "").replace(/^https?:\/\/[^/]+/, "");
    return `<span class="name">${esc(f.event_data_http_request_method || "HTTP")}</span><span class="num" style="color:${sc};font-weight:600">${st || ""}</span>
      <span style="overflow:hidden;text-overflow:ellipsis;color:#C9D1E0">${esc(url)}</span>${kv(t("duration"), fmtMs((+f.event_data_duration_ns || 0) / 1e6))}${view}`;
  }
  if (f.event_name === "faro.performance.resource") return `<span class="name">${esc(t("resource"))}</span>${kv(t("cache"), f.event_data_cacheHitStatus || "—")}${kv(t("size"), fmtB(+f.event_data_decodedBodySize || 0))}${kv(t("duration"), fmtMs(+f.event_data_duration || 0))}${view}`;
  return `<span class="name">${esc(f.event_name || f.message || f.kind)}</span>${view}`;
}

const STATE = window.__otelFaroLogState || (window.__otelFaroLogState = { kind: "all", q: "", open: {} });
function render(root, D) {
  const items = D.lines.map((l, i) => ({ id: i + ":" + l.ts, ts: l.ts, f: l.f, text: Object.values(l.f).join(" ").toLowerCase() }));
  const counts = {}; items.forEach((it) => (counts[it.f.kind] = (counts[it.f.kind] || 0) + 1));
  const q = STATE.q.toLowerCase(), vis = items.filter((it) => (STATE.kind === "all" || it.f.kind === STATE.kind) && (!q || it.text.includes(q)));
  const chip = (k, label, n) => `<button data-kind="${k}" class="${STATE.kind === k ? "on" : ""}">${esc(label)}<b>${n}</b></button>`;
  const rows = vis.length ? vis.map((it) => {
    const K = KIND[it.f.kind] || KIND.log, lv = LVL[it.f.level] || LVL.info;
    const fields = Object.entries(it.f).map(([k, v]) => `<div><span class="mono">${esc(k)}</span><span class="mono">${esc(v)}</span></div>`).join("");
    return `<div class="item ${STATE.open[it.id] ? "open" : ""}" data-id="${esc(it.id)}"><div class="row">
        <span class="mono" style="color:var(--muted);display:flex;gap:10px;align-items:center"><span class="lvl" style="background:${lv};height:18px"></span>${fmtTime(it.ts)}</span>
        <span><span class="tag" style="color:${K[1]};background:${K[2]}">${esc(t(K[0]))}</span></span><div class="sum">${summarize(it.f)}</div><span class="chev">›</span></div>
      <div class="det"><div class="fields">${fields}</div></div></div>`; }).join("") : `<div class="empty">${esc(t("emptyFilter"))}</div>`;
  root.innerHTML = `<div class="hdr"><div><h2>${esc(t("title"))}</h2><div class="sub">${esc(t("sub"))}</div></div></div>
    <div class="bar"><div class="chips">${chip("all", t("all"), items.length)}${["event", "measurement", "exception", "log"].filter((k) => counts[k]).map((k) => chip(k, t(KIND[k][0]), counts[k])).join("")}</div>
      <input class="q" placeholder="${esc(t("search"))}" value="${esc(STATE.q)}"></div>
    <div class="list">${rows}</div><div class="foot">${esc(t("foot", vis.length, items.length))}</div>`;
  root.onclick = (e) => {
    const c = e.target.closest("[data-kind]"); if (c) { STATE.kind = c.dataset.kind; return render(root, D); }
    const it = e.target.closest(".item"); if (it && e.target.closest(".row")) { const id = it.dataset.id; STATE.open[id] = !STATE.open[id]; it.classList.toggle("open"); }
  };
  root.oninput = (e) => { if (e.target.matches("input.q")) { STATE.q = e.target.value; const pos = e.target.selectionStart; render(root, D); const i = root.querySelector("input.q"); i.focus(); i.setSelectionRange(pos, pos); } };
}

RT.run("#fl-root", buildData, render, (D) => !D.lines.length, "empty");

"@@FONTS@@";
