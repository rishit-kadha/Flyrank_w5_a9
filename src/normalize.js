export function normalizePrice(value) {
  if (typeof value !== 'string' || !/^£\d+\.\d{2}$/.test(value.trim())) {
    throw new Error('Expected a GBP price such as £51.77');
  }
  const amount = Number(value.trim().slice(1));
  if (!Number.isFinite(amount)) throw new Error('Price must be finite');
  return amount;
}

export function normalizeRecord(raw) {
  return { ...raw, price_gbp: normalizePrice(raw.price_text) };
}
