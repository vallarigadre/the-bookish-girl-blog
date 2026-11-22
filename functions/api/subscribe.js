// Free printable signup form. Saves the email in the D1 database bound as DB and sends the reader to /thanks/.
// To download the list: GET /api/subscribe with the ADMIN_KEY secret in the x-key header (returns CSV).
const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,}$/i;

async function ensure(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS subscribers (email TEXT PRIMARY KEY, created TEXT NOT NULL, page TEXT)`).run();
}

export async function onRequestPost({ request, env }) {
  const back = new URL("/thanks/", request.url);
  try {
    const form = await request.formData();
    if ((form.get("company") || "").toString().trim()) return Response.redirect(back, 303);
    const email = (form.get("email") || "").toString().trim().toLowerCase();
    if (!EMAIL.test(email)) return Response.redirect(new URL("/freebies/?signup=invalid", request.url), 303);
    const page = new URL(request.headers.get("referer") || "/", request.url).pathname.slice(0, 200);
    if (env.DB) {
      await ensure(env.DB);
      await env.DB.prepare(`INSERT OR IGNORE INTO subscribers (email, created, page) VALUES (?,?,?)`).bind(email, new Date().toISOString(), page).run();
    }
  } catch (e) {
    console.error("signup failed", e);
  }
  return Response.redirect(back, 303);
}

export async function onRequestGet({ request, env }) {
  if (!env.ADMIN_KEY || request.headers.get("x-key") !== env.ADMIN_KEY) return new Response("Not found", { status: 404 });
  await ensure(env.DB);
  const { results } = await env.DB.prepare(`SELECT email, created, page FROM subscribers ORDER BY created`).all();
  const csv = ["email,signed_up,page", ...results.map((r) => [r.email, r.created, r.page].map((v) => `"${String(v || "").replace(/"/g, '""')}"`).join(","))].join("\n");
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store" } });
}
