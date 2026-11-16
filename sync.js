// One JSON blob per user per month + "meta". Server enforces the free-plan limits on what it stores.
import { auth, json } from "../../lib/util.js";
const FREE_DAYS = 30, FREE_PAY = 20, FREE_ENTRIES = 100;
export async function onRequestPost({ request, env }) {
  const uid = await auth(request, env);
  if (!uid) return json({ error: "auth" }, 401);
  const now = Date.now();
  const b = await request.json().catch(() => ({}));
  const since = +b.since || 0, blobs = b.blobs || {};
  const u = await env.DB.prepare("SELECT created,plan_until FROM users WHERE id=?").bind(uid).first();
  const paid = (u?.plan_until || 0) > now, trial = now - (u?.created || now) < FREE_DAYS * 864e5;
  const month = "tx:" + new Date(now).toISOString().slice(0, 7);
  const keys = [], limit = [];
  for (const k of Object.keys(blobs).slice(0, 40)) {
    if (!/^(meta|tx:\d{4}-\d{2})$/.test(k) || typeof blobs[k] !== "string" || blobs[k].length > 900000) continue;
    let d; try { d = JSON.parse(blobs[k]); } catch { return json({ error: "bad data" }, 400); }
    if (k === month && !paid && !trial && Array.isArray(d)) {
      const pay = d.filter((t) => t.kind === "pay").length, exp = d.filter((t) => t.kind === "exp").length;
      if (pay > FREE_PAY || exp > FREE_ENTRIES) { limit.push(k); continue; }
    }
    keys.push(k);
  }
  if (keys.length) {
    await env.DB.batch(keys.map((k) => env.DB.prepare("INSERT INTO blobs(uid,k,v,updated) VALUES(?,?,?,?) ON CONFLICT(uid,k) DO UPDATE SET v=excluded.v,updated=excluded.updated").bind(uid, k, blobs[k], now)));
  }
  const { results } = await env.DB.prepare("SELECT k,v FROM blobs WHERE uid=? AND updated>?").bind(uid, since).all();
  const out = {};
  for (const r of results) if (!keys.includes(r.k)) out[r.k] = r.v;
  return json({ now, blobs: out, plan: paid, limit });
}
