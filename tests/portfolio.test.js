import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { defaultConfig, normalizeConfig, stockKey } from '../lib/config.js';
import { MarketService } from '../lib/market-service.js';
import { TossClient } from '../lib/toss-client.js';
import { assetNumber, normalizeAccounts, normalizeHoldings, mergeOwnedStocks } from '../lib/portfolio.js';

const AT = Date.parse('2026-10-20T12:00:00-04:00');
const tick = () => new Promise(resolve => setImmediate(resolve));
const accounts = [{ accountNo: '12345678901', accountSeq: 1, accountType: 'BROKERAGE' }, { accountNo: '55555555555', accountSeq: 2, accountType: 'FUTURE_ENUM' }];
const credentials = async () => ({ clientId: 'fixture-id', clientSecret: 'fixture-secret' });
const response = (result, status = 200, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => result });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const item = (symbol = 'AAPL', quantity = '2.5') => ({ symbol, name: symbol, marketCountry: 'US', currency: 'USD', quantity, lastPrice: '100', averagePurchasePrice: '80', marketValue: { purchaseAmount: '200', amount: '250', amountAfterCost: '248' }, profitLoss: { amount: '50', amountAfterCost: '48', rate: '0.25', rateAfterCost: '0.24' }, dailyProfitLoss: { amount: '-2.5', rate: '-0.01' }, cost: { commission: '2', tax: null } });
const holdings = (items = [item()]) => ({ totalPurchaseAmount: { krw: '0', usd: items.length ? '200' : null }, marketValue: { amount: { krw: '0', usd: items.length ? '250' : null }, amountAfterCost: { krw: '0', usd: items.length ? '248' : null } }, profitLoss: { amount: { krw: '0', usd: items.length ? '50' : null }, amountAfterCost: { krw: '0', usd: items.length ? '48' : null }, rate: items.length ? '0.25' : '0', rateAfterCost: items.length ? '0.24' : '0' }, dailyProfitLoss: { amount: { krw: '0', usd: items.length ? '-2.5' : null }, rate: items.length ? '-0.01' : '0' }, items });

class Socket extends EventEmitter {
  constructor() { super(); this.readyState = 0; this.sent = []; setImmediate(() => { if (this.readyState === 3) return; this.readyState = 1; this.emit('open'); }); }
  send(text) { this.sent.push(text); if (text === 'PING') return; const groups = JSON.parse(text); setImmediate(() => this.push({ type: 'subscriptions', subscribed: groups.flatMap(group => group.codes.map(symbol => `${group.type}:${symbol}`)), rejected: [] })); }
  push(frame) { this.emit('message', Buffer.from(JSON.stringify(frame))); }
  terminate() { this.readyState = 3; }
}
function fixture(intercept = () => null) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options }); const intercepted = intercept(url, options); if (intercepted) return intercepted;
    if (url.endsWith('/oauth2/token')) return response({ access_token: 'fixture-token', expires_in: 3600 });
    if (url.includes('/accounts?')) return response({ result: accounts });
    if (url.includes('/holdings?')) return response({ result: holdings() });
    if (url.includes('/prices?')) return response({ result: new URL(url).searchParams.get('symbols').split(',').map(symbol => ({ symbol, lastPrice: '100', currency: /^\d/.test(symbol) ? 'KRW' : 'USD', timestamp: new Date(AT).toISOString() })) });
    if (url.includes('/candles?')) return response({ result: { candles: [{ timestamp: '2026-10-19T13:00:00+09:00', closePrice: '100' }] } });
    throw new Error('unexpected fixture');
  }; fetch.calls = calls; return fetch;
}
async function live(t, { config = { watchlist: [{ symbol: 'MSFT', name: 'Microsoft', market: 'US' }] }, fetchImpl = fixture() } = {}) {
  const service = new MarketService({ config, credentialProvider: credentials, fetchImpl, WebSocketImpl: Socket, now: () => AT, sleepImpl: async () => {} });
  t.after(() => service.stop()); await service.start('live'); await tick(); await tick(); return { service, fetchImpl, socket: service.socket };
}

