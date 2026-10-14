import { createFetcher } from './fetcher.js';
import { START_URL } from './config.js';

await createFetcher().get(START_URL);
