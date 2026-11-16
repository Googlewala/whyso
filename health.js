import { json } from "../../lib/util.js";
export async function onRequestGet({ env }) {
  try { await env.DB.prepare("SELECT 1").first(); return json({ ok: true }); } catch { return json({ ok: false }, 503); }
}
