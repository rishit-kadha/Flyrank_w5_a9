import { createFetcher } from './fetcher.js';
import { discover } from './discover.js';
import { parseBook } from './parse.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './config.js';

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
