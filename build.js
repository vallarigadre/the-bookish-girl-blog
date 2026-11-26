// The Bookish Girl blog: static site builder.
// Reads posts/*.md and pages/*.md, writes a complete site to dist/.
// Run locally with `npm run build`. Netlify runs the same command on every deploy.

const fs = require("fs");
const CSS_VERSION = require("crypto").createHash("md5").update(require("fs").readFileSync(require("path").join(__dirname, "static/style.css"))).digest("hex").slice(0, 10);
const path = require("path");
const T_VERSION = require("crypto").createHash("md5").update(fs.readFileSync(path.join(__dirname, "static/t.js"))).digest("hex").slice(0, 10);
const matter = require("gray-matter");
const { marked } = require("marked");

const ROOT = __dirname;
const OUT = path.join(ROOT, "dist");
const site = JSON.parse(fs.readFileSync(path.join(ROOT, "site.config.json"), "utf8"));
const SITE_URL = site.url.replace(/\/$/, "");

marked.setOptions({ gfm: true });

// ---------- helpers ----------
const esc = (s = "") =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const slugify = (s) =>
  String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

const stripEmDashes = (s) => s.replace(/\s*—\s*/g, ", ");

function write(rel, html) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}

function formatDate(d) {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

function sectionFor(name) {
  const want = String(name || "").toLowerCase().trim();
  const found = site.sections.find((s) => s.name.toLowerCase() === want || s.slug === want || (s.aliases || []).some((a) => a.toLowerCase() === want));
  return found || site.sections[0];
}

// Guess a section when a post file has no category in its front matter.
function guessSection(text) {
  const t = text.toLowerCase();
  const score = (words) => words.reduce((n, w) => n + (t.split(w).length - 1), 0);
  const gifts = score(["gift", "stocking stuffer", "present"]);
  const fantasy = score(["romantasy", "fae", "dragon", "fantasy"]);
  const gear = score(["kindle paperwhite", "e-reader", "audiobook", "reading light", "reading nook"]);
  const best = Math.max(gifts, fantasy, gear);
  if (best === 0) return "Book Lists";
  if (best === gifts) return "Gift Guides";
  if (best === fantasy) return "Romantasy";
  return "Kindle & Reading";
}

// Clean up a raw file from the scheduled task if it was dropped in as is:
// remove the private "Editor notes" block and pull the title from the first H1.
function cleanRawMarkdown(body) {
  let b = body.replace(/\r\n/g, "\n");
  b = b.replace(/^#{1,3}[^\n]*editor notes[\s\S]*?(?=^---\s*$|^#\s)/im, "");
  b = b.replace(/^---\s*\n/, "");
  return b.trim();
}

// Book and product cards. In a post, a line
//   {{book title="..." author="..." link="..." cover="" tropes="a, b" ku="yes" series="..." heat="..."}}
// or {{pick name="..." link="..." image="" label="..."}}
// becomes a card; the paragraph right after it becomes the card's description.
function attrs(str) {
  const o = {};
  str.replace(/([a-z_]+)\s*=\s*"([^"]*)"/gi, (m, k, v) => { o[k.toLowerCase()] = v; return m; });
  return o;
}
function bookCards(md) {
  return md.replace(/^\{\{\s*(book|pick)\s+([^\n]*?)\}\}[ \t]*\n?((?:(?!\s*\n)(?!\{\{)[^\n]+\n?)*)/gim, (m, kind, a, desc) => {
    const o = attrs(a);
    const isBook = kind.toLowerCase() === "book";
    const title = o.title || o.name || "";
    const link = o.link || "#";
    const img = o.cover || o.image || "";
    const ku = /^(yes|true|ku)$/i.test(o.ku || "");
    const tropes = (o.tropes || "").split(",").map((t) => t.trim()).filter(Boolean);
    const coverHtml = img
      ? `<img src="${esc(img)}" alt="${esc(isBook ? `Cover of ${title} by ${o.author || ""}` : title)}" loading="lazy">`
      : `<span class="book__ph"><span class="book__ph-t">${esc(title)}</span>${o.author ? `<span class="book__ph-a">${esc(o.author)}</span>` : ""}</span>`;
    const asin = /^[A-Z0-9]{10}$/.test(o.asin || "") ? o.asin : ((link.match(/\/dp\/([A-Z0-9]{10})/) || [])[1] || "");
    const coverAlt = isBook ? `Cover of ${title} by ${o.author || ""}` : title;
    const descHtml = desc.trim() ? `<div class="book__desc">${marked.parse(desc.trim())}</div>` : "";
    return `<div class="book${isBook ? "" : " book--pick"}">
<a class="book__cover${/-3d\./.test(img) ? " book__cover--3d" : ""}" href="${esc(link)}"${asin ? ` data-asin="${asin}" data-alt="${esc(coverAlt)}"` : ""}>${coverHtml}</a>
<div class="book__body">
${ku ? `<p class="book__badges"><span class="badge badge--ku">Free on Kindle Unlimited</span></p>` : ""}
<h3 class="book__title"><a href="${esc(link)}">${esc(title)}</a></h3>
${o.author ? `<p class="book__author">by ${esc(o.author)}</p>` : ""}
${o.series || o.heat ? `<p class="book__meta">${[o.series, o.heat ? "Heat: " + o.heat : ""].filter(Boolean).map(esc).join(" · ")}</p>` : ""}
${tropes.length ? `<p class="book__tropes">${tropes.map((t) => `<span>${esc(t)}</span>`).join("")}</p>` : ""}
${descHtml}
<p class="book__buy"><a class="book__btn" href="${esc(link)}">${esc(o.label || (isBook ? "Check on Amazon" : "See it on Amazon"))}</a></p>
</div>
</div>

`;
  });
}

// Tag Amazon links, mark them sponsored, and open outside links in a new tab.
function processLinks(html) {
  return html.replace(/<a href="([^"]+)"([^>]*)>/g, (m, href, rest) => {
    let url = href.replace(/&amp;/g, "&");
    const isAmazon = /^https?:\/\/(www\.)?(amazon\.com|amzn\.to|a\.co|link\.amazon)\//i.test(url);
    if (isAmazon && /amazon\.com/i.test(url) && site.amazonTag) {
      if (/[?&]tag=/.test(url)) url = url.replace(/([?&])tag=[^&#]*/, "$1tag=" + site.amazonTag);
      else url += (url.includes("?") ? "&" : "?") + "tag=" + site.amazonTag;
    }
    const external = /^https?:\/\//i.test(url) && !url.startsWith(SITE_URL);
    let attrs = "";
    if (isAmazon) attrs = ' rel="sponsored nofollow noopener" target="_blank" class="shop-link"';
    else if (external) attrs = ' rel="noopener" target="_blank"';
    return `<a href="${esc(url)}"${rest}${attrs}>`;
  });
}

// In-story photos: show the ones that exist in static/images, hide the rest until uploaded.
function inlinePhotos(html) {
  return html.replace(/<p>\s*<img src="(\/images\/[^"]+)" alt="([^"]*)"[^>]*>\s*<\/p>/g, (m, src, alt) =>
    fs.existsSync(path.join(ROOT, "static", src))
      ? `<figure class="story-photo"><img src="${src}" alt="${alt}" loading="lazy"></figure>`
      : "");
}

// "**The splurge:** ..." and "**The everyday:** ..." paragraphs become labelled pick cards.
// A product photo written at the start of a pick (![alt](/images/x.jpg)) shows as a small photo
// beside the text once the file is in static/images, and stays hidden until then.
function renderPicks(html) {
  return html.replace(/<p><strong>The (splurge|everyday):?<\/strong>:?\s*(?:<img src="(\/images\/[^"]+)" alt="([^"]*)"[^>]*>\s*)?([\s\S]*?)<\/p>/gi, (m, kind, src, alt, rest) => {
    const k = kind.toLowerCase();
    const photo = src && fs.existsSync(path.join(ROOT, "static", src));
    const text = `<span class="pick__label">The ${k}</span>${rest}`;
    return photo
      ? `<div class="pick pick--${k} pick--photo"><img class="pick__img" src="${src}" alt="${alt}" loading="lazy" width="200" height="200"><p>${text}</p></div>`
      : `<p class="pick pick--${k}">${text}</p>`;
  });
}

// Give every h2 an id so the Quick picks box can jump to it.
function headingIds(html) {
  const used = {};
  return html.replace(/<h2>([\s\S]*?)<\/h2>/g, (m, inner) => {
    let id = slugify(inner.replace(/<[^>]+>/g, "")) || "section";
    used[id] = (used[id] || 0) + 1;
    if (used[id] > 1) id += "-" + used[id];
    return `<h2 id="${id}">${inner}</h2>`;
  });
}

// Quick picks: one row per section that has a splurge or everyday pick, built from the pick cards.
function quickPicks(html) {
  const rows = [];
  const parts = html.split(/(?=<h2 id=")/);
  for (const part of parts) {
    const h = part.match(/^<h2 id="([^"]+)">([\s\S]*?)<\/h2>/);
    if (!h) continue;
    const pick = (kind) => {
      const m = part.match(new RegExp(`class="pick pick--${kind}[^"]*">[\\s\\S]*?(<a href="[^"]+"[^>]*>[\\s\\S]*?<\\/a>)`));
      return m ? m[1] : "";
    };
    const splurge = pick("splurge"), everyday = pick("everyday");
    if (!splurge && !everyday) continue;
    const label = h[2].replace(/<[^>]+>/g, "").replace(/^Step \d+:\s*/i, "");
    rows.push(`<tr><th scope="row"><a href="#${h[1]}">${label}</a></th><td>${splurge || "&nbsp;"}</td><td>${everyday || "&nbsp;"}</td></tr>`);
  }
  if (rows.length < 2) return html;
  const box = `<aside class="quickpicks" aria-labelledby="qp-h"><p class="quickpicks__h" id="qp-h">Quick picks</p>
  <table><thead><tr><th scope="col">For</th><th scope="col">The splurge</th><th scope="col">The everyday</th></tr></thead><tbody>${rows.join("")}</tbody></table></aside>`;
  const i = html.indexOf('<h2 id="');
  return i < 0 ? html : html.slice(0, i) + box + "\n" + html.slice(i);
}

// FAQ: an h2 called FAQ (or "Frequently asked questions") followed by h3 questions.
function faqBlock(html) {
  const faq = [];
  const out = html.replace(/<h2 id="([^"]+)">(FAQ|FAQs|Frequently asked questions|Your questions, answered)<\/h2>([\s\S]*?)(?=<h2 id="|$)/i, (m, id, title, rest) => {
    const qs = rest.split(/(?=<h3>)/).filter((x) => x.startsWith("<h3>"));
    qs.forEach((q) => {
      const mm = q.match(/^<h3>([\s\S]*?)<\/h3>([\s\S]*)$/);
      if (mm) faq.push({ q: mm[1].replace(/<[^>]+>/g, "").trim(), a: mm[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() });
    });
    return `<section class="faq" aria-labelledby="${id}"><h2 id="${id}">${title}</h2>${rest}</section>`;
  });
  return { html: out, faq };
}

// ---------- load posts ----------
function loadPosts() {
  const dir = path.join(ROOT, "posts");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .map((file) => {
      const raw = fs.readFileSync(path.join(dir, file), "utf8");
      const { data, content } = matter(raw);
      let body = cleanRawMarkdown(content);

      let title = data.title;
      if (!title) {
        const h1 = body.match(/^#\s+(.+)$/m);
        if (h1) { title = h1[1].trim(); body = body.replace(h1[0], "").trim(); }
      }
      // A post that repeats its title as an H1 at the top: drop the duplicate.
      if (title) body = body.replace(new RegExp("^#\\s+" + title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\n"), "");

      const updated = data.updated ? (data.updated instanceof Date ? data.updated : new Date(String(data.updated).slice(0, 10))) : null;
      const fileDate = file.match(/(\d{4}-\d{2}-\d{2})/);
      const date = data.date instanceof Date ? data.date : new Date(data.date ? String(data.date).slice(0, 10) : fileDate ? fileDate[1] : Date.now());

      const fileSlug = file.replace(/\.md$/, "").replace(/^blog-/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "");
      const slug = data.slug || fileSlug || slugify(title);
      const section = sectionFor(data.category || guessSection(body));

      body = bookCards(stripEmDashes(body));
      let html = headingIds(renderPicks(shopBlocks(renderProducts(inlinePhotos(processLinks(marked.parse(body)))), "post")))
        .replace(/^\s*<p><em>([^<]*Amazon Associate[^<]*)<\/em><\/p>/i, '<p class="disclosure">$1</p>');
      if (data.quickpicks !== false) html = quickPicks(html);
      const faqOut = faqBlock(html);
      html = faqOut.html;
      if (data.verdict) {
        const v = `<aside class="verdict"><p class="verdict__h">The short answer</p><p>${esc(stripEmDashes(String(data.verdict)))}</p></aside>`;
        html = /^\s*<p class="disclosure">/.test(html) ? html.replace(/(<p class="disclosure">[\s\S]*?<\/p>)/, "$1" + v) : v + html;
      }
      const text = html.replace(/<[^>]+>/g, " ");
      const words = text.split(/\s+/).filter(Boolean).length;
      const firstPara = (html.match(/<p>([\s\S]*?)<\/p>/) || [, ""])[1].replace(/<[^>]+>/g, "");

      return {
        file, slug, title: stripEmDashes(title || slug), date,
        subtitle: data.subtitle ? stripEmDashes(data.subtitle) : "",
        description: stripEmDashes(data.description || firstPara.slice(0, 155)),
        section, tags: data.tags || [], tropes: (data.tropes || []).map((t) => slugify(t)), cover: data.cover || "", coverAlt: data.cover_alt || "",
        pinTitle: data.pin_title || "", pinDescription: data.pin_description || "",
        draft: data.draft === true,
        updated: updated && !isNaN(updated) ? updated : null,
        trending: data.trending === true,
        faq: faqOut.faq,
        hasDisclosure: /amazon associate/i.test(body),
        hasShopLinks: /class="shop-link"/.test(html),
        readMinutes: Math.max(3, Math.round(words / 230)),
        html, url: `/posts/${slug}/`,
      };
    })
    .sort((a, b) => b.date - a.date);
}

function loadPages() {
  const dir = path.join(ROOT, "pages");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((file) => {
    const { data, content } = matter(fs.readFileSync(path.join(dir, file), "utf8"));
    const slug = data.slug || file.replace(/\.md$/, "");
    return { slug, title: data.title || slug, description: data.description || "", html: processLinks(marked.parse(stripEmDashes(content))) };
  });
}


// ---------- your own products (from site.config.json "products") ----------
// In a post, a paragraph that is only {{product:ID}} becomes a product card.
const PRODUCTS = Object.fromEntries((site.products || []).map((p) => [p.id, p]));
function productCard(p, variant = "") {
  if (!p) return "";
  return `<aside class="product${variant ? " product--" + variant : ""}" aria-label="${esc(p.free ? "Free download" : "From the shop")}">
  <a class="product__img" href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" width="600" height="600"></a>
  <div class="product__body">
    <p class="product__kicker">${p.free ? "Free download" : esc(site.name)}</p>
    <p class="product__name"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a></p>
    <p class="product__blurb">${esc(p.blurb)}</p>
    <p class="product__buy"><a class="btn ${p.free ? "btn--sage" : "btn--peach"} product-link" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.button || (p.free ? "Get it free" : "Get it"))}</a><span class="product__price">${esc(p.price)}</span></p>
  </div>
</aside>`;
}

// V's own shop for this blog: Printify merch paid through PayPal on /checkout/, and Beacons digital products.
// Product data lives in shop.json. status "soon" shows a coming-soon box; "live" makes it buyable.
const shop = fs.existsSync(path.join(ROOT, "shop.json")) ? JSON.parse(fs.readFileSync(path.join(ROOT, "shop.json"), "utf8")) : null;
const shopProduct = (id) => shop && shop.products.find((p) => p.id === id);
const shopLive = (p) => p.status === "live" && (p.kind === "beacons" ? !!p.url : !!p.price);
// The shop stays hidden (no homepage row, no menu link) until at least one product is live.
const shopOpen = !!(shop && shop.products.some(shopLive));
function shopHref(p) {
  if (!shopLive(p)) return "";
  return p.kind === "beacons" ? p.url : `/checkout/?p=${encodeURIComponent(p.id)}`;
}
function shopCard(p) {
  const href = shopHref(p);
  const ext = href && p.kind === "beacons";
  const pic = p.image ? `<img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" width="600" height="600">` : `<span class="ownshop__ph" aria-hidden="true">${BOOK}</span>`;
  const inner = `${pic}
    <span class="ownshop__title">${esc(p.title)}</span>
    ${p.blurb ? `<span class="ownshop__blurb">${esc(p.blurb)}</span>` : ""}
    <span class="ownshop__price">${href ? (p.price ? `$${esc(p.price)}` : "Get it") : "Coming soon"}</span>`;
  return href
    ? `<a class="ownshop__item" href="${esc(href)}"${ext ? ' target="_blank" rel="noopener"' : ""}>${inner}</a>`
    : `<div class="ownshop__item ownshop__item--soon">${inner}</div>`;
}
function shopBlockHtml(items) {
  return `<aside class="ownshop" id="our-shop" aria-label="From The Bookish Girl shop">
  <p class="ownshop__kicker">From my own little shop</p>
  <div class="ownshop__grid ownshop__grid--${items.length}">${items.map((p) => shopCard(p)).join("")}</div>
  <p class="ownshop__note">${esc(shop.note || "")} <a href="/shop/">See the whole shop</a>.</p>
</aside>`;
}

function shopBlocks(html, place) {
  if (!shop) return html.replace(/<p>\s*\{\{shop:[^}]*\}\}\s*<\/p>/g, "");
  return html.replace(/<p>\s*\{\{shop:([^}]*)\}\}\s*<\/p>/g, (m, list) => {
    const items = list.split(",").map((h) => shopProduct(h.trim())).filter(Boolean).slice(0, 4);
    return items.length ? shopBlockHtml(items, place) : "";
  });
}
function renderProducts(html) {
  return html.replace(/<p>\s*\{\{\s*product:\s*([a-z0-9-]+)\s*\}\}\s*<\/p>/gi, (m, id) => productCard(PRODUCTS[id]) || "");
}

// ---------- pieces ----------
const BOOK = `<svg viewBox="0 0 160 160" aria-hidden="true"><path d="M24 44c22-10 40-8 56 6 16-14 34-16 56-6v80c-22-10-40-8-56 6-16-14-34-16-56-6z"/><path d="M80 50v80"/></svg>`;
const motifs = {
  skincare: BOOK,
  "book-lists": BOOK,
  romantasy: `<svg viewBox="0 0 160 160" aria-hidden="true"><path d="M34 112l10-56 22 28 14-40 14 40 22-28 10 56z"/><path d="M34 126h92"/></svg>`,
  "kindle-and-reading": `<svg viewBox="0 0 160 160" aria-hidden="true"><path d="M48 22h64a8 8 0 0 1 8 8v100a8 8 0 0 1-8 8H48a8 8 0 0 1-8-8V30a8 8 0 0 1 8-8z"/><path d="M52 36h56v76H52zM60 52h40M60 66h40M60 80h28"/></svg>`,
  "gift-guides": `<svg viewBox="0 0 160 160" aria-hidden="true"><path d="M32 70h96v76H32zM26 50h108v20H26zM80 50v96"/><path d="M80 50c-10-24-38-24-34-6 2 8 22 6 34 6zM80 50c10-24 38-24 34-6-2 8-22 6-34 6z"/></svg>`,
  fragrance: BOOK,
};

function cover(post, size = "md") {
  const s = post.section.slug;
  const coverReady = post.cover && (!post.cover.startsWith("/") || fs.existsSync(path.join(ROOT, "static", post.cover)));
  if (coverReady) {
    return `<div class="cover cover--${size} cover--photo"><img src="${esc(post.cover)}" alt="${esc(post.coverAlt || post.title)}" loading="${size === "lg" ? "eager" : "lazy"}"></div>`;
  }
  return `<div class="cover cover--${size} cover--${s}" aria-hidden="true">
    <span class="cover__section">${esc(post.section.name)}</span>
    <span class="cover__motif">${motifs[s] || motifs.skincare}</span>
    <span class="cover__title">${esc(post.title)}</span>
  </div>`;
}

function meta(post) {
  return `<p class="meta"><time datetime="${post.date.toISOString().slice(0, 10)}">${formatDate(post.date)}</time>, in <a href="/${post.section.slug}/">${esc(post.section.name)}</a>, ${post.readMinutes} min read</p>`;
}

function card(post) {
  return `<article class="card">
    <a class="card__link" href="${post.url}">${cover(post, "sm")}
      <h3 class="card__title">${esc(post.title)}</h3></a>
    <p class="card__dek">${esc(post.subtitle || post.description)}</p>
    ${meta(post)}
  </article>`;
}

const FREE = site.freebie || {};
const newsletter = !site.newsletter ? "" : `<section class="letter" aria-labelledby="letter-h">
  <div class="letter__inner">
    <div class="letter__art" aria-hidden="true">${FREE.image ? `<img src="${esc(FREE.image)}" alt="">` : `<span class="letter__card"><span>Romance</span><strong>Trope Bingo</strong><span>2027</span></span>`}</div>
    <div class="letter__text">
      <p class="kicker">Free printable</p>
      <h2 id="letter-h">${esc(FREE.title || "Get the romance trope bingo card")}</h2>
      <p>${esc(FREE.blurb || "")}</p>
      <form name="newsletter" method="POST" action="/api/subscribe" class="letter__form">
        <p class="hp"><label>Company <input name="company"></label></p>
        <label for="email" class="sr">Email address</label>
        <input id="email" type="email" name="email" placeholder="you@example.com" required autocomplete="email">
        <button type="submit">${esc(FREE.button || "Send it to me")}</button>
      </form>
      <p class="letter__fine">One short email of new romance lists each week. Unsubscribe anytime.</p>
    </div>
  </div>
</section>`;

const PREVIEW = {};
function layout({ title, description, body, path: pagePath = "/", image = "", imageAlt = "", type = "website", jsonld = "", noindex = false, published = null, tags = [] }) {
  if (!noindex) PREVIEW[pagePath] = { title: title || site.name, body };
  if (image && image.startsWith("/")) image = SITE_URL + image;
  const fullTitle = title ? `${title} | ${site.name}` : `${site.name}: ${site.tagline}`;
  const canonical = SITE_URL + pagePath;
  const cur = (u) => (pagePath.startsWith(u) ? ' aria-current="page"' : "");
  const navSection = (slug) => { const s = site.sections.find((x) => x.slug === slug); return s ? `<a href="/${s.slug}/"${cur("/" + s.slug + "/")}>${s.name}</a>` : ""; };
  const drop = (label, href, links) => `<div class="nav__drop"><a href="${href}"${cur(href)}>${label}</a><div class="nav__menu">${links.map(([t, u, c]) => `<a href="${u}"${c ? ` class="${c}"` : ""}>${esc(t)}</a>`).join("")}</div></div>`;
  const sec = (slug) => site.sections.find((x) => x.slug === slug);
  const romanceMenu = drop("Romance", "/book-lists/", [
    ["Romance book lists", "/book-lists/"],
    ...(sec("romantasy") ? [["Romantasy", "/romantasy/"]] : []),
    ...(site.tropes || []).slice(0, 8).map((t) => [t.name, `/tropes/${t.slug}/`]),
    ["All tropes", "/tropes/", "nav__all"],
  ]);
  const lifeMenu = drop("Reading life", "/kindle-and-reading/", [
    ...["kindle-and-reading", "gift-guides"].filter(sec).map((x) => [sec(x).name, `/${x}/`]),
    ...(site.freebie ? [["Free printables", "/freebies/"]] : []),
  ]);
  const nav = romanceMenu + navSection("mystery-and-thriller") + navSection("cozy-reads") + lifeMenu + (shopOpen ? `<a href="/shop/"${cur("/shop/")}>Shop</a>` : "");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description || site.description)}">
${noindex ? '<meta name="robots" content="noindex, nofollow">' : ""}
<link rel="canonical" href="${canonical}">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(title || site.name)}">
<meta property="og:description" content="${esc(description || site.description)}">
<meta property="og:type" content="${type}">
<meta property="og:url" content="${canonical}">
${image ? `<meta property="og:image" content="${esc(image)}">` : ""}
${image && imageAlt ? `<meta property="og:image:alt" content="${esc(imageAlt)}">` : ""}
<meta property="og:locale" content="en_US">
${published ? `<meta property="article:published_time" content="${published.toISOString()}">\n<meta property="article:author" content="${esc(site.author)}">` : ""}
${tags.map((t) => `<meta property="article:tag" content="${esc(t)}">`).join("\n")}
<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${esc(title || site.name)}">
<meta name="twitter:description" content="${esc(description || site.description)}">
${image ? `<meta name="twitter:image" content="${esc(image)}">` : ""}
${noindex ? "" : '<meta name="robots" content="index, follow, max-image-preview:large">'}
${site.googleSiteVerification ? `<meta name="google-site-verification" content="${esc(site.googleSiteVerification)}">` : ""}
${site.pinterestVerification ? `<meta name="p:domain_verify" content="${esc(site.pinterestVerification)}">` : ""}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${esc(site.name)}" href="/rss.xml">
<link rel="preload" href="/fonts/bodoni-moda-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/dm-sans-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/style.css?v=${CSS_VERSION}">
${jsonld}
${/^G-[A-Z0-9]+$/.test(site.googleAnalyticsId || "") ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${site.googleAnalyticsId}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("js",new Date());gtag("config","${site.googleAnalyticsId}");
document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a.shop-link");if(a)gtag("event","affiliate_click",{link_url:a.href,link_text:(a.textContent||"").trim().slice(0,100)});});</script>` : ""}
${noindex || !site.stats ? "" : `<script defer src="/t.js?v=${T_VERSION}"></script>`}
${site.cloudflareAnalyticsToken ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${esc(site.cloudflareAnalyticsToken)}"}'></script>` : ""}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${site.banner ? `<p class="topbar"><a href="${esc(site.banner.url)}"${/amazon\.com/.test(site.banner.url) ? ' rel="sponsored nofollow noopener" target="_blank" class="shop-link"' : ""}>${esc(site.banner.text)} <span aria-hidden="true">&rarr;</span></a></p>` : ""}
<header class="masthead">
  <div class="masthead__inner">
    <a class="wordmark" href="/"><span>${esc(site.name)}</span></a>
    <nav class="nav" aria-label="Sections">${nav}<a href="/about/"${pagePath === "/about/" ? ' aria-current="page"' : ""}>About</a></nav>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="foot">
  <div class="foot__inner">
    <div>
      <p class="wordmark wordmark--small">${esc(site.name)}</p>
      <p class="foot__tag">${esc(site.tagline)}</p>
    </div>
    <nav aria-label="Site">
      ${site.sections.map((s) => `<a href="/${s.slug}/">${s.name}</a>`).join("")}
      <a href="/tropes/">By trope</a>
      ${site.freebie ? `<a href="/freebies/">Freebies</a>` : ""}
      ${shopOpen ? `<a href="/shop/">Shop</a>` : ""}
      <a href="/archive/">All lists</a>
      <a href="/about/">About</a>
      <a href="/shipping-and-returns/">Shipping and returns</a>
      <a href="/disclosure/">Affiliate disclosure</a>
      <a href="/privacy/">Privacy</a>
      <a href="/rss.xml">RSS</a>
    </nav>
    <p class="foot__fine">As an Amazon Associate I earn from qualifying purchases. &copy; ${new Date().getFullYear()} ${esc(site.name)}</p>
  </div>
</footer>
<script>(function(){var c=document.querySelectorAll(".book__cover[data-asin]");if(!c.length||!window.fetch)return;var a=[];c.forEach(function(e){a.indexOf(e.dataset.asin)<0&&a.push(e.dataset.asin)});fetch("/api/covers?asins="+a.join(",")).then(function(r){return r.ok?r.json():{}}).then(function(m){c.forEach(function(e){var u=m[e.dataset.asin];if(!u)return;var i=new Image();i.onload=function(){i.alt=e.dataset.alt||"";e.innerHTML="";e.classList.remove("book__cover--3d");e.appendChild(i)};i.src=u})})["catch"](function(){})})();</script>
</body>
</html>`;
}

// ---------- pages ----------
function mini(post) {
  return `<article class="mini">
    <a class="mini__link" href="${post.url}">${cover(post, "sm")}<span class="mini__text"><span class="mini__section mini__section--${post.section.slug}">${esc(post.section.name)}</span><span class="mini__title">${esc(post.title)}</span></span></a>
  </article>`;
}

function homePage(posts) {
  const img = (f) => fs.existsSync(path.join(ROOT, "static/images", f));
  const newest = posts[0];
  const latest = posts.slice(1, 7);
  const heroImg = img("hero.jpg")
    ? `<img src="/images/hero.jpg" alt="${esc(site.heroAlt)}" fetchpriority="high">`
    : `<div class="ph ph--oat" aria-hidden="true">${BOOK}</div>`;

  // 1. What this blog is
  const hero = `<section class="hero wrap" aria-labelledby="hero-h">
  <div class="hero__text">
    <p class="kicker">Book recommendations for every mood</p>
    <h1 id="hero-h" class="hero__title"><span>Books worth</span><strong>losing sleep</strong><span>over</span></h1>
    <p class="hero__lede">Swoony romance by trope, twisty mysteries and thrillers, and cozy feel-good reads that feel like a hug. Every list marks the Kindle Unlimited books, so you can start reading tonight.</p>
    <p class="hero__genres"><a href="/book-lists/">Romance</a><a href="/mystery-and-thriller/">Mystery &amp; thriller</a><a href="/cozy-reads/">Cozy reads</a></p>
    <div class="hero__actions">
      <a class="btn btn--peach" href="#next-h">Find your next read</a>
      ${site.newsletter ? `<a class="btn btn--line" href="#letter-h">Get the free bingo card</a>` : ""}
    </div>
  </div>
  <div class="hero__media"><div class="hero__frame">${heroImg}</div></div>
</section>`;

  // 2. The newest post, always featured
  const featured = !newest ? "" : `<section class="newest wrap" aria-labelledby="newest-h">
  <a class="newest__card" href="${newest.url}">
    <span class="newest__img">${cover(newest, "lg")}</span>
    <span class="newest__text">
      <span class="kicker">My newest list</span>
      <strong id="newest-h" class="newest__title">${esc(newest.title)}</strong>
      <span class="newest__dek">${esc(newest.subtitle || newest.description)}</span>
      <span class="btn btn--peach newest__btn">Read it now</span>
    </span>
  </a>
</section>`;

  // 3. What to read next, by mood
  const tile = (t, i) => {
    const f = t.image && img(t.image);
    return `<a class="start start--${i + 1}${f ? "" : " start--plain"}" href="${esc(t.url)}">${f ? `<img src="/images/${esc(t.image)}" alt="" loading="lazy">` : ""}<span class="start__in"><strong>${esc(t.title)}</strong><span>${esc(t.sub)} &rarr;</span></span></a>`;
  };
  const readNext = `<section class="starts wrap" aria-labelledby="next-h">
  <p class="kicker center">Pick your mood</p>
  <h2 id="next-h" class="h-sec center">What to read next</h2>
  <div class="starts__grid">${(site.startHere || []).map(tile).join("")}</div>
  <p class="center starts__tropes">Love a good trope? <a href="/tropes/">Browse romance by trope</a></p>
</section>`;

  // 4. More lists
  const blog = !latest.length ? "" : `<section class="latest wrap" aria-labelledby="latest-h">
  <p class="kicker">Fresh off the shelf</p>
  <h2 id="latest-h" class="h-sec">Latest lists</h2>
  <div class="grid">${latest.map(card).join("")}</div>
  ${posts.length > 7 ? `<p class="center"><a class="btn btn--line" href="/archive/">See every list</a></p>` : ""}
</section>`;

  // 5. Shop
  const picks = shopOpen ? shop.products.filter(shopLive) : [];
  const shopRow = !picks.length ? "" : `<section class="free home-shop" aria-labelledby="shop-h">
  <div class="wrap">
    <p class="kicker center">My own little shop</p>
    <h2 id="shop-h" class="h-sec center">The Bookish Girl shop</h2>
    <p class="home-shop__dek center">Cozy things for readers: printables, trackers and bookish merch. ${esc(shop.note || "")}</p>
    <div class="ownshop__rail">${picks.map((p) => shopCard(p)).join("")}</div>
    <p class="center"><a class="btn btn--line" href="/shop/">Visit the shop</a></p>
  </div>
</section>`;

  // 6. About and the free printable
  const author = img("author.jpg")
    ? `<img src="/images/author.jpg" alt="${esc(site.authorPhotoAlt || "Vallari with a stack of books")}" loading="lazy">`
    : `<span class="ph ph--book-lists" aria-hidden="true">${BOOK}</span>`;
  const aboutStrip = `<section class="hello wrap" aria-labelledby="hello-h">
  <div class="hello__img">${author}</div>
  <div class="hello__text">
    <p class="kicker">Hi, I'm Vallari</p>
    <h2 id="hello-h" class="h-sec">A reader, every single day</h2>
    <p>${esc(site.authorBio || "")}</p>
    <p><a class="btn btn--line" href="/about/">More about me</a></p>
  </div>
</section>`;
  const body = `${hero}\n${featured}\n${readNext}\n${blog}\n${shopRow}\n${aboutStrip}\n${newsletter}`;
  write("index.html", layout({ path: "/", body, description: site.description }));
}

function sectionPages(posts) {
  for (const s of site.sections) {
    const list = posts.filter((p) => p.section.slug === s.slug);
    const body = `<section class="wrap listing">
      <header class="listing__head listing__head--${s.slug}"><h1>${s.name}</h1><p>${esc(s.blurb)}</p></header>
      ${list.length ? `<div class="grid">${list.map(card).join("")}</div>` : `<p class="empty-note">The first ${s.name.toLowerCase()} story is on its way. Meanwhile, <a href="/archive/">browse every story</a>.</p>`}
    </section>${newsletter}`;
    write(`${s.slug}/index.html`, layout({ title: s.name, description: s.blurb, path: `/${s.slug}/`, body }));
  }
}

function tropePages(posts) {
  const tropes = site.tropes || [];
  const tile = (t) => {
    const n = posts.filter((p) => p.tropes.includes(t.slug)).length;
    return `<a class="trope trope--big" href="/tropes/${t.slug}/"><span class="trope__e" aria-hidden="true">${esc(t.emoji || "")}</span><span><strong>${esc(t.name)}</strong><span class="trope__n">${n ? `${n} list${n === 1 ? "" : "s"}` : t.first ? `First list ${esc(t.first)}` : "Coming soon"}</span></span></a>`;
  };
  write("tropes/index.html", layout({ title: "Romance books by trope", description: "Find your next romance book by trope: enemies to lovers, grumpy sunshine, fake dating, small town, second chance and more.", path: "/tropes/", body: `<section class="wrap listing"><header class="listing__head"><h1>Romance books by trope</h1><p>Pick the trope you're in the mood for. Every list marks the Kindle Unlimited books.</p></header><div class="tropes__list tropes__list--big">${tropes.map(tile).join("")}</div></section>${newsletter}` }));
  for (const t of tropes) {
    const list = posts.filter((p) => p.tropes.includes(t.slug));
    const body = `<section class="wrap listing">
      <header class="listing__head"><p class="kicker">By trope</p><h1>${esc(t.name)} romance books</h1><p>${esc(t.blurb || "")}</p></header>
      ${list.length ? `<div class="grid">${list.map(card).join("")}</div>` : `<p class="empty-note">${t.first ? `The first ${esc(t.name.toLowerCase())} list goes up on ${esc(t.first)}.` : "This list is on its way."} Meanwhile, <a href="/archive/">browse every list</a>${site.banner ? ` or <a href="${esc(site.banner.url)}" rel="sponsored nofollow noopener" target="_blank" class="shop-link">start a Kindle Unlimited free trial</a>` : ""}.</p>`}
    </section>${newsletter}`;
    write(`tropes/${t.slug}/index.html`, layout({ title: `${t.name} romance books`, description: t.blurb || `${t.name} romance books, with Kindle Unlimited picks marked.`, path: `/tropes/${t.slug}/`, body }));
  }
}

function freebiesPage() {
  if (!site.freebie) return;
  const f = site.freebie;
  write("freebies/index.html", layout({ title: "Free printables for romance readers", description: f.blurb, path: "/freebies/", body: `<section class="wrap listing"><header class="listing__head"><h1>Free printables for romance readers</h1><p>Little extras to make your reading year more fun.</p></header></section>${newsletter}` }));
}

function archivePage(posts) {
  const byMonth = {};
  posts.forEach((p) => {
    const k = p.date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    (byMonth[k] = byMonth[k] || []).push(p);
  });
  const body = `<section class="wrap narrow archive"><h1>All lists</h1>
    ${Object.entries(byMonth).map(([m, list]) => `<h2>${m}</h2><ul>${list.map((p) => `<li><a href="${p.url}">${esc(p.title)}</a><span>${esc(p.section.name)}</span></li>`).join("")}</ul>`).join("") || "<p>No stories yet.</p>"}
  </section>`;
  write("archive/index.html", layout({ title: "All lists", path: "/archive/", body }));
}

function postPages(posts, drafts = []) {
  [...posts, ...drafts].forEach((post, i) => {
    const related = posts.filter((p) => p !== post && p.section.slug === post.section.slug).slice(0, 3);
    const more = related.length ? related : posts.filter((p) => p !== post).slice(0, 3);
    const pageUrl = SITE_URL + post.url;
    const coverAbs = post.cover ? (post.cover.startsWith("/") ? SITE_URL + post.cover : post.cover) : "";
    const pinText = post.pinDescription || post.description;
    const pinHref = `https://www.pinterest.com/pin/create/button/?url=${encodeURIComponent(pageUrl)}&description=${encodeURIComponent((post.pinTitle || post.title) + ". " + pinText)}${coverAbs ? "&media=" + encodeURIComponent(coverAbs) : ""}`;
    const disclosure = post.hasShopLinks && !post.hasDisclosure
      ? `<p class="disclosure">This post contains affiliate links. As an Amazon Associate I earn from qualifying purchases, at no extra cost to you. <a href="/disclosure/">Read the disclosure</a>.</p>` : "";

    const jsonld = `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org", "@type": "BlogPosting", headline: post.title, description: post.description,
      datePublished: post.date.toISOString(), dateModified: (post.updated && post.updated > post.date ? post.updated : post.date).toISOString(), author: { "@type": "Person", name: site.author, url: SITE_URL + "/about/" },
      publisher: { "@type": "Organization", name: site.name, url: SITE_URL + "/", logo: { "@type": "ImageObject", url: SITE_URL + "/favicon.svg" } },
      mainEntityOfPage: { "@type": "WebPage", "@id": pageUrl }, url: pageUrl, articleSection: post.section.name,
      ...(post.tags.length ? { keywords: post.tags.join(", ") } : {}), ...(coverAbs ? { image: [coverAbs] } : {}),
    })}</script>${post.faq.length ? `\n<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org", "@type": "FAQPage",
      mainEntity: post.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    })}</script>` : ""}`;

    const banner = post.draft ? `<div class="draft-banner wrap">Draft preview: only people with this link can see it. It is not on the home page, the section pages or Google yet.</div>` : "";
    const body = `${banner}<article class="post">
  <header class="post__head wrap">
    <a class="post__section post__section--${post.section.slug}" href="/${post.section.slug}/">${esc(post.section.name)}</a>
    <h1>${esc(post.title)}</h1>
    ${post.subtitle ? `<p class="post__dek">${esc(post.subtitle)}</p>` : ""}
    <p class="meta">By <a href="/about/">${esc(site.author)}</a>. <time datetime="${post.date.toISOString().slice(0, 10)}">${formatDate(post.date)}</time>${post.updated && post.updated > post.date ? `, updated <time datetime="${post.updated.toISOString().slice(0, 10)}">${formatDate(post.updated)}</time>` : ""}, ${post.readMinutes} min read</p>
  </header>
  <div class="post__cover wrap">${cover(post, "lg")}</div>
  <div class="prose">
    ${disclosure}
    ${post.html}
  </div>
  <footer class="post__foot prose">
    ${post.tags.length ? `<p class="tags">${post.tags.map((t) => `<span>${esc(t)}</span>`).join("")}</p>` : ""}
    <a class="button button--ghost" href="${pinHref}" target="_blank" rel="noopener">Save this story to Pinterest</a>
    <aside class="byline-box">
      <span class="byline-box__img">${fs.existsSync(path.join(ROOT, "static/images/author.jpg")) ? `<img src="/images/author.jpg" alt="" loading="lazy">` : `<span class="byline-box__mono">V</span>`}</span>
      <p class="byline-box__h">Hi, I'm Vallari</p>
      <p>${esc(site.authorBio || "")} <a href="/about/">More about me</a>.</p>
    </aside>
  </footer>
</article>
${more.length ? `<section class="wrap recent" aria-labelledby="more-h"><h2 id="more-h" class="rule-h">Keep reading</h2><div class="grid">${more.map(card).join("")}</div></section>` : ""}
${newsletter}`;
    write(`posts/${post.slug}/index.html`, layout({ title: post.title, description: post.description, path: post.url, body, image: post.cover, imageAlt: post.coverAlt, type: "article", jsonld, noindex: post.draft, published: post.date, tags: post.tags }));
  });
}

