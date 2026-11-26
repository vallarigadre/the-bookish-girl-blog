// Creates a PayPal order. Prices always come from the site's own shop data, never from the browser.
import { base, token, products, json, ensure } from "../../../lib/paypal.js";
export async function onRequestPost({ request, env }) {
  try {
    const { id, qty } = await request.json();
    const shop = await products(request, env);
    const p = shop.products.find((x) => x.id === id);
    if (!p || !p.live) return json({ error: "This item isn't available." }, 400);
    const q = Math.min(4, Math.max(1, parseInt(qty, 10) || 1));
    const cur = shop.currency || "USD";
    const unit = Number(p.price), ship = Number(p.shipping || 0);
    const items = (unit * q).toFixed(2), total = (unit * q + ship).toFixed(2);
    const r = await fetch(base(env) + "/v2/checkout/orders", {
      method: "POST",
      headers: { Authorization: "Bearer " + (await token(env)), "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: p.id,
          description: p.title.slice(0, 120),
          amount: { currency_code: cur, value: total, breakdown: { item_total: { currency_code: cur, value: items }, shipping: { currency_code: cur, value: ship.toFixed(2) } } },
          items: [{ name: p.title.slice(0, 120), quantity: String(q), unit_amount: { currency_code: cur, value: unit.toFixed(2) }, category: "PHYSICAL_GOODS" }],
        }],
        payment_source: { paypal: { experience_context: { brand_name: "The Bookish Girl", shipping_preference: "GET_FROM_FILE", user_action: "PAY_NOW" } } },
      }),
    });
    const j = await r.json();
    if (!r.ok || !j.id) return json({ error: "PayPal couldn't start the order." }, 502);
    if (env.DB) {
      await ensure(env.DB);
      await env.DB.prepare(`INSERT OR REPLACE INTO orders (id, product, qty, amount, currency, status, created) VALUES (?,?,?,?,?,?,?)`).bind(j.id, p.id, q, total, cur, "CREATED", new Date().toISOString()).run();
    }
    return json({ id: j.id });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}
