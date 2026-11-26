// Captures an approved PayPal order and saves the buyer and shipping details for fulfilment in Printify.
// To download orders: GET /api/paypal/capture with the ADMIN_KEY secret in the x-key header (returns CSV).
import { base, token, json, ensure } from "../../../lib/paypal.js";
export async function onRequestPost({ request, env }) {
  try {
    const { orderID } = await request.json();
    if (!/^[A-Z0-9]{10,25}$/.test(orderID || "")) return json({ error: "Bad order" }, 400);
    const r = await fetch(base(env) + `/v2/checkout/orders/${orderID}/capture`, {
      method: "POST",
      headers: { Authorization: "Bearer " + (await token(env)), "Content-Type": "application/json" },
    });
    const j = await r.json();
    const status = j.status || (j.details && j.details[0] && j.details[0].issue) || "ERROR";
    if (env.DB) {
      await ensure(env.DB);
      const pu = (j.purchase_units || [])[0] || {};
      const sh = pu.shipping || {};
      await env.DB.prepare(`UPDATE orders SET status = ?, email = ?, name = ?, ship = ?, captured = ? WHERE id = ?`).bind(
        status, (j.payer && j.payer.email_address) || "", (sh.name && sh.name.full_name) || "", JSON.stringify(sh.address || {}), new Date().toISOString(), orderID
      ).run();
    }
    return json({ status });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}
export async function onRequestGet({ request, env }) {
  if (!env.ADMIN_KEY || request.headers.get("x-key") !== env.ADMIN_KEY) return new Response("Not found", { status: 404 });
  await ensure(env.DB);
  const { results } = await env.DB.prepare(`SELECT * FROM orders ORDER BY created DESC`).all();
  const cols = ["id", "product", "qty", "amount", "currency", "status", "email", "name", "ship", "created", "captured"];
  const csv = [cols.join(","), ...results.map((r) => cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv" } });
}