function shopPage() {
  if (!shop) return;
  const digital = shop.products.filter((p) => p.kind === "beacons");
  const merch = shop.products.filter((p) => p.kind !== "beacons");
  const col = (id, name, blurb, list) => !list.length ? "" : `<section class="ownshop-col" id="${id}" aria-labelledby="h-${id}">
    <div class="ownshop-col__head"><h2 id="h-${id}">${name}</h2><p>${blurb}</p></div>
    <div class="ownshop__rail">${list.map((p) => shopCard(p)).join("")}</div>
  </section>`;
  const body = `<section class="wrap shop-page">
  <header class="listing__head"><h1>The Bookish Girl shop</h1>
  <p>Cozy things for readers: digital trackers and printables, and bookish merch made to order. ${esc(shop.note || "")}</p></header>
  ${col("merch", "Bookish merch", "Made to order for readers and paid securely with PayPal.", merch)}
  ${col("digital", "Digital downloads", "Trackers and printables, delivered instantly.", digital)}
  <p class="shop-page__foot">Questions about an order? See <a href="/shipping-and-returns/">shipping and returns</a>.</p>
</section>${newsletter}`;
  write("shop/index.html", layout({ title: "Shop", description: "Bookish merch, reading trackers and printables from The Bookish Girl.", path: "/shop/", body }));

  // Checkout: one page for every PayPal product, chosen with ?p=<product id>.
  const data = shop.products.filter((p) => p.kind !== "beacons").map((p) => ({ id: p.id, title: p.title, blurb: p.blurb || "", price: p.price || "", shipping: p.shipping || "0", image: p.image || "", live: shopLive(p) }));
  write("shop-data.json", JSON.stringify({ currency: shop.currency || "USD", products: data }));
  const checkout = `<section class="wrap narrow checkout" aria-labelledby="co-h">
  <h1 id="co-h">Checkout</h1>
  <div id="co" class="checkout__box"><p>Loading your item...</p></div>
  <p class="checkout__fine">Payment is handled securely by PayPal; you can pay with your PayPal account or a card. Items are made to order. See <a href="/shipping-and-returns/">shipping and returns</a>.</p>
</section>
<script>
(function(){
  var box=document.getElementById("co");
  var id=new URLSearchParams(location.search).get("p");
  function money(n){return "$"+Number(n).toFixed(2)}
  Promise.all([fetch("/shop-data.json").then(function(r){return r.json()}),fetch("/api/paypal/config").then(function(r){return r.json()})]).then(function(res){
    var shop=res[0],cfg=res[1],p=shop.products.filter(function(x){return x.id===id})[0];
    if(!p||!p.live){box.innerHTML='<p>This item isn’t available yet. <a href="/shop/">Back to the shop</a></p>';return}
    if(!cfg.clientId){box.innerHTML='<p>Checkout opens soon. <a href="/shop/">Back to the shop</a></p>';return}
    box.innerHTML='<div class="checkout__item">'+(p.image?'<img src="'+p.image+'" alt="">':'')+'<div><h2>'+p.title+'</h2><p>'+p.blurb+'</p><p class="checkout__price">'+money(p.price)+(Number(p.shipping)>0?' + '+money(p.shipping)+' shipping':' with free US shipping')+'</p><label>Quantity <select id="qty"><option>1</option><option>2</option><option>3</option><option>4</option></select></label></div></div><div id="pp"></div><p id="co-msg" class="checkout__msg" role="status"></p>';
    var s=document.createElement("script");
    s.src="https://www.paypal.com/sdk/js?client-id="+encodeURIComponent(cfg.clientId)+"&currency="+(shop.currency||"USD")+"&intent=capture";
    s.onload=function(){
      paypal.Buttons({
        style:{color:"gold",shape:"pill",label:"pay"},
        createOrder:function(){return fetch("/api/paypal/order",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:p.id,qty:Number(document.getElementById("qty").value)})}).then(function(r){return r.json()}).then(function(j){if(!j.id)throw new Error(j.error||"order");return j.id})},
        onApprove:function(d){return fetch("/api/paypal/capture",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orderID:d.orderID})}).then(function(r){return r.json()}).then(function(j){if(j.status==="COMPLETED"){location.href="/order-complete/?o="+encodeURIComponent(d.orderID)}else{document.getElementById("co-msg").textContent="Something went wrong with the payment. You have not been charged twice; please try again or contact me."}})},
        onError:function(){document.getElementById("co-msg").textContent="PayPal couldn’t complete the payment. Please try again."}
      }).render("#pp");
    };
    document.head.appendChild(s);
  })["catch"](function(){box.innerHTML='<p>Checkout couldn’t load. Please refresh the page.</p>'});
})();
</script>`;
  write("checkout/index.html", layout({ title: "Checkout", path: "/checkout/", noindex: true, body: checkout }));
  write("order-complete/index.html", layout({ title: "Thank you for your order", path: "/order-complete/", noindex: true, body: `<section class="wrap narrow empty"><h1>Thank you for your order</h1><p>Your payment went through, and PayPal has emailed you a receipt. Your order is made to order, and you'll get an email with tracking once it ships.</p><p><a class="btn btn--peach" href="/">Find your next read</a></p></section>` }));
}

