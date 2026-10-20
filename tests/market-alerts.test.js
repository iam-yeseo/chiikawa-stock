import test from 'node:test';
import assert from 'node:assert/strict';
import { AlertEngine, baselinePrice, percentChange, positiveNumber } from '../lib/alert-engine.js';
import { defaultConfig, normalizeConfig, stockKey } from '../lib/config.js';
import { marketDay, selectPreviousClose } from '../lib/toss-client.js';

const quote = percent => ({ symbol: 'AAPL', name: '애플', market: 'US', price: 100 + percent, changePercent: percent, baselinePrice: 100, updatedAt: 123456, stale: false });

test('threshold crossings repeat on reentry and ignore movements within the same tier', () => {
  const engine = new AlertEngine();
  assert.equal(engine.ingest(quote(4)), null);
  assert.equal(engine.ingest(quote(5)).level, 5);
  assert.equal(engine.ingest(quote(6)), null);
  assert.equal(engine.ingest(quote(4)), null);
  assert.equal(engine.ingest(quote(5)).level, 5);
  assert.equal(engine.ingest(quote(10)).level, 10);
  assert.equal(engine.ingest(quote(9)), null);
  assert.equal(engine.ingest(quote(10)).level, 10);
});

test('large jumps emit only the highest crossed level in each direction, capped at 30', () => {
  const engine = new AlertEngine();
  engine.ingest(quote(0));
  assert.equal(engine.ingest(quote(27)).level, 25);
  const down = engine.ingest(quote(-39));
  assert.equal(down.level, 30);
  assert.equal(down.direction, 'down');
  assert.equal(engine.ingest(quote(-40)), null);
  assert.equal(engine.ingest(quote(-29)), null);
  assert.equal(engine.ingest(quote(-30)).level, 30);
});

test('startup, reconnect, baseline resets and stale samples do not invent historical crossings', () => {
  const engine = new AlertEngine();
  assert.equal(engine.ingest(quote(12)), null);
  engine.reset();
  assert.equal(engine.ingest(quote(25)), null);
  assert.equal(engine.ingest(quote(26), 'new-reference'), null);
  assert.equal(engine.ingest({ ...quote(28), stale: true }, 'new-reference'), null);
  assert.equal(engine.ingest(quote(30), 'new-reference'), null);
  assert.equal(engine.ingest({ ...quote(40), changePercent: null }), null);
});

test('all reference modes require real positive inputs; thresholds tolerate floating decimal inputs', () => {
  const stock = { purchasePrice: 80, referencePrice: 90, trackingPrice: 100 };
  assert.equal(baselinePrice(stock, 'previousClose', 110), 110);
  assert.equal(baselinePrice(stock, 'purchase', 110), 80);
  assert.equal(baselinePrice(stock, 'custom', 110), 90);
  assert.equal(baselinePrice(stock, 'tracking', 110), 100);
  assert.equal(baselinePrice({}, 'purchase', 110), null);
  assert.equal(percentChange(105, 100), 5);
  assert.equal(percentChange(95, 100), -5);
  assert.equal(percentChange(0.21, 0.2), 5);
  assert.equal(percentChange(null, 100), null);
  for (const value of [null, '', true, [], {}, Infinity, -1, '1e6', '0x20']) assert.equal(positiveNumber(value), null);
});

