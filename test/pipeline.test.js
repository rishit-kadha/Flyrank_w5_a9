import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { run, SIMULATED_URL } from '../src/pipeline.js';
import { ROOT, START_URL } from '../src/config.js';
import { HttpError } from '../src/fetcher.js';

const fetchedAt = '2026-10-14T08:00:00.000Z';
const fixture = name => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const bookUrl = index => `https://books.toscrape.com/catalogue/synthetic-book-${index}/index.html`;
const pageUrl = page => `https://books.toscrape.com/catalogue/page-${page}.html`;

async function temporaryOutput(t) {
  // Keep scratch output on the workspace filesystem so atomic renames also work
  // inside restricted Windows environments. cache/ is excluded from Git.
  const scratchRoot = resolve(ROOT, 'cache');
  await mkdir(scratchRoot, { recursive: true });
  const directory = await mkdtemp(join(scratchRoot, 'polite-pipeline-'));
  t.after(async () => {
    const target = resolve(directory);
    assert.equal(dirname(target), scratchRoot);
    assert.ok(basename(target).startsWith('polite-pipeline-'));
    await rm(target, { recursive: true, force: true });
  });
  return directory;
}

async function syntheticFetcher({ failedUrl, invalidUrl } = {}) {
  const good = await fixture('book-with-description.html');
  const bad = await fixture('book-malformed.html');
  const requested = [];
  const stats = { pages_fetched: 0, cache_hits: 0, request_attempts: 0, retries: 0 };
  return {
    requested,
    stats,
    async get(url) {
      assert.notEqual(url, SIMULATED_URL, 'The simulated bad URL must never reach even the injected fetcher');
      requested.push(url);
      stats.request_attempts++;
      if (url === failedUrl) throw new HttpError(404, url);
      const page = /^https:\/\/books\.toscrape\.com\/catalogue\/page-(\d+)\.html$/.exec(url);
      let html;
      if (page) {
        const number = Number(page[1]);
        assert.ok(number <= 3, 'Never fetch the fourth catalogue page');
        html = Array.from({ length: 20 }, (_, offset) => {
          const index = (number - 1) * 20 + offset;
          return `<article class="product_pod"><h3><a href="synthetic-book-${index}/index.html">Book ${index}</a></h3></article>`;
        }).join('') + `<li class="next"><a href="page-${number + 1}.html">next</a></li>`;
      } else {
        assert.match(url, /^https:\/\/books\.toscrape\.com\/catalogue\/synthetic-book-\d+\/index\.html$/);
        html = url === invalidUrl ? bad : good;
      }
      stats.pages_fetched++;
      return { html, url, fetched_at: fetchedAt };
    },
  };
}

const readJson = (directory, name) => readFile(join(directory, name), 'utf8').then(JSON.parse);

test('a clean run and rerun retain exactly 60 unique validated records and write an honest report', async t => {
  const outputDir = await temporaryOutput(t);
  let now = Date.parse(fetchedAt);
  const first = await run({ fetcher: await syntheticFetcher(), outputDir, log: () => {}, now: () => now++ });
  assert.equal(first.report.status, 'complete');
  assert.equal(first.report.catalogue_pages, 3);
  assert.equal(first.report.discovered, 60);
  assert.equal(first.report.unique_urls, 60);
  assert.equal(first.report.detail_pages, 60);
  assert.equal(first.report.pages_fetched, 63);
  assert.equal(first.report.failed_pages, 0);
  assert.equal(first.report.invalid_records, 0);
  assert.equal(first.report.valid_records, 60);
  assert.equal(first.report.started_at, fetchedAt);
  assert.ok(first.report.duration_ms >= 0);
  assert.deepEqual(await readJson(outputDir, 'run-report.json'), first.report);
  assert.deepEqual(await readJson(outputDir, 'errors.json'), []);
  const second = await run({ fetcher: await syntheticFetcher(), outputDir, log: () => {}, now: () => now++ });
  const stored = await readJson(outputDir, 'books.json');
  assert.deepEqual(second.books, first.books);
  assert.equal(stored.length, 60);
  assert.equal(new Set(stored.map(book => book.product_url)).size, 60);
  assert.equal(stored[20].source_page, pageUrl(2));
  assert.equal(stored[40].source_page, pageUrl(3));
  assert.ok(stored.every(book => book.fetched_at === fetchedAt));
  assert.ok(stored.every(book => typeof book.price_gbp === 'number'));
});

