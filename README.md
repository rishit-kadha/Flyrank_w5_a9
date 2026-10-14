# The polite scraper

FlyRank Week 5 / A9, JavaScript lane (Node.js 22+). A separate repository for the seven core stages. The AI rematch is intentionally omitted.

## Target classification

- Target: https://books.toscrape.com/, the fictional bookstore linked from [ToScrape's sandbox page](https://toscrape.com/).
- Why: ToScrape explicitly describes this as a safe practice site for learning and validating scraping tools. Its catalogue data is in server-rendered HTML.
- Scope: the first three catalogue pages, following their next links, and the 60 book detail pages they reference. No category crawling, images, or other sites.
- Data: title, canonical product URL, displayed GBP price, availability, rating, optional description, source catalogue URL, original fetch timestamp; later a numeric GBP price.
- Robots check: one request to https://books.toscrape.com/robots.txt on 14 October 2026 at 16:05 IST returned HTTP 404: **no robots file found**. Missing robots.txt is not permission; the explicit sandbox purpose is the basis for this bounded exercise. See [the check record](docs/robots-check.json) and [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html).

I will not reuse this code on another site without checking its rules and terms first.
