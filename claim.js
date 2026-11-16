// Lets a signed-in user attach a payment made with a different email. Verified against Razorpay, one use per payment.
import { auth, json, minPaise, daysFor, extend } from "../../lib/util.js";
export async function onRequestPost({ request, env }) {
  const uid = await auth(request, env);
  if (!uid) return json({ ok: false, error: "Sign in first" }, 401);
  const { payment_id: id } = await request.json().catch(() => ({}));
  if (!/^pay_[A-Za-z0-9]{8,30}$/.test(id || "")) return json({ ok: false, error: "That does not look like a payment ID." });
  const row = await env.DB.prepare("SELECT used FROM payments WHERE id=?").bind(id).first();
  if (row?.used) return json({ ok: false, error: "That payment was already applied." });
  const r = await fetch("https://api.razorpay.com/v1/payments/" + id, { headers: { Authorization: "Basic " + btoa(env.RZP_KEY_ID + ":" + env.RZP_KEY_SECRET) } });
  const p = await r.json();
  if (!r.ok || p.status !== "captured" || p.amount < minPaise(env)) return json({ ok: false, error: "Payment not found or not completed." });
  const mark = row
    ? await env.DB.prepare("UPDATE payments SET used=1 WHERE id=? AND used=0").bind(id).run()
    : await env.DB.prepare("INSERT OR IGNORE INTO payments(id,email,amount,used,created) VALUES(?,?,?,1,?)").bind(id, String(p.email || "").toLowerCase(), p.amount, Date.now()).run();
  if (mark.meta.changes !== 1) return json({ ok: false, error: "That payment was already applied." });
  await extend(env, uid, daysFor(env, p.amount));
  return json({ ok: true });
}