function staticPages(pages) {
  pages.forEach((pg) => {
    const body = `<article class="post"><header class="post__head wrap"><h1>${esc(pg.title)}</h1></header><div class="prose">${pg.html}</div></article>`;
    write(`${pg.slug}/index.html`, layout({ title: pg.title, description: pg.description, path: `/${pg.slug}/`, body }));
  });
  const F = site.freebie || {};
  write("thanks/index.html", layout({ title: "You're on the list", path: "/thanks/", noindex: true, body: `<section class="wrap narrow empty"><h1>You're on the list</h1>${F.file ? `<p>Here's your printable. Download it, print it, and start crossing off tropes.</p><p><a class="btn btn--peach" href="${esc(F.file)}" download>Download ${esc(F.short || "the printable")}</a></p>` : ""}<p>New romance lists will land in your inbox every week. Until then, <a href="/">find your next read</a>.</p></section>` }));
  write("404.html", layout({ title: "Page not found", path: "/404/", body: `<section class="wrap narrow empty"><h1>This page has moved or never existed</h1><p>Try the <a href="/archive/">full list of stories</a> or head back to the <a href="/">front page</a>.</p></section>` }));
}

function feeds(posts, pages) {
  const items = posts.slice(0, 30).map((p) => `<item><title>${esc(p.title)}</title><link>${SITE_URL}${p.url}</link><guid>${SITE_URL}${p.url}</guid><pubDate>${p.date.toUTCString()}</pubDate><category>${esc(p.section.name)}</category><description>${esc(p.description)}</description></item>`).join("");
  write("rss.xml", `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(site.name)}</title><link>${SITE_URL}/</link><description>${esc(site.description)}</description><language>en-us</language>${items}</channel></rss>`);
  const day = (d) => d.toISOString().slice(0, 10);
  const latest = posts.length ? day(posts[0].date) : "";
  const urls = [
    ...["/", "/archive/", ...site.sections.map((s) => `/${s.slug}/`)].map((u) => ({ u, lastmod: latest })),
    ...pages.map((p) => ({ u: `/${p.slug}/` })),
    ...(shopOpen ? [{ u: "/shop/", lastmod: latest }] : []),
    ...posts.map((p) => ({ u: p.url, lastmod: day(p.date), img: p.cover && fs.existsSync(path.join(ROOT, "static", p.cover)) ? SITE_URL + p.cover : "" })),
  ];
  write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${urls.map(({ u, lastmod, img }) => `<url><loc>${SITE_URL}${u}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}${img ? `<image:image><image:loc>${esc(img)}</image:loc></image:image>` : ""}</url>`).join("")}</urlset>`);
  write("robots.txt", `User-agent: *\nAllow: /\nDisallow: /admin/\nSitemap: ${SITE_URL}/sitemap.xml\n`);
}

// ---------- one-file preview (for reviewing the design inside Claude) ----------
function buildPreview() {
  const css = fs.readFileSync(path.join(ROOT, "static/style.css"), "utf8");
  const imgCache = {};
  const dataUri = (src) => {
    if (imgCache[src] !== undefined) return imgCache[src];
    const f = path.join(ROOT, "static", src);
    imgCache[src] = fs.existsSync(f) ? `data:image/${src.endsWith(".png") ? "png" : "jpeg"};base64,${fs.readFileSync(f).toString("base64")}` : "";
    return imgCache[src];
  };
  const fix = (html) => html
    .replace(/src="\/(images\/[^"]+)"/g, (m, src) => `src="${src}"`)
    .replace(/href="\/([^"]*)"/g, (m, rest) => /\.(xml|svg)$/.test(rest) ? `href="#/"` : `href="#/${rest}"`)
    .replace(/<form name="newsletter"[^>]*>/g, '<form class="letter__form" data-preview-form>');
  const sample = layout({ path: "/__shell__/", body: "@@BODY@@" });
  delete PREVIEW["/__shell__/"];
  const header = sample.slice(sample.indexOf('<header class="masthead">'), sample.indexOf('<main id="main">'));
  const footer = sample.slice(sample.indexOf('<footer class="foot">'), sample.indexOf("</body>"));
  const sections = Object.entries(PREVIEW).filter(([r]) => r !== "/404/")
    .map(([route, pg]) => `<section class="pv-page" data-route="${route}" data-title="${esc(pg.title)}" hidden>${fix(pg.body)}</section>`).join("\n");
  const html = `<title>${esc(site.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,wght@0,400..900;1,400..900&family=DM+Sans:ital,wght@0,400..700;1,400..700&display=swap" rel="stylesheet">
<style>${css}
.pv-banner{font:500 .85rem/1.4 var(--sans);background:var(--ink);color:#fff;text-align:center;padding:.55rem 1rem}
</style>
<div class="pv-banner">Design preview with placeholder images until the photos are made. Every link works.</div>
${fix(header)}
<main id="main">${sections}</main>
${fix(footer)}
<script>
(function(){
  var pages=[].slice.call(document.querySelectorAll('.pv-page'));
  function show(){
    var r=(location.hash||'#/').slice(1)||'/'; if(r.charAt(r.length-1)!=='/') r+='/';
    var hit=pages.filter(function(p){return p.dataset.route===r})[0]||pages.filter(function(p){return p.dataset.route==='/'})[0];
    pages.forEach(function(p){p.hidden=p!==hit});
    document.querySelectorAll('.nav a').forEach(function(a){
      var t=a.getAttribute('href').slice(1); if(r.indexOf(t)===0&&t!=='/') a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current');});
    window.scrollTo(0,0);
  }
  window.addEventListener('hashchange',show); show();
  document.addEventListener('submit',function(e){
    if(!e.target.matches('[data-preview-form]'))return; e.preventDefault();
    e.target.innerHTML='<p class="letter__done">You\\'re on the list. On the live site this saves the email in Netlify.</p>';});
})();
</script>`;
  fs.mkdirSync(path.join(ROOT, "preview"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "preview/index.html"), html);
}

// ---------- run ----------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(path.join(ROOT, "static"), OUT, { recursive: true });

// Drafts (draft: true) get a private preview page but stay off every list, the sitemap and RSS.
const allPosts = loadPosts();
const drafts = allPosts.filter((p) => p.draft);
const posts = allPosts.filter((p) => !p.draft && p.date <= new Date(Date.now() + 864e5));
const pages = loadPages();
homePage(posts);
sectionPages(posts);
tropePages(posts);
freebiesPage();
archivePage(posts);
postPages(posts, drafts);
staticPages(pages);
shopPage();
feeds(posts, pages);

buildPreview();
console.log(`Built ${posts.length} post(s), ${drafts.length} draft preview(s) and ${pages.length} page(s) into dist/`);
