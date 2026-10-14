import { load } from 'cheerio';
import { canonicalUrl } from './config.js';

export function parseCatalogue(html, pageUrl) {
  const $ = load(html);
  const books = $('article.product_pod h3 a').map((_, link) => ({
    product_url: canonicalUrl($(link).attr('href'), pageUrl),
    source_page: pageUrl,
  })).get();
  if (!books.length) throw new Error('No book links found in catalogue');
  const next = $('li.next a').attr('href');
  return { books, next: next ? canonicalUrl(next, pageUrl) : null };
}

export function uniqueBooks(books) {
  return [...new Map(books.map(book => [canonicalUrl(book.product_url), book])).values()];
}