test('account normalization masks full numbers and permits unknown account types without raw data', () => {
  assert.deepEqual(normalizeAccounts(accounts), [{ id: 1, label: '종합매매 · ****8901' }, { id: 2, label: '계좌 · ****5555' }]);
  assert.equal(normalizeAccounts([{ accountSeq: Number.MAX_SAFE_INTEGER + 1, accountNo: '123' }]).length, 0);
});

test('official decimal strings, fractional quantities, negative P&L, ratios and null currencies normalize correctly', () => {
  const result = normalizeHoldings(holdings());
  assert.equal(result.items[0].quantity, 2.5);
  assert.equal(result.items[0].profitLossPercent, 25);
  assert.equal(result.items[0].dailyChangePercent, -1);
  assert.equal(result.items[0].tax, null);
  assert.deepEqual(result.dailyProfitLoss, { krw: 0, usd: -2.5 });
  assert.deepEqual(normalizeHoldings(holdings([])).marketValue, { krw: 0, usd: null });
  for (const invalid of [null, undefined, '', ' ', 'NaN', 'Infinity', '1e5', {}, 0]) assert.equal(assetNumber(invalid), null);
  const malformed = normalizeHoldings(holdings([item(), { ...item('XYZ'), marketCountry: 'JP' }, item('ZERO', '0'), item('BAD', 'bad')]));
  assert.equal(malformed.unsupportedCount, 2);
  assert.equal(mergeOwnedStocks([], malformed).watchlist.length, 1);
});

test('holdings merge deduplicates without replacing manual names or baselines and reports capacity omissions', () => {
  const manual = { symbol: 'AAPL', name: '내 애플', market: 'US', purchasePrice: 50, referencePrice: 60, trackingPrice: 70 };
  const normalized = normalizeHoldings(holdings([item(), item('TSLA')]));
  const merged = mergeOwnedStocks([manual], normalized);
  assert.deepEqual(merged.watchlist[0], manual);
  assert.deepEqual(merged.watchlist[1], { symbol: 'TSLA', name: 'TSLA', market: 'US' });
  const full = Array.from({ length: 100 }, (_, index) => ({ symbol: `X${index}`, name: `X${index}`, market: 'US' }));
  assert.equal(mergeOwnedStocks(full, normalized).omittedCount, 2);
  assert.deepEqual(mergeOwnedStocks(full, normalized, false), { watchlist: full, added: [], omittedCount: 0 });
});

test('0.2 settings default auto watch on, preserve false, and reject malformed toggles', () => {
  assert.equal(defaultConfig().autoWatchHoldings, true);
  assert.equal(normalizeConfig({}).autoWatchHoldings, true);
  assert.equal(normalizeConfig({ autoWatchHoldings: false }).autoWatchHoldings, false);
  for (const value of [0, 1, 'true', null]) assert.throws(() => normalizeConfig({ autoWatchHoldings: value }));
});

test('account and asset requests share one token, attach accountSeq only to holdings, and respect separate quotas', async () => {
  let now = AT; const delays = []; const fetchImpl = fixture();
  const client = new TossClient({ credentialProvider: credentials, fetchImpl, now: () => now, sleepImpl: async ms => { delays.push(ms); now += ms; } });
  await client.accounts(); await client.accounts(); await client.holdings(2); await client.holdings(2); await client.prices([{ symbol: 'AAPL' }]);
  assert.deepEqual(delays, [1100, 220]);
  assert.equal(fetchImpl.calls.filter(call => call.url.endsWith('/oauth2/token')).length, 1);
  assert.equal(fetchImpl.calls.find(call => call.url.includes('/accounts?')).options.headers['X-Tossinvest-Account'], undefined);
  assert.equal(fetchImpl.calls.find(call => call.url.includes('/holdings?')).options.headers['X-Tossinvest-Account'], '2');
  assert.ok(fetchImpl.calls.filter(call => !call.url.endsWith('/oauth2/token')).every(call => call.options.headers.Authorization === 'Bearer fixture-token'));
  await assert.rejects(client.holdings('12345678901'));
  client.abort();
});

