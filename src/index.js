import { createFetcher } from './fetcher.js';
import { discover } from './discover.js';

const result = await discover(createFetcher());
console.log('catalogue_pages=' + result.catalogue_pages + ' discovered=' + result.discovered + ' unique_urls=' + result.books.length);
