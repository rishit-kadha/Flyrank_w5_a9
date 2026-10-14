import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createFetcher, HttpError } from '../src/fetcher.js';
import { START_URL, USER_AGENT } from '../src/config.js';

async function temporaryCache(t) {
  const directory = await mkdtemp(join(tmpdir(), 'polite-fetcher-'));
  t.after(async () => {
    const target = resolve(directory);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith('polite-fetcher-'));
    await rm(target, { recursive: true, force: true });
  });
  return directory;
}

function clock() {
  let current = Date.UTC(2026, 9, 14, 8);
  const waits = [];
  return {
    now: () => current,
    pause: async milliseconds => { waits.push(milliseconds); current += milliseconds; },
    advance: milliseconds => { current += milliseconds; },
    waits,
  };
}

test('fetch sends an identifying header, enforces timeout and manual redirects, and caches provenance', async t => {
  const cacheDir = await temporaryCache(t);
  const time = clock();
  const messages = [];
  let calls = 0;
  const fetcher = createFetcher({
    cacheDir, ...time, timeoutMs: 50, log: message => messages.push(message),
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, START_URL);
      assert.equal(options.headers['User-Agent'], USER_AGENT);
      assert.match(USER_AGENT, /FlyRankInternship-A9\/1\.0.*github\.com/);
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.signal.aborted, false);
      assert.equal(options.redirect, 'manual');
      return new Response('<p>£12.34</p>', { status: 200 });
    },
  });
  const original = await fetcher.get(START_URL);
  assert.equal(calls, 1);
  assert.equal(await readFile(join(cacheDir, 'catalogue-page-1.html'), 'utf8'), original.html);
  const metadata = JSON.parse(await readFile(join(cacheDir, 'catalogue-page-1.json'), 'utf8'));
  assert.deepEqual(metadata, { url: START_URL, fetched_at: original.fetched_at });
  time.advance(24 * 60 * 60 * 1000);
  const rerun = createFetcher({
    cacheDir, ...time, log: message => messages.push(message),
    fetchImpl: async () => { assert.fail('A cache hit must never contact the network'); },
  });
  assert.deepEqual(await rerun.get(START_URL), original);
  assert.deepEqual(rerun.stats, { pages_fetched: 0, cache_hits: 1, request_attempts: 0, retries: 0 });
  assert.deepEqual(time.waits, []);
  const bytes = Buffer.byteLength(original.html);
  assert.ok(messages.some(message => message.startsWith('FETCH ') && message.includes(`bytes=${bytes}`)));
  assert.ok(messages.some(message => message.startsWith('CACHE HIT ') && message.includes(`bytes=${bytes}`)));
  assert.ok(messages.every(message => !message.includes(original.html)));
});

test('successful real requests are paced while cached pages require no pause', async t => {
  const cacheDir = await temporaryCache(t);
  const time = clock();
  const requestedAt = [];
  const fetcher = createFetcher({
    cacheDir, ...time, delayMs: 550, log: () => {},
    fetchImpl: async () => { requestedAt.push(time.now()); time.advance(20); return new Response('html'); },
  });
  await fetcher.get(START_URL);
  await fetcher.get('https://books.toscrape.com/catalogue/page-2.html');
  await fetcher.get(START_URL);
  assert.equal(requestedAt.length, 2);
  assert.ok(requestedAt[1] - requestedAt[0] >= 500);
  assert.deepEqual(time.waits, [550]);
  assert.equal(fetcher.stats.cache_hits, 1);
  assert.equal(fetcher.stats.pages_fetched, 2);
  assert.throws(() => createFetcher({ delayMs: 499 }), /at least 500/);
});

test('a 5xx response retries once after a delay and saves only the successful response', async t => {
  const cacheDir = await temporaryCache(t);
  const time = clock();
  const requests = [];
  const fetcher = createFetcher({
    cacheDir, ...time, log: () => {},
    fetchImpl: async () => {
      requests.push(time.now());
      return requests.length === 1 ? new Response('server failure', { status: 503 }) : new Response('good HTML');
    },
  });
  assert.equal((await fetcher.get(START_URL)).html, 'good HTML');
  assert.equal(requests.length, 2);
  assert.ok(requests[1] - requests[0] >= 500);
  assert.equal(fetcher.stats.retries, 1);
  assert.equal(fetcher.stats.request_attempts, 2);
  assert.equal(fetcher.stats.pages_fetched, 1);
  assert.equal(await readFile(join(cacheDir, 'catalogue-page-1.html'), 'utf8'), 'good HTML');
});

test('two server failures stop after the single allowed retry and leave no cache', async t => {
  const cacheDir = await temporaryCache(t);
  const time = clock();
  let calls = 0;
  const fetcher = createFetcher({
    cacheDir, ...time, log: () => {},
    fetchImpl: async () => { calls++; return new Response('down', { status: 500 }); },
  });
  await assert.rejects(fetcher.get(START_URL), error => error instanceof HttpError && error.status === 500);
  assert.equal(calls, 2);
  assert.equal(fetcher.stats.retries, 1);
  assert.equal(fetcher.stats.pages_fetched, 0);
  assert.deepEqual(await readdir(cacheDir), []);
});

test('the timeout signal aborts each attempt and a persistent timeout retries only once', async t => {
  const cacheDir = await temporaryCache(t);
  const time = clock();
  const signals = [];
  const fetcher = createFetcher({
    cacheDir, ...time, timeoutMs: 10, log: () => {},
    fetchImpl: async (_url, { signal }) => {
      signals.push(signal);
      await sleep(25);
      assert.equal(signal.aborted, true);
      throw signal.reason;
    },
  });
  await assert.rejects(fetcher.get(START_URL), { name: 'TimeoutError' });
  assert.equal(signals.length, 2);
  assert.notEqual(signals[0], signals[1]);
  assert.equal(fetcher.stats.retries, 1);
  assert.equal(fetcher.stats.request_attempts, 2);
  assert.deepEqual(await readdir(cacheDir), []);
});

for (const status of [403, 404, 301]) {
  test(`HTTP ${status} is not retried, parsed, or cached`, async t => {
    const cacheDir = await temporaryCache(t);
    const time = clock();
    let calls = 0;
    let cancellations = 0;
    const fetcher = createFetcher({
      cacheDir, ...time, log: () => {},
      fetchImpl: async () => {
        calls++;
        return { status, body: { cancel: async () => { cancellations++; } }, text: async () => { assert.fail('Only a 200 response may be read as HTML'); } };
      },
    });
    await assert.rejects(fetcher.get(START_URL), error => error.status === status);
    assert.equal(calls, 1);
    assert.equal(cancellations, 1);
    assert.equal(fetcher.stats.retries, 0);
    assert.equal(fetcher.stats.pages_fetched, 0);
    assert.deepEqual(await readdir(cacheDir), []);
  });
}

test('out-of-scope URLs are refused before making any request', async t => {
  const cacheDir = await temporaryCache(t);
  const fetcher = createFetcher({ cacheDir, log: () => {}, fetchImpl: async () => assert.fail('Out-of-scope request') });
  for (const url of [
    'https://example.com/catalogue/page-1.html',
    'http://books.toscrape.com/catalogue/page-1.html',
    'https://books.toscrape.com/admin',
    'https://name:password@books.toscrape.com/catalogue/page-1.html',
  ]) {
    await assert.rejects(fetcher.get(url), /outside the approved catalogue scope/);
  }
  assert.equal(fetcher.stats.request_attempts, 0);
});
