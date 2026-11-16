import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { hmac, sign, auth } from "../lib/util.js";
import { onRequestPost as webhook } from "../functions/api/rzp-webhook.js";

const src = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
function grab(name) {
  const i = src.indexOf("function " + name + "(");
  let d = 0;
  for (let k = src.indexOf("{", i); k < src.length; k++) {
    if (src[k] === "{") d++;
    else if (src[k] === "}" && --d === 0) return src.slice(i, k + 1);
  }
}
const ctx = { URLSearchParams, document: { createElement: () => { let t = ""; return { set textContent(v) { t = String(v); }, get innerHTML() { return t.replace(/&/g, "&amp;").replace(/</g, "&lt;"); } }; } } };
vm.createContext(ctx);
vm.runInContext(["esc", "inr", "dnum", "parseUPI", "settle"].map(grab).join("\n"), ctx);

test("parseUPI reads a merchant QR", () => {
  const u = ctx.parseUPI("upi://pay?pa=shop@okbank&pn=Chai%20Point&am=40&tn=tea&mc=5812&tr=ABC123");
  assert.equal(u.pa, "shop@okbank"); assert.equal(u.pn, "Chai Point"); assert.equal(u.am, 40); assert.equal(u.mc, "5812"); assert.equal(u.tr, "ABC123");
});
test("parseUPI rejects non-UPI text and bad UPI IDs", () => {
  assert.equal(ctx.parseUPI("https://example.com"), null);
  assert.equal(ctx.parseUPI("upi://pay?pa=nope&pn=X"), null);
});
test("trip settle: one payer, three travellers", () => {
  const r = ctx.settle(["Me", "Amit", "Riya"], [{ amt: 300, pb: "Me" }]);
  assert.equal(r.out.length, 2); assert.equal(r.sh, 100);
});
test("trip settle: equal spending needs no payments", () => {
  assert.equal(ctx.settle(["A", "B"], [{ amt: 50, pb: "A" }, { amt: 50, pb: "B" }]).out.length, 0);
});
test("dnum counts days between dates", () => assert.equal(ctx.dnum("2026-11-10", "2026-11-07"), 3));
test("HMAC-SHA256 matches the known test vector", async () => {
  assert.equal(await hmac("key", "The quick brown fox jumps over the lazy dog"), "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
});
test("session token verifies and rejects tampering", async () => {
  const env = { SESSION_SECRET: "s3cret-s3cret-s3cret" };
  const t = await sign("12345", env);
  const req = (x) => new Request("https://x.test", { headers: { Authorization: "Bearer " + x } });
  assert.equal(await auth(req(t), env), "12345");
  assert.equal(await auth(req(t.slice(0, -2) + "00"), env), null);
  assert.equal(await auth(req(t), { SESSION_SECRET: "other-secret-other" }), null);
});
test("webhook rejects a bad signature", async () => {
  const res = await webhook({ request: new Request("https://x.test", { method: "POST", body: "{}", headers: { "x-razorpay-signature": "bad" } }), env: { RZP_WEBHOOK_SECRET: "whsec" } });
  assert.equal(res.status, 400);
});