test('expired holdings requests renew once and retain account header on retry; account permission errors do not block prices', async () => {
  let attempts = 0;
  const fetchImpl = fixture(url => url.includes('/holdings?') && attempts++ === 0 ? response({ error: { code: 'expired-token' } }, 401) : null);
  const client = new TossClient({ credentialProvider: credentials, fetchImpl, now: () => AT, sleepImpl: async () => {} });
  await client.holdings(2);
  assert.equal(fetchImpl.calls.filter(call => call.url.endsWith('/oauth2/token')).length, 2);
  assert.deepEqual(fetchImpl.calls.filter(call => call.url.includes('/holdings?')).map(call => call.options.headers['X-Tossinvest-Account']), ['2', '2']);
  client.abort();
  const denied = new TossClient({ credentialProvider: credentials, fetchImpl: fixture(url => url.includes('/holdings?') ? response({ error: { code: 'forbidden', message: 'raw account secret' } }, 403) : null), now: () => AT, sleepImpl: async () => {} });
  await assert.rejects(denied.holdings(1)); assert.equal(denied.blocked, null); assert.equal((await denied.prices([{ symbol: 'AAPL' }])).items.length, 1); denied.abort();
});

test('owned stocks enter subscriptions and interval bulletins first and trigger the existing immediate thresholds', async t => {
  const { service, socket, fetchImpl } = await live(t);
  assert.equal(service.getState().portfolio.status, 'ready');
  assert.deepEqual(service.getState().config.watchlist.map(stockKey), ['US:MSFT', 'US:AAPL']);
  assert.deepEqual(JSON.parse(socket.sent[0]), [{ type: 'trade:us', codes: ['MSFT', 'AAPL'] }]);
  const bulletins = []; service.on('bulletin', value => bulletins.push(value)); service._emitBulletin();
  assert.deepEqual(bulletins[0].quotes.map(quote => quote.symbol), ['AAPL', 'MSFT']);
  await service.updateConfig({ intervalMinutes: 3 }); assert.equal(service.bulletinTimer._idleTimeout, 180000);
  socket.push({ type: 'message', topic: 'trade:us:AAPL', data: { price: '105', currency: 'USD', timestamp: new Date(AT + 1).toISOString() } });
  assert.equal(service.getState().alerts[0].symbol, 'AAPL'); assert.equal(service.getState().alerts[0].level, 5);
  const snapshot = JSON.stringify(service.getState()), saved = JSON.stringify(service.getPersistedConfig());
  for (const secret of ['12345678901', '55555555555', 'fixture-token', 'fixture-secret', 'accountNo', 'accountSeq']) { assert.ok(!snapshot.includes(secret)); assert.ok(!saved.includes(secret)); }
  assert.equal(fetchImpl.calls.filter(call => call.url.endsWith('/oauth2/token')).length, 1);
  assert.equal(service.portfolioTimer._idleTimeout, 60000);
});

test('disabling auto watch prevents additions, enabling adds owned shares without removing manual stocks', async t => {
  const { service } = await live(t, { config: { watchlist: [{ symbol: 'MSFT', name: 'Microsoft', market: 'US' }], autoWatchHoldings: false } });
  assert.deepEqual(service.config.watchlist.map(stockKey), ['US:MSFT']);
  await service.updateConfig({ autoWatchHoldings: true }); assert.deepEqual(service.config.watchlist.map(stockKey), ['US:MSFT', 'US:AAPL']);
  await service.updateConfig({ autoWatchHoldings: false, watchlist: [] }); await service.refreshPortfolio();
  assert.equal(service.config.watchlist.length, 0); assert.equal(service.portfolio.holdings.items.length, 1);
});

