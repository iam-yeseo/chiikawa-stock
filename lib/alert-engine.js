import { randomUUID } from 'node:crypto';
import { stockKey } from './config.js';

export const THRESHOLDS = Object.freeze([5, 10, 15, 20, 25, 30]);

export function positiveNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 1e12 ? number : null;
}

export function baselinePrice(stock, mode, previousClose) {
  const price = mode === 'previousClose' ? previousClose
    : mode === 'purchase' ? stock.purchasePrice
      : mode === 'custom' ? stock.referencePrice : stock.trackingPrice;
  return positiveNumber(price);
}

export function percentChange(price, baseline) {
  if (positiveNumber(price) === null || positiveNumber(baseline) === null) return null;
  // Decimal price inputs need stable threshold boundaries (105 / 100 is not exact).
  return Math.round(((Number(price) - Number(baseline)) / Number(baseline)) * 1e10) / 1e8;
}

export class AlertEngine {
  constructor() { this.samples = new Map(); }
  reset(key) { key ? this.samples.delete(key) : this.samples.clear(); }
  ingest(quote, signature = quote.baselinePrice, { initialize = false } = {}) {
    const key = stockKey(quote);
    const percent = quote.changePercent;
    if (typeof percent !== 'number' || !Number.isFinite(percent) || quote.stale) {
      this.samples.delete(key);
      return null;
    }
    const prior = this.samples.get(key);
    this.samples.set(key, { percent, signature });
    if (initialize || !prior || prior.signature !== signature) return null;
    const crossed = THRESHOLDS.filter(level => percent >= level && prior.percent < level);
    const down = THRESHOLDS.filter(level => percent <= -level && prior.percent > -level);
    const levels = crossed.length ? crossed : down;
    if (!levels.length) return null;
    return {
      id: randomUUID(), symbol: quote.symbol, name: quote.name,
      price: quote.price, percent, level: levels.at(-1), direction: crossed.length ? 'up' : 'down',
      at: quote.updatedAt,
    };
  }
}
