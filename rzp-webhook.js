// Razorpay Dashboard > Webhooks: https://YOUR-SITE/api/rzp-webhook  events: payment.captured, subscription.charged, subscription.activated
import { hmac, safeEq, minPaise, daysFor, extend } from "../../lib/util.js";
export async function onRequestPost({ request, env }) {
  const body = await request.text();
  if (!env.RZP_WEBHOOK_SECRET || !safeEq(await hmac(env.RZP_WEBHOOK_SECRET, body), request.headers.get("x-razorpay-signature") || "")) return new Response("bad", { status: 400 });
  const e = JSON.parse(body), p = e.payload?.payment?.entity;
  const eid = request.headers.get("x-razorpay-event-id") || e.event + ":" + (p?.id || "");
  const seen = await env.DB.prepare("INSERT OR IGNORE INTO events(id,created) VALUES(?,?)").bind(eid, Date.now()).run();
  if (seen.meta.changes !== 1) return new Response("ok");
  if (p && p.status === "captured" && p.amount >= minPaise(env)) {
    const email = String(p.email || "").toLowerCase();
    const u = email ? await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first() : null;
    const ins = await env.DB.prepare("INSERT OR IGNORE INTO payments(id,email,amount,used,created) VALUES(?,?,?,?,?)").bind(p.id, email, p.amount, u ? 1 : 0, Date.now()).run();
    if (u && ins.meta.changes === 1) await extend(env, u.id, daysFor(env, p.amount));
  }
  return new Response("ok");
}
