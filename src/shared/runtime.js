/* ===================== SHARED RUNTIME (src/shared/runtime.js) =====================
   Reads dashboard variables, translates texts, masks sensitive values and draws error and empty states.
   Nothing in this block refers to a specific account, datasource or application. */
const RT = (() => {
  const tpl = (s) => { try { if (typeof getTemplateSrv === "function") return getTemplateSrv().replace(s); } catch (e) {} return s; };
  const v = (name, def) => { const raw = "${" + name + "}", r = tpl(raw); return r == null || r === "" || r === raw ? def : r; };
  const num = (name, def) => { const n = parseFloat(v(name, "")); return isFinite(n) && n > 0 ? n : def; };
  const json = (name, def) => { try { const o = JSON.parse(v(name, "")); return o && typeof o === "object" ? o : def; } catch (e) { return def; } };
  const lang = /^pt/i.test(v("lang", "en")) ? "pt" : "en";
  const locale = lang === "pt" ? "pt-BR" : "en-US";

  /* texts: each panel declares I18N = {en:{...}, pt:{...}} at its top; values may be strings with {0}, {1}… or functions */
  const t = (key, ...a) => {
    const d = (typeof I18N !== "undefined" && I18N) || {}, base = (typeof RT_I18N !== "undefined" && RT_I18N) || {};
    let s = (d[lang] && d[lang][key]) ?? (d.en && d.en[key]) ?? (base[lang] && base[lang][key]) ?? (base.en && base.en[key]) ?? key;
    if (typeof s === "function") return s(...a);
    if (s && typeof s === "object") return s;
    return String(s).replace(/\{(\d+)\}/g, (_, i) => (a[+i] == null ? "" : a[+i]));
  };
  const nf = (d) => new Intl.NumberFormat(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* masking: always on. Applied to free text (messages, URLs, SQL, field values), never to trace ids */
  const MASKS = [
    [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]"],
    [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, "[token]"],
    [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]"],
    [/\b(token|apikey|api_key|api-key|access_token|refresh_token|password|passwd|secret|session|sessionid|session_id|sid|auth)(["']?\s*[:=]\s*["']?)[^\s&"',;)}]+/gi, "$1$2[redacted]"],
    [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]"],
    [/\b(?=[0-9a-f]*\d)[0-9a-f]{16,}\b/gi, "[id]"],
    [/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "[ip]"],
    [/\b\d{6,}\b/g, "[n]"],
  ];
  const mask = (s) => MASKS.reduce((a, [re, r]) => a.replace(re, r), String(s == null ? "" : s));
  /* URLs: drop query string and fragment, replace id-like path segments */
  const cleanUrl = (u) => {
    const s = String(u == null ? "" : u).split(/[?#]/)[0], m = s.match(/^([a-z][a-z0-9+.-]*:\/\/[^/]*)(.*)$/i);
    const origin = m ? m[1] : "", pathPart = m ? m[2] : s; /* the host is kept (then masked if it is an IP); only path segments become :id */
    return mask(origin + pathPart.split("/").map((seg) => (/^\d+$|\d{3,}|^[0-9a-f-]{16,}$|^[A-Za-z0-9_-]{24,}$/i.test(seg) ? ":id" : seg)).join("/"));
  };

  const boot = () => { try { return window.grafanaBootData || {}; } catch (e) { return {}; } };
  const orgId = () => { const b = boot(); if (b.user && b.user.orgId) return b.user.orgId; try { return new URLSearchParams(location.search).get("orgId") || 1; } catch (e) { return 1; } };
  const subUrl = () => { const b = boot(); return (b.settings && b.settings.appSubUrl) || ""; };
  const exploreTrace = (dsUid, traceId, from) => {
    if (!dsUid || !traceId) return null;
    const pane = { a: { datasource: dsUid, queries: [{ refId: "A", datasource: { type: "tempo", uid: dsUid }, queryType: "traceql", query: traceId }], range: { from: from || "now-7d", to: "now" } } };
    return subUrl() + "/explore?schemaVersion=1&orgId=" + encodeURIComponent(orgId()) + "&panes=" + encodeURIComponent(JSON.stringify(pane));
  };
  /* sets a dashboard variable (used by in-panel filters) */
  const setVar = (name, value) => { try { if (typeof getLocationSrv === "function") getLocationSrv().update({ query: { ["var-" + name]: value }, partial: true, replace: false }); } catch (e) {} };
  const reEscape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /* fonts: registered once per page through the FontFace API (works inside the panel's shadow root) */
  const fonts = () => {
    try {
      if (typeof FontFace === "undefined" || !document.fonts || typeof FONT_FILES !== "function") return;
      const done = window.__otelDashFonts || (window.__otelDashFonts = {});
      FONT_FILES().forEach(([family, weight, b64]) => {
        if (done[family + "|" + weight]) return;
        done[family + "|" + weight] = 1;
        const f = new FontFace(family, "url(data:font/woff2;base64," + b64 + ") format('woff2')", { weight, style: "normal", display: "swap" });
        document.fonts.add(f); f.load().catch(() => {});
      });
    } catch (e) {}
  };

  /* frames: plain arrays out of Grafana's DataFrame fields */
  const vals = (f) => { const x = f && f.values; return Array.isArray(x) ? x : x && x.toArray ? x.toArray() : []; };
  const unq = (s) => (s == null ? null : String(s).replace(/^"(.*)"$/, "$1"));
  const nn = (s) => { const x = unq(s); return x == null || x === "" || x === "nil" ? null : x; };

  /* guarded execution: query errors, build errors and empty data are shown inside the panel */
  const run = (rootSel, build, render, isEmpty, emptyKey) => {
    fonts();
    const host = typeof htmlNode !== "undefined" ? htmlNode : document, root = host.querySelector(rootSel);
    if (!root) return;
    const box = (html, cls) => { root.innerHTML = `<div class="rt-state ${cls}">${html}</div>`; };
    const d = typeof data !== "undefined" ? data : null;
    const errs = [].concat((d && d.errors) || [], d && d.error && !((d.errors || []).length) ? [d.error] : []);
    if (errs.length) {
      box(`<b>${esc(t("rt.queryError"))}</b><br>` + errs.map((e) => esc((e.refId ? "[" + e.refId + "] " : "") + mask(e.message || (e.data && e.data.message) || t("rt.noMessage")))).join("<br>"), "bad");
      return;
    }
    if (d && (d.state === "Loading" || d.state === "NotStarted") && !((d.series || []).length)) { box(esc(t("rt.loading")), "muted"); return; }
    try {
      const D = build(d);
      if (isEmpty(D)) { box(esc(t(emptyKey || "rt.empty")), "muted"); return; }
      render(root, D);
    } catch (e) {
      box(`<b>${esc(t("rt.buildError"))}</b><br>` + esc((e && e.refId ? "[" + e.refId + "] " : "") + mask((e && e.message) || e)), "bad");
    }
  };

  return { v, num, json, lang, locale, t, nf, esc, mask, cleanUrl, exploreTrace, setVar, reEscape, vals, unq, nn, run };
})();
const RT_I18N = {
  en: {
    "rt.queryError": "Query error",
    "rt.buildError": "Could not build this panel",
    "rt.noMessage": "no message",
    "rt.loading": "Loading…",
    "rt.empty": "No data in the selected period. Check that the service variable is selected and that your instrumentation sends the expected attributes.",
  },
  pt: {
    "rt.queryError": "Erro na consulta",
    "rt.buildError": "Não foi possível montar o painel",
    "rt.noMessage": "sem mensagem",
    "rt.loading": "Carregando…",
    "rt.empty": "Sem dados no período. Verifique se a variável service está selecionada e se a instrumentação envia esses atributos.",
  },
};
const { t, nf: NF, esc } = RT;
