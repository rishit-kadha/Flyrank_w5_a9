import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const ORIGIN = 'https://books.toscrape.com';
export const START_URL = ORIGIN + '/catalogue/page-1.html';
export const USER_AGENT = 'FlyRankInternship-A9/1.0 (+https://github.com/rishit-kadha/Flyrank_w5_a9)';
export const DELAY_MS = 550;
export const TIMEOUT_MS = 15000;

export function canonicalUrl(href, base = START_URL) {
  const url = new URL(href, base);
  if (url.origin !== ORIGIN || url.username || url.password || !url.pathname.startsWith('/catalogue/')) {
    throw new Error('URL is outside the approved catalogue scope');
  }
  url.hash = '';
  url.search = '';
  return url.href;
}
