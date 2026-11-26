// Tells the checkout page which PayPal account to load. The client ID is public by design; the secret never leaves the server.
// ?check=1 also confirms PayPal accepts the keys (reports ok true/false only).
import { token, json } from "../../../lib/paypal.js";
export async function onRequestGet({ request, env }) {
  const out = { clientId: String(env.PAYPAL_CLIENT_ID || "").trim(), live: String(env.PAYPAL_ENV || "").trim() === "live" };
  if (new URL(request.url).searchParams.get("check")) {
    try { out.keysOk = !!(await token(env)); } catch (e) { out.keysOk = false; }
  }
  return json(out);
}
