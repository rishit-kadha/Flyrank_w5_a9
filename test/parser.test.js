import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseBook, parseCatalogue, uniqueBooks } from '../src/parse.js';
import { normalizePrice, normalizeRecord } from '../src/normalize.js';
import { BookSchema } from '../src/schema.js';

const metadata = {
  product_url: 'https://books.toscrape.com/catalogue/example-book_1/index.html',
  source_page: 'https://books.toscrape.com/catalogue/page-1.html',
  fetched_at: '2026-10-14T08:00:00.000Z',
};

const fixture = name => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('GBP normalization accepts complete prices and rejects misleading numeric text', () => {
  for (const [input, expected] of [['£51.77', 51.77], ['£0.00', 0], ['  £12.34\n', 12.34], ['£1234.56', 1234.56]]) {
    assert.equal(normalizePrice(input), expected);
  }
  for (const input of ['', '12.34', '$12.34', '£-1.00', '£12.3', '£12.345', '£1,234.56', '£NaN', '£Infinity', '£12.34 extra', 'save £12.34']) {
    assert.throws(() => normalizePrice(input), undefined, `Reject ${JSON.stringify(input)}`);
  }
});

test('catalogue parsing resolves relative book and next-page links against the source URL', async () => {
  const parsed = parseCatalogue(await fixture('catalogue.html'), metadata.source_page);
  assert.deepEqual(parsed.books, [
    { product_url: metadata.product_url, source_page: metadata.source_page },
    { product_url: 'https://books.toscrape.com/catalogue/another-book_2/index.html', source_page: metadata.source_page },
  ]);
  assert.equal(parsed.next, 'https://books.toscrape.com/catalogue/page-2.html');
});

test('book parsing selects the product area, cleans whitespace, and retains all provenance', async () => {
  const record = parseBook(await fixture('book-with-description.html'), metadata);
  assert.deepEqual(record, {
    title: 'Example book',
    product_url: metadata.product_url,
    price_text: '£12.34',
    availability_text: 'In stock (7 available)',
    rating_text: 'Three',
    description: 'A useful description with whitespace.',
    source_page: metadata.source_page,
    fetched_at: metadata.fetched_at,
  });
  const normalized = normalizeRecord(record);
  assert.equal(normalized.price_gbp, 12.34);
  assert.equal(normalized.price_text, record.price_text);
  assert.equal(normalized.fetched_at, metadata.fetched_at);
  assert.equal(BookSchema.safeParse(normalized).success, true);
});

test('a missing description remains null and unrelated prose is never substituted', async () => {
  const record = parseBook(await fixture('book-without-description.html'), metadata);
  assert.equal(record.description, null);
  assert.equal(Object.keys(record).length, 8);
  assert.equal(BookSchema.safeParse(normalizeRecord(record)).success, true);
});

test('duplicate book links across catalogue pages result in one canonical identity', () => {
  const other = 'https://books.toscrape.com/catalogue/another-book_2/index.html';
  const books = uniqueBooks([
    { product_url: metadata.product_url, source_page: metadata.source_page },
    { product_url: metadata.product_url, source_page: 'https://books.toscrape.com/catalogue/page-2.html' },
    { product_url: other, source_page: metadata.source_page },
  ]);
  assert.equal(books.length, 2);
  assert.deepEqual(new Set(books.map(book => book.product_url)), new Set([metadata.product_url, other]));
  assert.equal(books.find(book => book.product_url === metadata.product_url).source_page, metadata.source_page);
});

test('a malformed book fixture cannot pass the storage schema', async () => {
  const record = normalizeRecord(parseBook(await fixture('book-malformed.html'), metadata));
  const result = BookSchema.safeParse(record);
  assert.equal(result.success, false);
  assert.ok(result.error.issues.some(issue => issue.path.includes('title')));
});

test('storage schema rejects unsafe URLs, invalid timestamps, unknown ratings, and invalid prices', async () => {
  const valid = normalizeRecord(parseBook(await fixture('book-with-description.html'), metadata));
  for (const change of [
    { product_url: 'http://books.toscrape.com/catalogue/example-book_1/index.html' },
    { product_url: 'https://example.com/catalogue/example-book_1/index.html' },
    { source_page: 'https://books.toscrape.com/not-a-catalogue.html' },
    { fetched_at: 'yesterday' },
    { rating_text: 'Six' },
    { price_gbp: -1 },
    { price_gbp: Number.POSITIVE_INFINITY },
  ]) {
    assert.equal(BookSchema.safeParse({ ...valid, ...change }).success, false, `Reject ${JSON.stringify(change)}`);
  }
});
