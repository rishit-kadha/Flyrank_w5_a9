import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { ROOT, USER_AGENT, DELAY_MS, TIMEOUT_MS, canonicalUrl } from './config.js';

export class HttpError extends Error {
  constructor(status, url) {
    super('HTTP ' + status + ': ' + url);
    this.status = status;
  }
}

export function createFetcher({
  cacheDir = join(ROOT, 'cache'), fetchImpl = fetch, pause = sleep,
  now = Date.now, delayMs = DELAY_MS, timeoutMs = TIMEOUT_MS, log = console.log,
} = {}) {
  if (delayMs < 500) throw new Error('Request delay must be at least 500 ms');
  const stats = { pages_fetched: 0, cache_hits: 0, request_attempts: 0, retries: 0 };
  let nextRequestAt = 0;

  async function get(inputUrl) {
    const url = canonicalUrl(inputUrl);
    const catalogue = new URL(url).pathname.match(/^\/catalogue\/page-(\d+)\.html$/);
    const filename = catalogue ? 'catalogue-page-' + catalogue[1] : 'book-' + createHash('sha256').update(url).digest('hex');
    const htmlPath = join(cacheDir, filename + '.html');
    const metadataPath = join(cacheDir, filename + '.json');
    try {
      const html = await readFile(htmlPath, 'utf8');
      const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
      if (metadata.url !== url || !Number.isFinite(Date.parse(metadata.fetched_at))) throw new Error('Invalid cache metadata: ' + filename);
      stats.cache_hits++;
      log('CACHE HIT ' + url + ' bytes=' + Buffer.byteLength(html));
      return { html, url, fetched_at: metadata.fetched_at };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    let html;
    for (let attempt = 0; attempt < 2; attempt++) {
      const wait = nextRequestAt - now();
      if (wait > 0) await pause(wait);
      stats.request_attempts++;
      try {
        const response = await fetchImpl(url, {
          headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs), redirect: 'manual',
        });
        if (response.status !== 200) {
          await response.body?.cancel();
          throw new HttpError(response.status, url);
        }
        html = await response.text();
        break;
      } catch (error) {
        const timeout = ['TimeoutError', 'AbortError'].includes(error.name)
          || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(error.cause?.code);
        const serverError = error.status >= 500 && error.status <= 599;
        if (attempt !== 0 || (!timeout && !serverError)) throw error;
        stats.retries++;
        log('RETRY ' + url + ' reason=' + error.message);
        await pause(1000);
      } finally {
        nextRequestAt = now() + delayMs;
      }
    }
    const fetched_at = new Date(now()).toISOString();
    stats.pages_fetched++;
    await mkdir(cacheDir, { recursive: true });
    await writeFile(htmlPath, html);
    await writeFile(metadataPath, JSON.stringify({ url, fetched_at }, null, 2) + '\n');
    log('FETCH ' + url + ' status=200 bytes=' + Buffer.byteLength(html));
    return { html, url, fetched_at };
  }
  return { get, stats };
}
