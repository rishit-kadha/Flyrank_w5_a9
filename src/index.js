import { createFetcher } from './fetcher.js';
import { discover } from './discover.js';
import { parseBook } from './parse.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './config.js';
import { normalizeRecord } from './normalize.js';
import { BookSchema } from './schema.js';

const fetcher = createFetcher();
const result = await discover(fetcher);
console.log('catalogue_pages=' + result.catalogue_pages + ' discovered=' + result.discovered + ' unique_urls=' + result.books.length);
const records = [];
for (const book of result.books) {
  const page = await fetcher.get(book.product_url);
  records.push(parseBook(page.html, { ...book, fetched_at: page.fetched_at }));
}
await mkdir(join(ROOT, 'output'), { recursive: true });
await writeFile(join(ROOT, 'output/raw-books.json'), JSON.stringify(records, null, 2) + '\n');
console.log(JSON.stringify(records[0], null, 2));
console.log('detail_pages=' + records.length);
const valid = new Map();
const errors = [];
for (const raw of records) {
  try {
    const record = BookSchema.parse(normalizeRecord(raw));
    valid.set(record.product_url, record);
  } catch (error) {
    errors.push({ product_url: raw.product_url, reason: error.message, record: raw });
  }
}
await writeFile(join(ROOT, 'output/books.json'), JSON.stringify([...valid.values()], null, 2) + '\n');
await writeFile(join(ROOT, 'output/errors.json'), JSON.stringify(errors, null, 2) + '\n');
console.log('valid_records=' + valid.size + ' invalid_records=' + errors.length);
