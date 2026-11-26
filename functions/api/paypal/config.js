// Tells the checkout page which PayPal account to load. The client ID is public by design; the secret never leaves the server.
import { json } from "../../../lib/paypal.js";
export async function onRequestGet({ env }) {
  return json({ clientId: String(env.PAYPAL_CLIENT_ID || "").trim(), live: String(env.PAYPAL_ENV || "").trim() === "live" });
}
