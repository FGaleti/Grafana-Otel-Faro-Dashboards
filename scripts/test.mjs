import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rd = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const queries = rd("src/backend/queries.js");
const consts = queries.slice(queries.indexOf("const DOUBLE_QUOTE_IDENTIFIERS"), queries.indexOf("const I18N ="));
const normalize = queries.slice(queries.indexOf("function normalize("), queries.indexOf("function buildData("));
const ctx = vm.createContext({ window: {}, location: { search: "" }, Intl });
vm.runInContext("const I18N = {en:{},pt:{}};\n" + rd("src/shared/runtime.js") + "\n" + consts + "\n" + normalize + "\nthis.RT = RT; this.normalize = normalize;", ctx);
const { RT, normalize: norm } = ctx;

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log("ok -", name); };

ok("mask: e-mail, JWT, bearer, key=value secrets, UUID, long hex, IP, long numbers", () => {
  const s = RT.mask("user jane.doe@example.org token=abc123 Bearer abcdefghijkl " + ["eyJhbGciOi", "eyJzdWIiOiIx", "c2lnbmF0dXJl"].join(".") + " 3f2504e0-4f89-11d3-9a0c-0305e82c3301 deadbeefdeadbeef1 10.1.2.3 1234567");
  for (const leak of ["jane.doe", "abc123", "abcdefghijkl", "eyJhbGciOi", "3f2504e0", "deadbeef", "10.1.2.3", "1234567"]) assert.ok(!s.includes(leak), leak + " leaked: " + s);
});
ok("mask: ordinary words are kept", () => {
  assert.equal(RT.mask("Session expired, please sign in"), "Session expired, please sign in");
});
ok("cleanUrl: query string, fragment and id-like segments removed", () => {
  assert.equal(RT.cleanUrl("https://shop.example.com/api/orders/123/items/9f86d081884c7d659a2feaa0c55ad015?token=x#y"), "https://shop.example.com/api/orders/:id/items/:id");
  assert.equal(RT.cleanUrl("/api/orders/ord-12345/invoice-987/v2"), "/api/orders/:id/:id/v2");
  assert.equal(RT.cleanUrl("http://shop1234.example.com:8080/api/books/42"), "http://shop1234.example.com:8080/api/books/:id");
});
ok("normalize: literals, comments, e-mails, IN lists and VALUES become ?", () => {
  const s = norm(`/* traceparent='00-abc-01' */ SELECT * FROM users WHERE email = 'a@example.org' AND id IN (1, 2, 3) AND name = "Jane" -- note`, "mysql");
  assert.equal(s, "SELECT * FROM users WHERE email = ? AND id IN (?…) AND name = ?");
  assert.equal(norm("INSERT INTO t (a, b) VALUES (1, 'x'), (2, 'y')", "mysql"), "INSERT INTO t (a, b) VALUES (?…)");
});
ok("normalize: double-quoted identifiers kept where they are identifiers, e-mails still removed", () => {
  assert.equal(norm('SELECT "id" FROM "public"."user" WHERE "mail" = \'x@example.net\'', "postgresql"), 'SELECT "id" FROM "public"."user" WHERE "mail" = ?');
  assert.ok(!norm('INSERT INTO o VALUES ("reader@example.org")', "sqlite").includes("reader"));
});
ok("normalize: placeholders and identifiers with digits untouched", () => {
  assert.equal(norm("SELECT t1.col2 FROM tab_3 WHERE a = $1 AND b = :name", "postgresql"), "SELECT t1.col2 FROM tab_3 WHERE a = $1 AND b = :name");
});

for (const file of fs.readdirSync(path.join(ROOT, "dashboards"))) {
  const d = JSON.parse(rd("dashboards/" + file));
  ok(file + ": datasources only through variables / import inputs", () => {
    const uids = new Set(); JSON.stringify(d, (k, v) => { if (k === "uid" && typeof v === "string" && v.startsWith("${") === false && v !== d.uid) uids.add(v); return v; });
    assert.deepEqual([...uids], []);
  });
  ok(file + ": Tempo metrics queries group by at most 5 attributes", () => {
    d.panels.flatMap((p) => p.targets).filter((t) => t.metricsQueryType).forEach((t) => {
      const by = (t.query.match(/\bby \(([^)]*)\)/) || [, ""])[1].split(",").filter((x) => x.trim());
      assert.ok(by.length <= 5, t.refId + " groups by " + by.length);
    });
  });
  ok(file + ": no panel mixes TraceQL search with TraceQL Metrics", () => {
    d.panels.forEach((p) => { const kinds = new Set(p.targets.filter((t) => t.queryType === "traceql").map((t) => (t.metricsQueryType ? "metrics" : "search"))); assert.ok(kinds.size <= 1, "panel " + p.id); });
  });
  ok(file + ": every Loki log query drops parsed labels (| keep)", () => {
    const logs = d.panels.flatMap((p) => p.targets).filter((x) => x.expr && x.expr.trim().startsWith("{"));
    logs.forEach((x) => assert.ok(/\| keep kind\s*$/.test(x.expr), x.refId));
  });
  ok(file + ": panel code has no console output", () => { d.panels.forEach((p) => assert.ok(!/console\.(log|info|debug|warn|error)/.test(p.options.onRender), "panel " + p.id)); });
}
console.log(`\n${n} checks passed`);
