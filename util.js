// Shared helpers for the API (Cloudflare Pages Functions).
const enc = new TextEncoder();
export const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
export async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return [...new Uint8Array(s)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function safeEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
export async function sign(uid, env) {
  const p = uid + "." + (Date.now() + 90 * 864e5);
  return p + "." + (await hmac(env.SESSION_SECRET, p));
}
export async function auth(req, env) {
  const t = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  const [uid, exp, sig] = t.split(".");
  if (!uid || !exp || !sig || +exp < Date.now()) return null;
  return safeEq(sig, await hmac(env.SESSION_SECRET, uid + "." + exp)) ? uid : null;
}
export const minPaise = (env) => Math.round(Number(env.PLAN_PRICE_RUPEES || 20) * 100);
export const daysFor = (env, paise) => (paise >= Math.round(Number(env.YEAR_PRICE_RUPEES || 199) * 100) ? 370 : 35);
export async function extend(env, uid, days) {
  await env.DB.prepare("UPDATE users SET plan_until=MAX(COALESCE(plan_until,0),?)+? WHERE id=?").bind(Date.now(), days * 864e5, uid).run();
}
