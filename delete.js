import { auth, json } from "../../lib/util.js";
export async function onRequestPost({ request, env }) {
  const uid = await auth(request, env);
  if (!uid) return json({ error: "auth" }, 401);
  await env.DB.batch([env.DB.prepare("DELETE FROM blobs WHERE uid=?").bind(uid), env.DB.prepare("DELETE FROM users WHERE id=?").bind(uid)]);
  return json({ ok: true });
}
