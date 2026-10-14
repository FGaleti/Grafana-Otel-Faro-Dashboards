import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demo = JSON.parse(fs.readFileSync(path.join(ROOT, "demo/frames.json"), "utf8"));
const vars = { ...demo.vars, lang: process.env.LANG_DEMO || demo.vars.lang };
const OUT = path.join(ROOT, "demo/out");
fs.mkdirSync(OUT, { recursive: true });

const pages = [];
for (const file of ["backend-opentelemetry.json", "frontend-faro.json"]) {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, "dashboards", file), "utf8"));
  for (const p of d.panels) {
    const rootId = (p.options.html.match(/id="([^"]+)"/) || [])[1], cap = demo.panels[rootId];
    if (!cap) continue;
    const name = `${file.replace(".json", "")}-${rootId.replace("-root", "")}`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Fictitious demo data: ${name}</title>
<style>html,body{margin:0;background:#111217}#host{width:1600px;padding:16px}</style></head><body>
<!-- FICTITIOUS DATA, see demo/README.md -->
<div id="host"></div>
<script>
const VARS = ${JSON.stringify(vars)};
const CAP = ${JSON.stringify(cap)};
const tpl = { replace: (s) => String(s).replace(/\\$\\{([\\w:]+)\\}|\\$(\\w+)/g, (m, a, b) => (VARS[a || b] != null ? VARS[a || b] : m)) };
const host = document.getElementById("host"), shadow = host.attachShadow({ mode: "open" });
shadow.innerHTML = "<style>" + ${JSON.stringify(p.options.css)} + "</style>" + ${JSON.stringify(p.options.html)};
const now = Date.now(), raw = CAP.rangeRaw || { from: "now-30m", to: "now" };
const data = { state: "Done", series: CAP.series, timeRange: { from: { valueOf: () => CAP.timeRange.from }, to: { valueOf: () => CAP.timeRange.to }, raw }, request: { rangeRaw: raw, endTime: now } };
new Function("htmlNode", "data", "getTemplateSrv", "getLocationSrv", ${JSON.stringify(p.options.onRender)})(shadow, data, () => tpl, () => ({ update() {} }));
</script></body></html>`;
    fs.writeFileSync(path.join(OUT, name + ".html"), html);
    pages.push(name);
  }
}
console.log("pages:", pages.join(", "));

if (process.argv.includes("--shots")) {
  const pw = await import(pathToFileURL(path.join(process.env.PLAYWRIGHT_CORE || "playwright-core", "index.js")).href).catch(() => import("playwright-core"));
  const browser = await (pw.chromium || pw.default.chromium).launch({ channel: process.env.BROWSER_CHANNEL || "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1632, height: 900 }, deviceScaleFactor: 1, timezoneId: "UTC" });
  const IMG = path.join(ROOT, "docs/images");
  fs.mkdirSync(IMG, { recursive: true });
  for (const name of pages) {
    await page.goto(pathToFileURL(path.join(OUT, name + ".html")).href);
    await page.waitForTimeout(2500);
    await page.evaluate(() => { const s = document.querySelector("#host").shadowRoot; s.querySelectorAll("svg").forEach((x) => x.pauseAnimations && x.pauseAnimations()); });
    const box = await (await page.$("#host")).boundingBox();
    await page.setViewportSize({ width: 1632, height: Math.ceil(Math.min(box.height, 1600)) });
    await page.screenshot({ path: path.join(IMG, name + (vars.lang === "en" ? "" : "." + vars.lang) + ".png"), clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 1600) } });
    console.log("shot:", name);
  }
  await browser.close();
}

if (process.argv.includes("--gif")) {
  const load = async (dir, pkg) => {
    if (!dir) return import(pkg);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    return import(pathToFileURL(path.join(dir, meta.module || meta.main || "index.js")).href);
  };
  const pw = await load(process.env.PLAYWRIGHT_CORE, "playwright-core");
  const { GIFEncoder, quantize, applyPalette } = await load(process.env.GIFENC, "gifenc");
  const pngjs = await load(process.env.PNGJS, "pngjs"), PNG = pngjs.PNG || pngjs.default.PNG;
  const FRAMES = 48, STEP = 1 / 12, ZOOM = 0.62;
  const browser = await (pw.chromium || pw.default.chromium).launch({ channel: process.env.BROWSER_CHANNEL || "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1, timezoneId: "UTC" });
  await page.goto(pathToFileURL(path.join(OUT, "backend-opentelemetry-ot.html")).href);
  await page.evaluate((z) => { document.body.style.zoom = z; }, ZOOM);
  await page.waitForTimeout(2500);
  const box = await page.evaluate(() => { const el = document.querySelector("#host").shadowRoot.querySelector(".flow"); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const clip = { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.floor(box.width), height: Math.floor(box.height) };
  const gif = GIFEncoder();
  for (let i = 0; i < FRAMES; i++) {
    await page.evaluate((t) => { const s = document.querySelector("#host").shadowRoot.querySelector(".flow svg"); s.pauseAnimations(); s.setCurrentTime(t); }, 1 + i * STEP);
    const png = PNG.sync.read(await page.screenshot({ clip }));
    const palette = quantize(png.data, 256), index = applyPalette(png.data, palette);
    gif.writeFrame(index, png.width, png.height, { palette, delay: Math.round(STEP * 1000) });
  }
  gif.finish();
  fs.mkdirSync(path.join(ROOT, "docs/images"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "docs/images/backend-flow.gif"), gif.bytes());
  console.log("gif: docs/images/backend-flow.gif", clip.width + "x" + clip.height, FRAMES + " frames");
  await browser.close();
}
