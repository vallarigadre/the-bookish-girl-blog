# The Bookish Girl blog

Romance book lists, Kindle Unlimited finds and gifts for romance readers, at https://blog.thebookishgirl.in. A fast static site: every post is a markdown file in `posts/`, built with `npm run build` into `dist/` and hosted on Cloudflare Pages.

## How a post goes out (every Sunday and Wednesday, automatic)

1. The blog task writes the post, commits it to `posts/` with the message `Publish: <title>` and pushes. Cloudflare Pages rebuilds and the post is live in 1 to 2 minutes with tagged Amazon links.
2. Its products land on the Link Swap page. Paste your SiteStripe links there and press Update links. The links task swaps them in the post and pushes `Links: <slug>`.
3. Photos: run the photo request from the blog message in a Claude desktop task. The photos go into `static/images` with the exact file names, and show up on the next build.

## Post format

Front matter: title, subtitle, date, category (Book Lists, Romantasy, Kindle & Reading or Gift Guides), description (under 155 characters), verdict, tags, trending (optional), quickpicks: false, pin_title, pin_description, cover, cover_alt.

Body: the italic affiliate disclosure first, a Kindle Unlimited free-trial link near the top and the bottom, `##` sections, two photo spots `![alt](/images/slug-2.jpg)` and `-3.jpg`. No prices, no em dashes, only real books.

## Settings

`site.config.json` holds the name, tagline, URL, Amazon tag and sections. `pages/` holds About, Affiliate disclosure and Privacy. `static/style.css` holds the design. The homepage photo is `static/images/hero.jpg` (portrait, about 900 x 1350).
