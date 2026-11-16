import { json, sign } from "../../lib/util.js";
export async function onRequestPost({ request, env }) {
  const { credential } = await request.json().catch(() => ({}));
  const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(credential || ""));
  const g = await r.json();
  if (!r.ok || g.aud !== env.GOOGLE_CLIENT_ID || String(g.email_verified) !== "true") return json({ error: "Sign-in failed" }, 401);
  await env.DB.prepare("INSERT INTO users(id,email,created) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email")
    .bind(g.sub, String(g.email).toLowerCase(), Date.now()).run();
  return json({ token: await sign(g.sub, env), email: g.email });
}