test('the local fake URL adds one reported failure without contacting the fetcher or losing any good book', async t => {
  const outputDir = await temporaryOutput(t);
  const fetcher = await syntheticFetcher();
  const result = await run({ fetcher, outputDir, simulateFailure: true, log: () => {} });
  assert.equal(result.books.length, 60);
  assert.equal(result.report.failed_pages, 1);
  assert.equal(result.report.invalid_records, 0);
  assert.equal(result.report.simulated_failure, true);
  assert.equal(result.report.status, 'partial');
  assert.equal(fetcher.requested.length, 63);
  assert.ok(!fetcher.requested.includes(SIMULATED_URL));
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].url, SIMULATED_URL);
  assert.equal(result.errors[0].simulated, true);
  assert.equal(result.errors[0].type, 'fetch');
  assert.equal((await readJson(outputDir, 'books.json')).length, 60);
  assert.deepEqual(await readJson(outputDir, 'run-report.json'), result.report);
});

test('a real detail-page failure leaves 59 good records and identifies the failed page', async t => {
  const outputDir = await temporaryOutput(t);
  const failedUrl = bookUrl(7);
  const result = await run({ fetcher: await syntheticFetcher({ failedUrl }), outputDir, log: () => {} });
  assert.equal(result.report.valid_records, 59);
  assert.equal(result.report.failed_pages, 1);
  assert.equal(result.report.invalid_records, 0);
  assert.equal(result.report.detail_pages, 59);
  assert.equal(result.report.pages_fetched, 62);
  assert.equal(result.report.status, 'partial');
  assert.ok(!result.books.some(book => book.product_url === failedUrl));
  assert.equal(result.errors[0].url, failedUrl);
  assert.equal(result.errors[0].phase, 'detail');
  assert.equal(result.errors[0].simulated, false);
  assert.match(result.errors[0].reason, /404/);
  assert.equal((await readJson(outputDir, 'books.json')).length, 59);
});

test('an invalid detail record is quarantined with its raw values and reason instead of stored as valid', async t => {
  const outputDir = await temporaryOutput(t);
  const invalidUrl = bookUrl(13);
  const result = await run({ fetcher: await syntheticFetcher({ invalidUrl }), outputDir, log: () => {} });
  assert.equal(result.report.valid_records, 59);
  assert.equal(result.report.invalid_records, 1);
  assert.equal(result.report.failed_pages, 0);
  assert.equal(result.report.detail_pages, 60);
  assert.equal(result.report.status, 'partial');
  assert.ok(!result.books.some(book => book.product_url === invalidUrl));
  const [invalid] = await readJson(outputDir, 'errors.json');
  assert.equal(invalid.type, 'validation');
  assert.equal(invalid.url, invalidUrl);
  assert.equal(invalid.record.title, '');
  assert.ok(invalid.reason.length > 0);
  assert.equal((await readJson(outputDir, 'books.json')).length, 59);
});

test('a catalogue failure preserves already discovered books and writes a partial report', async t => {
  const outputDir = await temporaryOutput(t);
  const fetcher = await syntheticFetcher({ failedUrl: pageUrl(2) });
  const result = await run({ fetcher, outputDir, log: () => {} });
  assert.equal(result.report.catalogue_pages, 1);
  assert.equal(result.report.discovered, 20);
  assert.equal(result.report.valid_records, 20);
  assert.equal(result.report.failed_pages, 1);
  assert.equal(result.report.status, 'partial');
  assert.equal(result.errors[0].phase, 'catalogue');
  assert.equal(result.errors[0].url, pageUrl(2));
  assert.ok(!fetcher.requested.includes(pageUrl(3)));
  assert.deepEqual(await readJson(outputDir, 'run-report.json'), result.report);
  assert.equal((await readJson(outputDir, 'books.json')).length, 20);
});

test('failure of the first catalogue still writes an empty output and a failure report', async t => {
  const outputDir = await temporaryOutput(t);
  const result = await run({ fetcher: await syntheticFetcher({ failedUrl: START_URL }), outputDir, log: () => {} });
  assert.equal(result.report.valid_records, 0);
  assert.equal(result.report.catalogue_pages, 0);
  assert.equal(result.report.failed_pages, 1);
  assert.equal(result.report.status, 'partial');
  assert.deepEqual(await readJson(outputDir, 'books.json'), []);
  assert.deepEqual(await readJson(outputDir, 'run-report.json'), result.report);
});
