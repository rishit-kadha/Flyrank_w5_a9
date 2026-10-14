import { START_URL } from './config.js';
import { parseCatalogue, uniqueBooks } from './parse.js';

export async function discover(fetcher) {
  let pageUrl = START_URL;
  const visited = new Set();
  const books = [];
  for (let page = 0; page < 3; page++) {
    if (!pageUrl || visited.has(pageUrl)) throw new Error('Catalogue ended or repeated before page 3');
    const response = await fetcher.get(pageUrl);
    const parsed = parseCatalogue(response.html, pageUrl);
    visited.add(pageUrl);
    books.push(...parsed.books);
    pageUrl = parsed.next;
  }
  return { books: uniqueBooks(books), catalogue_pages: visited.size, discovered: books.length };
}