test('purchase baseline uses the current account average only when no manual override exists, without saving it', async t => {
  let average = '80';
  const fetchImpl = fixture(url => url.includes('/holdings?') ? response({ result: holdings([{ ...item(), averagePurchasePrice: average }]) }) : null);
  const { service, socket } = await live(t, { config: { watchlist: [{ symbol: 'AAPL', name: 'Apple', market: 'US' }], baseline: 'purchase' }, fetchImpl });
  assert.equal(service.getState().quotes[0].baselinePrice, 80); assert.equal(service.getPersistedConfig().watchlist[0].purchasePrice, undefined);
  average = '90'; await service.refreshPortfolio();
  assert.equal(service.getState().quotes[0].baselinePrice, 90, 'refresh rebases cached quotes before the next trade');
  const selecting = service.selectAccount(2);
  assert.equal(service.getState().quotes[0].baselinePrice, null, 'clearing the previous account immediately clears its implicit purchase baseline');
  assert.equal(service.getState().quotes[0].changePercent, null);
  await selecting;
  assert.equal(service.getState().quotes[0].baselinePrice, 90);
  socket.push({ type: 'message', topic: 'trade:us:AAPL', data: { price: '101', currency: 'USD', timestamp: new Date(AT + 1).toISOString() } });
  assert.equal(service.getState().quotes[0].baselinePrice, 90);
  await service.updateConfig({ watchlist: [{ symbol: 'AAPL', name: '내 애플', market: 'US', purchasePrice: 70 }] });
  assert.equal(service.getState().quotes[0].baselinePrice, 70);
});

for (const [status, code] of [[400, 'invalid-request'], [404, 'stock-not-found']]) test(`portfolio ${status} ${code} preserves stale holdings and healthy streaming without sensitive errors`, async t => {
  let fail = false;
  const { service, socket } = await live(t, { fetchImpl: fixture(url => fail && url.includes('/holdings?') ? response({ error: { code, message: '12345678901 secret' } }, status) : null) });
  const prior = service.getState().portfolio.holdings; fail = true; await service.refreshPortfolio();
  assert.equal(service.portfolio.status, 'error'); assert.equal(service.portfolio.stale, true); assert.deepEqual(service.portfolio.holdings, prior);
  assert.equal(service.connection.state, 'connected'); assert.equal(service.socket, socket); assert.equal(service.client.blocked, null);
  assert.ok(!JSON.stringify(service.getState()).includes('12345678901'));
  assert.ok(!JSON.stringify(service.getState()).includes('secret'));
  socket.push({ type: 'message', topic: 'trade:us:AAPL', data: { price: '105', currency: 'USD', timestamp: new Date(AT + 1).toISOString() } });
  assert.equal(service.getState().alerts[0].level, 5);
});

test('selected live account survives stop/start and direct reconnect without retaining account data while stopped', async t => {
  const { service } = await live(t);
  await service.selectAccount(2);
  service.stop();
  assert.equal(service.portfolio.selectedAccountId, 2);
  assert.equal(service.portfolio.holdings, null);
  assert.deepEqual(service.portfolio.accounts, []);
  await service.start('live');
  assert.equal(service.portfolio.selectedAccountId, 2);
  await service.start('live');
  assert.equal(service.portfolio.selectedAccountId, 2);
});

test('demo and live account IDs never carry across mode changes even if both modes use the same ID', async t => {
  const { service } = await live(t);
  await service.selectAccount(2);
  await service.start('demo');
  assert.equal(service.portfolio.selectedAccountId, 1);
  await service.selectAccount(2);
  service.stop();
  await service.start('live');
  assert.equal(service.portfolio.selectedAccountId, 1);
});

test('a selected account removed from the server falls back to the first available live account', async t => {
  let removed = false;
  const { service } = await live(t, { fetchImpl: fixture(url => removed && url.includes('/accounts?') ? response({ result: accounts.slice(0, 1) }) : null) });
  await service.selectAccount(2);
  removed = true;
  await service.start('live');
  assert.equal(service.portfolio.selectedAccountId, 1);
});

test('newly selected account clears old data immediately; a late response from the old account cannot overwrite it', async t => {
  let delayOld = false; const began = deferred(), pending = deferred();
  const fetchImpl = fixture((url, options) => {
    if (url.includes('/holdings?') && options.headers['X-Tossinvest-Account'] === '2') return response({ result: holdings([]) });
    if (url.includes('/holdings?') && delayOld) { began.resolve(); return pending.promise; }
  });
  const { service } = await live(t, { fetchImpl }); delayOld = true; const old = service.refreshPortfolio(); await began.promise;
  const selecting = service.selectAccount(2); assert.equal(service.portfolio.holdings, null); await selecting;
  pending.resolve(response({ result: holdings([item('LATE')]) })); await old;
  assert.equal(service.portfolio.selectedAccountId, 2); assert.deepEqual(service.portfolio.holdings.items, []);
  assert.ok(!service.config.watchlist.some(stock => stock.symbol === 'LATE'));
});

