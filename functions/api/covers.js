// Official Amazon cover images for the book and product cards, through the Amazon Creators API.
// GET /api/covers?asins=ASIN1,ASIN2  ->  {"ASIN1":"https://m.media-amazon.com/...jpg", ...}
// Secrets (Cloudflare Pages > Settings > Variables and secrets): AMAZON_CREDENTIAL_ID,
// AMAZON_CREDENTIAL_SECRET, AMAZON_CREDENTIAL_VERSION (for example v3.1).
// Amazon's rules: images are shown straight from Amazon's servers and refreshed at least every 24 hours,
// so each image URL is kept in the D1 database for 23 hours and then fetched again.
const TAG = "creativedi03c-20";
const MARKET = "www.amazon.com";
const FRESH_MS = 23 * 3600 * 1000;
const MISS_MS = 6 * 3600 * 1000;
const ASIN = /^[A-Z0-9]{10}$/;

function tokenEndpoint(version) {
  const v = String(version || "3.1").replace(/^v/i, "");
  if (v.startsWith("3.2")) return "https://api.amazon.co.uk/auth/o2/token";
  if (v.startsWith("3.3")) return "https://api.amazon.co.jp/auth/o2/token";
  return "https://api.amazon.com/auth/o2/token";
}

async function ensure(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS covers (asin TEXT PRIMARY KEY, url TEXT, fetched INTEGER NOT NULL)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, expires INTEGER NOT NULL)`).run();
}

async function getToken(env, db) {
  const now = Date.now();
  const row = await db.prepare(`SELECT v, expires FROM kv WHERE k = 'amazon_token'`).first();
  if (row && row.expires > now + 60000) return row.v;
  const r = await fetch(tokenEndpoint(env.AMAZON_CREDENTIAL_VERSION), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: String(env.AMAZON_CREDENTIAL_ID).trim(),
      client_secret: String(env.AMAZON_CREDENTIAL_SECRET).trim(),
      scope: "creatorsapi::default",
    }),
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const ttl = Math.max(300, (j.expires_in || 3600) - 120) * 1000;
  await db.prepare(`INSERT OR REPLACE INTO kv (k, v, expires) VALUES ('amazon_token', ?, ?)`).bind(j.access_token, now + ttl).run();
  return j.access_token;
}

async function getItems(token, batch) {
  const r = await fetch("https://creatorsapi.amazon/catalog/v1/getItems", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "x-marketplace": MARKET },
    body: JSON.stringify({
      itemIds: batch,
      itemIdType: "ASIN",
      marketplace: MARKET,
      partnerTag: TAG,
      resources: ["images.primary.large"],
    }),
  });
  if (!r.ok) throw new Error(`getItems ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const found = {};
  for (const it of (j.itemResults && j.itemResults.items) || []) {
    const u = it && it.images && it.images.primary && it.images.primary.large && it.images.primary.large.url;
    if (it.asin && u && /^https:\/\/[a-z0-9.-]*(media-amazon|ssl-images-amazon|images-amazon)\.com\//.test(u)) found[it.asin] = u;
  }
  return found;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const debug = url.searchParams.get("debug") === "1";
  const asins = [...new Set((url.searchParams.get("asins") || "").split(",").map((s) => s.trim().toUpperCase()).filter((a) => ASIN.test(a)))].slice(0, 40);
  const out = {};
  const idv = String(env.AMAZON_CREDENTIAL_ID || "").trim();
  const info = { idShape: idv ? idv.slice(0, 18) + "... (" + idv.length + " chars)" : "", secretLen: String(env.AMAZON_CREDENTIAL_SECRET || "").trim().length, version: String(env.AMAZON_CREDENTIAL_VERSION || ""), configured: !!(env.AMAZON_CREDENTIAL_ID && env.AMAZON_CREDENTIAL_SECRET), cached: 0, fetched: 0, errors: [] };
  try {
    if (asins.length && env.DB) {
      const db = env.DB;
      await ensure(db);
      const now = Date.now();
      const need = [];
      for (const a of asins) {
        const row = await db.prepare(`SELECT url, fetched FROM covers WHERE asin = ?`).bind(a).first();
        const ok = row && (row.url ? now - row.fetched < FRESH_MS : now - row.fetched < MISS_MS);
        if (ok) {
          if (row.url) out[a] = row.url;
          info.cached++;
        } else need.push(a);
      }
      if (need.length && info.configured) {
        const token = await getToken(env, db);
        for (let i = 0; i < need.length; i += 10) {
          const batch = need.slice(i, i + 10);
          if (i) await new Promise((r) => setTimeout(r, 1100));
          const found = await getItems(token, batch);
          for (const a of batch) {
            if (found[a]) out[a] = found[a];
            await db.prepare(`INSERT OR REPLACE INTO covers (asin, url, fetched) VALUES (?, ?, ?)`).bind(a, found[a] || "", Date.now()).run();
          }
          info.fetched += batch.length;
        }
      }
    }
  } catch (e) {
    info.errors.push(String(e && e.message ? e.message : e).slice(0, 400));
    console.error("covers failed", e);
  }
  const body = debug ? { covers: out, info } : out;
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", "Cache-Control": debug ? "no-store" : "public, max-age=3600" },
  });
}
