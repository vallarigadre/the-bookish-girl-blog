// Shared PayPal helpers. Secrets (Cloudflare Pages > Settings > Variables and secrets):
// PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, and PAYPAL_ENV ("live" for real payments; anything else uses the sandbox).
export const base = (env) => (String(env.PAYPAL_ENV || "").trim() === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");

export async function token(env) {
  const id = String(env.PAYPAL_CLIENT_ID || "").trim();
  const secret = String(env.PAYPAL_CLIENT_SECRET || "").trim();
  if (!id || !secret) throw new Error("PayPal is not set up yet");
  const r = await fetch(base(env) + "/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(id + ":" + secret), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error("PayPal sign-in failed (" + r.status + ")");
  return (await r.json()).access_token;
}

export async function products(request, env) {
  const r = await env.ASSETS.fetch(new Request(new URL("/shop-data.json", request.url)));
  return r.json();
}

export const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function ensure(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, product TEXT, qty INTEGER, amount TEXT, currency TEXT, status TEXT, email TEXT, name TEXT, ship TEXT, created TEXT NOT NULL, captured TEXT)`).run();
}
