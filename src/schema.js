import { z } from 'zod';
import { canonicalUrl } from './config.js';

const catalogueUrl = z.string().url().refine(value => {
  try { return canonicalUrl(value) === value; } catch { return false; }
}, 'Expected a canonical HTTPS Books to Scrape catalogue URL');
export const BookSchema = z.object({
  title: z.string().trim().min(1),
  product_url: catalogueUrl,
  price_text: z.string().regex(/^£\d+\.\d{2}$/),
  availability_text: z.string().trim().min(1),
  rating_text: z.enum(['One', 'Two', 'Three', 'Four', 'Five']),
  description: z.string().trim().min(1).nullable().optional(),
  source_page: catalogueUrl,
  fetched_at: z.iso.datetime(),
  price_gbp: z.number().finite().nonnegative(),
}).strict().refine(record => Number(record.price_text.slice(1)) === record.price_gbp, {
  message: 'Normalized price must match the raw price', path: ['price_gbp'],
});
