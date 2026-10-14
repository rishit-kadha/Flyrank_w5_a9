import { load } from 'cheerio';
import { canonicalUrl } from './config.js';

export function parseCatalogue(html, pageUrl) {
  const $ = load(html);
  const books = $('article.product_pod h3 a').map((_, link) => {
    const href = $(link).attr('href');
    if (!href) throw new Error('Book link has no href');
    return { product_url: canonicalUrl(href, pageUrl), source_page: pageUrl };
  }).get();
  if (!books.length) throw new Error('No book links found in catalogue');
  const next = $('li.next a').attr('href');
  return { books, next: next ? canonicalUrl(next, pageUrl) : null };
}

export function uniqueBooks(books) {
  const unique = new Map();
  for (const book of books) {
    const product_url = canonicalUrl(book.product_url);
    if (!unique.has(product_url)) unique.set(product_url, { ...book, product_url });
  }
  return [...unique.values()];
}

const text = value => value.replace(/\s+/g, ' ').trim();
export function parseBook(html, { product_url, source_page, fetched_at }) {
  const $ = load(html);
  const product = $('article.product_page');
  const main = product.find('.product_main');
  const rating = (main.find('.star-rating').attr('class') ?? '').split(/\s+/).find(value => ['One', 'Two', 'Three', 'Four', 'Five'].includes(value)) ?? '';
  const description = text(product.find('#product_description').next('p').text());
  return {
    title: text(main.find('h1').text()),
    product_url: canonicalUrl(product_url),
    price_text: text(main.find('.price_color').first().text()),
    availability_text: text(main.find('.availability').text()),
    rating_text: rating,
    description: description || null,
    source_page: canonicalUrl(source_page),
    fetched_at,
  };
}
