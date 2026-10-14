import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createFetcher, HttpError } from './fetcher.js';
import { ROOT, START_URL } from './config.js';
import { discover } from './discover.js';
import { parseBook } from './parse.js';
import { normalizeRecord } from './normalize.js';
import { BookSchema } from './schema.js';

export const SIMULATED_URL = 'https://books.toscrape.com/catalogue/__local_simulated_missing_book__/index.html';
async function writeJson(directory, name, value) {
  const target = join(directory, name);
  await writeFile(target + '.tmp', JSON.stringify(value, null, 2) + '\n');
  await rename(target + '.tmp', target);
}

export async function run({
  fetcher = createFetcher(), outputDir = join(ROOT, 'output'),
  simulateFailure = false, log = console.log, now = Date.now,
} = {}) {
  const started = now();
  const errors = [];
  const rawRecords = [];
  const valid = new Map();
  let catalogue = { books: [], catalogue_pages: 0, discovered: 0 };
  let detailPages = 0;
  const failed = failure => {
    errors.push({ type: 'fetch', ...failure });
    log('FAILED ' + failure.url + ' ' + failure.reason);
  };
  try {
    catalogue = await discover(fetcher, failed);
    log('catalogue_pages=' + catalogue.catalogue_pages + ' discovered=' + catalogue.discovered + ' unique_urls=' + catalogue.books.length);
    const books = [...catalogue.books];
    if (simulateFailure) books.push({ product_url: SIMULATED_URL, source_page: START_URL });
    for (const book of books) {
      let page;
      try {
        // Fail locally before the fetcher; this URL is NEVER sent to the site.
        if (simulateFailure && book.product_url === SIMULATED_URL) throw new HttpError(404, 'local simulation');
        page = await fetcher.get(book.product_url);
        detailPages++;
      } catch (error) {
        failed({ url: book.product_url, phase: 'detail', reason: error.message, simulated: book.product_url === SIMULATED_URL });
        continue;
      }
      let raw;
      try {
        raw = parseBook(page.html, { ...book, fetched_at: page.fetched_at });
        rawRecords.push(raw);
        const record = BookSchema.parse(normalizeRecord(raw));
        valid.set(record.product_url, record);
      } catch (error) {
        errors.push({
          type: 'validation', url: book.product_url, reason: error.message,
          ...(raw ? { record: raw } : {}),
        });
        log('INVALID ' + book.product_url);
      }
    }
  } catch (error) {
    errors.push({ type: 'run', reason: error.message });
  }
  await mkdir(outputDir, { recursive: true });
  const records = [...valid.values()];
  await writeJson(outputDir, 'books.json', records);
  await writeJson(outputDir, 'raw-books.json', rawRecords);
  await writeJson(outputDir, 'errors.json', errors);
  const report = {
    started_at: new Date(started).toISOString(),
    duration_ms: now() - started,
    ...fetcher.stats,
    catalogue_pages: catalogue.catalogue_pages,
    discovered: catalogue.discovered,
    unique_urls: catalogue.books.length,
    detail_pages: detailPages,
    valid_records: records.length,
    invalid_records: errors.filter(error => error.type === 'validation').length,
    failed_pages: errors.filter(error => error.type === 'fetch').length,
    run_errors: errors.filter(error => error.type === 'run').length,
    simulated_failure: simulateFailure,
    status: errors.length === 0 && records.length === 60 && catalogue.catalogue_pages === 3 ? 'complete' : 'partial',
  };
  await writeJson(outputDir, 'run-report.json', report);
  return { report, books: records, errors, rawRecords };
}