test('in-flight account response cannot contaminate demo or offline mode', async t => {
  const pending = deferred(), began = deferred();
  const service = new MarketService({ config: { watchlist: [] }, credentialProvider: credentials, fetchImpl: fixture(url => { if (url.includes('/accounts?')) { began.resolve(); return pending.promise; } }), WebSocketImpl: Socket, now: () => AT, sleepImpl: async () => {} });
  t.after(() => service.stop()); const opening = service.start('live'); await began.promise; await service.start('demo');
  pending.resolve(response({ result: accounts })); await opening;
  assert.equal(service.mode, 'demo'); assert.ok(service.portfolio.accounts[0].label.startsWith('데모')); assert.equal(service.portfolio.selectedAccountId, 1);
  service.stop(); assert.equal(service.portfolio.holdings, null); assert.deepEqual(service.portfolio.accounts, []);
});

test('demo auto additions are runtime only, including appearance saves, and stop cancels pending demo start', async t => {
  const service = new MarketService({ config: { watchlist: [{ symbol: 'MSFT', name: 'Microsoft', market: 'US' }] }, now: () => AT });
  t.after(() => service.stop()); const saves = []; service.on('config', value => saves.push(value)); await service.start('demo');
  assert.equal(service.config.watchlist.length, 3); await service.updateConfig({ speechScale: 120 });
  assert.deepEqual(service.getPersistedConfig().watchlist.map(stockKey), ['US:MSFT']); assert.deepEqual(saves.at(-1).watchlist.map(stockKey), ['US:MSFT']);
  service.stop(); assert.deepEqual(service.config.watchlist.map(stockKey), ['US:MSFT']);
  const opening = service.start('demo'); service.stop(); await opening;
  assert.equal(service.mode, 'offline'); assert.equal(service.running, false); assert.equal(service.demoTimer, null); assert.equal(service.portfolioTimer, null);
  await service.updateConfig({ baseline: 'purchase', watchlist: [{ symbol: 'AAPL', name: 'Apple', market: 'US' }] });
  await service.start('demo'); assert.equal(service.getState().quotes[0].baselinePrice, 155.3);
  const beforeStop = service.getPersistedConfig(); service.stop();
  assert.deepEqual(service.getPersistedConfig(), beforeStop);
  assert.equal(service.getState().quotes[0].baselinePrice, null);
  assert.equal(service.engine.samples.size, 0);
});

test('empty accounts and empty holdings are ready states, and full watchlists expose omitted owned stocks', async t => {
  const { service } = await live(t, { fetchImpl: fixture(url => url.includes('/accounts?') ? response({ result: [] }) : null) });
  assert.equal(service.portfolio.status, 'ready'); assert.equal(service.portfolio.selectedAccountId, null); assert.equal(service.portfolio.holdings, null);
  const full = Array.from({ length: 100 }, (_, index) => ({ symbol: `X${index}`, name: `X${index}`, market: 'US' }));
  const result = await live(t, { config: { watchlist: full } });
  assert.equal(result.service.portfolio.omittedWatchCount, 1); assert.match(result.service.portfolio.message, /100개.*1개/); assert.equal(result.service.config.watchlist.length, 100);
});

test('proven shared token revocation from holdings halts once without a token issuance loop', async t => {
  let fail = false;
  const fetchImpl = fixture(url => fail && url.includes('/holdings?') ? response({ error: { code: 'token-revoked' } }, 401) : null);
  const { service, socket } = await live(t, { fetchImpl }); fail = true; await service.refreshPortfolio();
  assert.equal(service.running, false); assert.equal(service.connection.state, 'error'); assert.equal(socket.readyState, 3);
  assert.equal(fetchImpl.calls.filter(call => call.url.endsWith('/oauth2/token')).length, 1);
});
