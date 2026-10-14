# The polite scraper

FlyRank Week 5 / A9, JavaScript lane (Node.js 22+). A separate repository for the seven core stages. The AI rematch is intentionally omitted.

## Target classification

- Target: https://books.toscrape.com/, the fictional bookstore linked from [ToScrape's sandbox page](https://toscrape.com/).
- Why: ToScrape explicitly describes this as a safe practice site for learning and validating scraping tools. Its catalogue data is in server-rendered HTML.
- Scope: the first three catalogue pages, following their next links, and the 60 book detail pages they reference. No category crawling, images, or other sites.
- Data: title, canonical product URL, displayed GBP price, availability, rating, optional description, source catalogue URL, original fetch timestamp; later a numeric GBP price.
- Robots check: one request to https://books.toscrape.com/robots.txt on 14 October 2026 at 16:05 IST returned HTTP 404: **no robots file found**. Missing robots.txt is not permission; the explicit sandbox purpose is the basis for this bounded exercise. See [the check record](docs/robots-check.json) and [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html).

I will not reuse this code on another site without checking its rules and terms first.

## Run locally

Install [Node.js 22+](https://nodejs.org/) and Git. No API key, account, browser, database, or paid service is needed to run the scraper.

```bash
git clone https://github.com/rishit-kadha/Flyrank_w5_a9.git
cd Flyrank_w5_a9
npm ci
npm start
```

After cloning, the single command `npm ci && npm start` installs the locked dependencies and produces the output. On Windows PowerShell 5, run the two npm commands on separate lines. A fresh run downloads 63 HTML pages sequentially and normally completes in a few minutes; cached runs take seconds. Network conditions can make the first run longer.

| Command | Purpose |
| --- | --- |
| `npm start` | Process exactly the first three catalogue pages and their book details |
| `npm start -- --show-raw` | Also print one complete raw record with all eight fields |
| `npm run demo:failure` | Add a locally simulated missing URL; retain 60 good records and report one failed page |
| `npm test` | Run offline parser, validation, fetcher, and failure-isolation tests |

The scraper writes:

- `output/books.json`: only validated records, deduplicated by canonical product URL.
- `output/raw-books.json`: extracted records with their eight raw fields.
- `output/errors.json`: failed pages or invalid records, with reasons and raw data when available.
- `output/run-report.json`: counts, duration, completion status, and whether failure simulation was enabled.

Files are replaced on each run, rather than appended. Individual output files are written via temporary files and renamed. `cache/` and generated `output/` are ignored by Git. The committed [samples](samples/) contain an actual 60-book output, a clean cached-run report, and the local failure-demo evidence.

## Record schema

The JavaScript lane uses built-in `fetch`, [Cheerio](https://cheerio.js.org/) for HTML, and [Zod](https://zod.dev/) for validation. The executable schema is in [`src/schema.js`](src/schema.js).

| Field | Type and rule |
| --- | --- |
| `title` | Nonempty string from the product heading |
| `product_url` | Canonical HTTPS URL on Books to Scrape under `/catalogue/`; record identity |
| `price_text` | Original displayed GBP text, such as `£51.77` |
| `availability_text` | Nonempty displayed availability text |
| `rating_text` | `One`, `Two`, `Three`, `Four`, or `Five` |
| `description` | Text or `null`; the schema also permits omission, while the extractor always emits the key |
| `source_page` | Absolute URL of the first catalogue page that supplied this book link |
| `fetched_at` | ISO 8601 UTC timestamp of the original successful detail-page fetch |
| `price_gbp` | Finite, nonnegative number matching `price_text`, such as `51.77` |

Selectors are scoped to `article.product_page` and `.product_main`. Whitespace is collapsed; absent descriptions remain null. Strict price parsing rejects partial numbers and the wrong currency. The raw price remains alongside the numeric value. Cache metadata stores the fetch timestamp, so rerunning does not make old content appear newly collected.

## Politeness and failure behavior

- Identifying User-Agent: `FlyRankInternship-A9/1.0 (+https://github.com/rishit-kadha/Flyrank_w5_a9)`.
- One request at a time, with at least **550 ms** after a real request before starting the next. Cache hits do not wait or contact the site.
- **15-second timeout**, including response-body consumption.
- Only **HTTP 200** is accepted or cached. Redirects are not automatically followed; the fetcher rejects URLs outside the approved HTTPS catalogue origin.
- A timeout or **5xx** gets **one retry**, after a one-second pause plus the normal delay. **403, 404, and other nonretryable responses are not retried**.
- Fetch/cache metadata are shared by catalogue and detail requests. The first page is saved at `cache/catalogue-page-1.html`; detail filenames use a URL hash.
- A failed detail page is recorded and the remaining books continue. A failed catalogue page stops further discovery because its next link is unavailable, but already discovered books are processed and a partial report is written.
- Validation failures go to `errors.json`, never `books.json`. Successful records are retained even when other records fail.

A normal incomplete run exits with status 1. The intentional failure demo exits 0 when it retains all 60 books and reports precisely the one simulated failure; its report still honestly says `partial`. Bad CLI flags exit 2. Disk/permission failures are reported to stderr; a report cannot be guaranteed if the output directory itself cannot be written.

The fake URL is intercepted **before** the fetcher and is never requested from the real site. The 403/404/timeout/5xx tests use injected local responses.

## Evidence from a real run

The first development pass fetched the three catalogue pages and 60 book pages. This subsequent complete run used all 63 cached pages. `pages_fetched` counts successful real HTTP 200 page downloads; `request_attempts` includes retries; `failed_pages` counts pages that ultimately failed, not failed attempts. Counts exclude the one-time Stage 0 robots check. Times below are UTC; the run occurred on 14 October 2026 in Asia/Calcutta.
```json
{
  "started_at": "2026-10-14T10:42:23.424Z",
  "duration_ms": 213,
  "pages_fetched": 0,
  "cache_hits": 63,
  "request_attempts": 0,
  "retries": 0,
  "catalogue_pages": 3,
  "discovered": 60,
  "unique_urls": 60,
  "detail_pages": 60,
  "valid_records": 60,
  "invalid_records": 0,
  "failed_pages": 0,
  "run_errors": 0,
  "simulated_failure": false,
  "status": "complete"
}
```

[Failure demonstration](samples/failure-run-report.json): `valid_records: 60`, `failed_pages: 1`, `request_attempts: 0`. The failure was local and the good records survived. Two complete cached runs also produced the same SHA-256 for `books.json`, confirming stable records and provenance rather than duplicate appends.

No browser was needed: book links, prices, ratings, availability, and descriptions are already present in the HTML sent by the server, so rendering JavaScript would add unnecessary cost.

## Limits and ethics

This deliberately small pipeline is tied to the current Books to Scrape HTML structure and GBP prices. A markup or catalogue change may produce rejected records or a partial report. The cache has no automatic freshness policy: it is an immutable development snapshot until you deliberately remove it after rechecking the site's current rules. The robots result above is a dated manual check, not a promise about future rules. Do not run multiple copies against the site simultaneously; pacing applies within one process.

Use an official API when one exists. Never bypass logins, paywalls, CAPTCHAs, or access blocks. Collect only the fields needed for the task, respect the site's terms, and stop when access is denied. This repository is limited to an explicitly designated practice sandbox.

## Repository map

```text
src/config.js       Fixed target, identity, timeout, and request delay
src/fetcher.js      Status checks, original-timestamp cache, pacing, one retry
src/parse.js        Catalogue/detail extraction and canonical deduplication
src/discover.js     Follow exactly three catalogue pages
src/normalize.js    Strict GBP conversion without dropping raw data
src/schema.js       Zod record contract
src/pipeline.js     Per-page isolation, validation, storage, run report
src/index.js        CLI and exit codes
test/              Synthetic HTML fixtures and offline tests
samples/           Real sample data and run/failure evidence
docs/              Dated robots check
```

The Git history follows Stages 0-6 in order, with a separate meaningful commit for each. The AI rematch, AI-generated comparison version, and AI enrichment are intentionally excluded.