test('config includes 10 KR/10 US stocks, independent copies, and validates untrusted input', () => {
  const a = defaultConfig();
  const b = defaultConfig();
  assert.equal(a.watchlist.filter(stock => stock.market === 'KR').length, 10);
  assert.equal(a.watchlist.filter(stock => stock.market === 'US').length, 10);
  a.watchlist[0].name = 'changed';
  assert.equal(b.watchlist[0].name, '삼성전자');
  assert.equal(normalizeConfig({ intervalMinutes: 1 }, b).watchlist.length, 20);
  assert.equal(normalizeConfig({ watchlist: [] }).watchlist.length, 0);
  assert.equal(normalizeConfig({ watchlist: [{ symbol: ' aapl ', name: 'Apple', market: 'US' }] }).watchlist[0].symbol, 'AAPL');
  assert.equal(stockKey(normalizeConfig({ watchlist: [{ symbol: '0101N0', market: 'KR' }] }).watchlist[0]), 'KR:0101N0');
  for (const input of [null, [], { intervalMinutes: 0 }, { intervalMinutes: '5' }, { intervalMinutes: Infinity }, { baseline: 'unknown' }, { petSize: 10000 }, { roaming: 'yes' }, { clientSecret: 'nope' }, { watchlist: [...b.watchlist, b.watchlist[0]] }, { watchlist: [{ symbol: 'AAPL<script>', market: 'US' }] }, { watchlist: [{ symbol: 'AAPL', market: 'US', purchasePrice: -1 }] }]) {
    assert.throws(() => normalizeConfig(input));
  }
});

test('speech size defaults to 100 percent, migrates missing fields, and validates 10 percent steps', () => {
  assert.equal(defaultConfig().speechScale, 100);
  const legacy = defaultConfig(); delete legacy.speechScale;
  assert.equal(normalizeConfig({}, legacy).speechScale, 100);
  assert.equal(normalizeConfig(legacy).speechScale, 100);
  for (const speechScale of [80, 90, 100, 110, 120, 130, 140, 150, 160]) {
    assert.equal(normalizeConfig({speechScale}, legacy).speechScale, speechScale);
  }
  for (const speechScale of [70, 170, 85, 99, 100.5, '100', null, undefined, Infinity, NaN, true]) {
    assert.throws(() => normalizeConfig({speechScale}), /말풍선/);
  }
});

test('US trade dates roll over at NY 20:00 across DST; KR rolls at local midnight', () => {
  assert.equal(marketDay(Date.parse('2026-10-20T19:59:59-04:00'), 'US'), '2026-10-20');
  assert.equal(marketDay(Date.parse('2026-10-20T20:00:00-04:00'), 'US'), '2026-10-21');
  assert.equal(marketDay(Date.parse('2026-12-01T20:00:00-05:00'), 'US'), '2026-12-02');
  assert.equal(marketDay(Date.parse('2026-03-08T20:00:00-04:00'), 'US'), '2026-03-09');
  assert.equal(marketDay(Date.parse('2026-10-20T00:00:00+09:00'), 'KR'), '2026-10-20');
});

test('previous close uses prior completed trading date in premarket, afterhours, overnight and weekend', () => {
  const usCandles = [
    { timestamp: '2026-10-20T13:00:00+09:00', closePrice: '110' },
    { timestamp: '2026-10-19T13:00:00+09:00', closePrice: '100' },
    { timestamp: '2026-10-16T13:00:00+09:00', closePrice: '90' },
  ];
  assert.equal(selectPreviousClose(usCandles, 'US', Date.parse('2026-10-20T06:00:00-04:00')), 100);
  assert.equal(selectPreviousClose(usCandles, 'US', Date.parse('2026-10-20T17:00:00-04:00')), 100);
  assert.equal(selectPreviousClose(usCandles, 'US', Date.parse('2026-10-20T21:00:00-04:00')), 110);
  assert.equal(selectPreviousClose(usCandles, 'US', Date.parse('2026-10-18T21:00:00-04:00')), 90);
  assert.equal(selectPreviousClose(usCandles, 'US', Date.parse('2026-10-17T10:00:00-04:00')), 90);
  const kr = [{ timestamp: '2026-10-20T00:00:00+09:00', closePrice: '101' }, { timestamp: '2026-10-19T00:00:00+09:00', closePrice: '99' }];
  assert.equal(selectPreviousClose(kr, 'KR', Date.parse('2026-10-20T08:00:00+09:00')), 99);
  assert.equal(selectPreviousClose([], 'US'), null);
});
