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
