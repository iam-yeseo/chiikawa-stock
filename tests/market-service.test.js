import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { MarketService } from '../lib/market-service.js';
import { TossClient } from '../lib/toss-client.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const AT = Date.parse('2026-10-20T12:00:00-04:00');
const single = { watchlist: [{ symbol: 'AAPL', name: '애플', market: 'US' }] };
const creds = async () => ({ clientId: 'fixture-client-id', clientSecret: 'fixture-secret' });

function response(payload, status = 200, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => payload };
}

class FakeSocket extends EventEmitter {
  static instances = [];
  constructor(url, options) {
    super();
    this.url = url; this.options = options; this.readyState = 0; this.sent = [];
    FakeSocket.instances.push(this);
    setImmediate(() => { if (this.readyState === 3) return; this.readyState = 1; this.emit('open'); });
  }
  send(text) {
    this.sent.push(text);
    if (text === 'PING') return this.push({ type: 'pong' });
    const groups = JSON.parse(text);
    setImmediate(() => this.push({ type: 'subscriptions', subscribed: groups.flatMap(group => group.codes.map(symbol => `${group.type}:${symbol}`)), rejected: [] }));
  }
  push(frame) { this.emit('message', Buffer.from(JSON.stringify(frame))); }
  terminate() { this.readyState = 3; }
}

function fixture({ price = '100', timestamp = new Date(AT).toISOString(), tokenResult, onRequest } = {}) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url, options });
    const result = onRequest?.(url, options);
    if (result) return result;
    if (url.endsWith('/oauth2/token')) return response(tokenResult || { access_token: 'fixture-access-token', token_type: 'Bearer', expires_in: 3600 });
    if (url.includes('/accounts?')) return response({ result: [] });
    if (url.includes('/prices?')) return response({ result: [{ symbol: 'AAPL', timestamp, lastPrice: price, currency: 'USD' }] });
    if (url.includes('/candles?')) return response({ result: { candles: [{ timestamp: '2026-10-20T13:00:00+09:00', closePrice: '999' }, { timestamp: '2026-10-19T13:00:00+09:00', closePrice: '100' }] } });
    if (url.includes('/stocks/all?')) return response({ result: [{ symbol: new URL(url).searchParams.get('market') === 'KOSPI' ? '005930' : 'AAPL', name: new URL(url).searchParams.get('market') === 'KOSPI' ? '삼성전자' : '애플' }] });
    throw new Error('Unexpected fixture path');
  };
  fn.calls = calls;
  return fn;
}

async function live(t, options = {}) {
  const fetchImpl = options.fetchImpl || fixture();
  const service = new MarketService({ config: single, credentialProvider: creds, fetchImpl, WebSocketImpl: FakeSocket, now: () => AT, sleepImpl: async () => {}, ...options });
  t.after(() => service.stop());
  await service.start('live');
  await tick(); await tick();
  return { service, socket: service.socket, fetchImpl };
}

test('live REST and WebSocket implement canonical fields and detect immediate crossings', async t => {
  const { service, socket, fetchImpl } = await live(t);
  assert.equal(service.getState().connection.state, 'connected');
  assert.equal(service.getState().quotes[0].previousClose, 100);
  assert.equal(service.getState().quotes[0].price, 100);
  assert.deepEqual(JSON.parse(socket.sent[0]), [{ type: 'trade:us', codes: ['AAPL'] }]);
  assert.equal(socket.options.headers.Authorization, 'Bearer fixture-access-token');
  const alerts = [];
  service.on('alert', alert => alerts.push(alert));
  socket.push({ type: 'message', topic: 'trade:us:AAPL', data: { price: '105', currency: 'USD', timestamp: new Date(AT + 1).toISOString(), volume: '10' } });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].level, 5);
  assert.equal(alerts[0].direction, 'up');
  const snapshot = JSON.stringify(service.getState());
  assert.ok(!snapshot.includes('fixture-secret'));
  assert.ok(!snapshot.includes('fixture-access-token'));
  assert.equal(fetchImpl.calls.filter(call => call.url.endsWith('/oauth2/token')).length, 1);
  assert.match(fetchImpl.calls.find(call => call.url.includes('/candles?')).url, /adjusted=true/);
});

test('old, malformed, wrong-currency and untracked websocket frames do not overwrite current quotes', async t => {
  const { service, socket } = await live(t);
  assert.equal(service.getState().config.watchlist[0].trackingPrice, 100, 'first live price is remembered even before tracking mode is selected');
  socket.push({ type: 'message', topic: 'trade:us:AAPL', data: { price: '104', currency: 'USD', timestamp: new Date(AT + 1).toISOString() } });
  for (const frame of [
    { topic: 'trade:us:AAPL', data: { price: '120', currency: 'USD', timestamp: new Date(AT - 1).toISOString() } },
    { topic: 'trade:us:AAPL', data: { price: '120', currency: 'KRW', timestamp: new Date(AT + 2).toISOString() } },
    { topic: 'trade:us:MSFT', data: { price: '120', currency: 'USD', timestamp: new Date(AT + 2).toISOString() } },
    { topic: 'trade:us:AAPL', data: { price: '120', currency: 'USD', timestamp: 'invalid' } },
  ]) socket.push({ type: 'message', ...frame });
  assert.equal(service.getState().quotes[0].price, 104);
  assert.equal(service.getState().alerts.length, 0);
});

test('initial above-threshold REST snapshot and first recovered snapshot do not alert', async t => {
  const { service, socket } = await live(t, { fetchImpl: fixture({ price: '125' }) });
  assert.equal(service.getState().alerts.length, 0);
  socket.push({ type: 'message', topic: 'trade:us:AAPL', data: { price: '130', currency: 'USD', timestamp: new Date(AT + 1).toISOString() } });
  assert.equal(service.getState().alerts.length, 1);
  service.engine.reset();
  service.quotes.clear();
  await service._refreshLive(true);
  assert.equal(service.getState().alerts.length, 1);
});

test('missing quote timestamps stay stale and missing reference prices never become 0%', async t => {
  const { service } = await live(t, { fetchImpl: fixture({ timestamp: null }), config: { ...single, baseline: 'purchase' } });
  const quote = service.getState().quotes[0];
  assert.equal(quote.updatedAt, null);
  assert.equal(quote.stale, true);
  assert.equal(quote.baselinePrice, null);
  assert.equal(quote.changePercent, null);
});

test('baseline changes initialize alert state; live tracking persists while demo tracking never does', async t => {
  const { service, socket } = await live(t);
  const persisted = [];
  service.on('config', config => persisted.push(config));
  await service.updateConfig({ baseline: 'tracking' });
  assert.equal(service.getState().config.watchlist[0].trackingPrice, 100);
  assert.equal(persisted.at(-1).watchlist[0].trackingPrice, 100);
  await service.updateConfig({ baseline: 'custom', watchlist: [{ ...single.watchlist[0], referencePrice: 50 }] });
  assert.equal(service.getState().quotes[0].changePercent, 100);
  assert.equal(service.getState().alerts.length, 0);
  await service.start('demo');
  await service.updateConfig({ baseline: 'tracking', watchlist: single.watchlist });
  assert.equal(service.getState().config.watchlist[0].trackingPrice, undefined);
  assert.equal(service.getState().quotes[0].baselinePrice, 50);
  assert.equal(service.getState().alerts.length, 0);
  assert.equal(socket.readyState, 3);
});

test('stop or mode switch aborts in-flight live results and prevents them contaminating demo', async t => {
  let finish;
  let started;
  const requested = new Promise(resolve => { started = resolve; });
  const fetchImpl = fixture({ onRequest: url => {
    if (url.includes('/prices?')) { started(); return new Promise(resolve => { finish = resolve; }); }
  } });
  const service = new MarketService({ config: single, credentialProvider: creds, fetchImpl, WebSocketImpl: FakeSocket, now: () => AT, sleepImpl: async () => {} });
  t.after(() => service.stop());
  const opening = service.start('live');
  await requested;
  await service.start('demo');
  const demoPrice = service.getState().quotes[0].price;
  finish(response({ result: [{ symbol: 'AAPL', lastPrice: '99999', currency: 'USD', timestamp: new Date(AT).toISOString() }] }));
  await opening;
  assert.equal(service.getState().mode, 'demo');
  assert.equal(service.getState().quotes[0].price, demoPrice);
});

test('revoked tokens stop monitoring without another token issue or automatic reconnect', async t => {
  let prices = 0;
  const fetchImpl = fixture({ onRequest: url => {
    if (url.includes('/prices?') && prices++ > 0) return response({ error: { code: 'token-revoked', message: 'do not show fixture-secret' } }, 401);
  } });
  const { service, socket } = await live(t, { fetchImpl });
  const halts=[]; service.on('halt', event=>halts.push(event));
  await service.refresh();
  assert.equal(service.running, false);
  assert.equal(service.reconnectTimer, null);
  assert.equal(socket.readyState, 3);
  assert.equal(service.getState().connection.state, 'error');
  assert.match(service.getState().connection.message, /다른 기기/);
  assert.equal(fetchImpl.calls.filter(call => call.url.endsWith('/oauth2/token')).length, 1);
  assert.deepEqual(halts,[{code:'token-revoked'}]);
});

test('one expired-token response is renewed once, concurrent requests share issuance', async () => {
  let rejected = false;
  const fetchImpl = fixture({ onRequest: url => {
    if (url.includes('/prices?') && !rejected) { rejected = true; return response({ error: { code: 'expired-token' } }, 401); }
  } });
  const client = new TossClient({ credentialProvider: creds, fetchImpl, now: () => AT, sleepImpl: async () => {} });
  await Promise.all([client.getToken(), client.getToken(), client.getToken()]);
  assert.equal(fetchImpl.calls.filter(call => call.url.endsWith('/oauth2/token')).length, 1);
  await client.prices(single.watchlist);
  assert.equal(fetchImpl.calls.filter(call => call.url.endsWith('/oauth2/token')).length, 2);
  client.abort();
});

test('429 requests honor Retry-After and stop retrying after two retries', async () => {
  const delays = [];
  const fetchImpl = fixture({ onRequest: url => url.includes('/prices?') ? response({ error: { code: 'rate-limit-exceeded' } }, 429, { 'Retry-After': '3' }) : null });
  const client = new TossClient({ credentialProvider: creds, fetchImpl, now: () => AT, sleepImpl: async ms => delays.push(ms) });
  await assert.rejects(client.prices(single.watchlist), { status: 429 });
  assert.equal(fetchImpl.calls.filter(call => call.url.includes('/prices?')).length, 3);
  assert.deepEqual(delays, [3000, 3000]);
  client.abort();
});

test('staggered expired responses for an old token do not revoke a token already renewed by a peer request', async () => {
  let issues = 0;
  let oldRequests = 0;
  let releaseStaggered;
  let reachedStaggered;
  const staggered = new Promise(resolve => { reachedStaggered = resolve; });
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/oauth2/token')) return response({ access_token: `token-${++issues}`, expires_in: 3600 });
    if (options.headers.Authorization === 'Bearer token-1') {
      oldRequests += 1;
      if (oldRequests === 2) {
        reachedStaggered();
        return new Promise(resolve => { releaseStaggered = resolve; });
      }
      return response({ error: { code: 'expired-token' } }, 401);
    }
    return response({ result: [] });
  };
  const client = new TossClient({ credentialProvider: creds, fetchImpl, now: () => AT, sleepImpl: async () => {} });
  await client.getToken();
  const first = client.prices(single.watchlist);
  const second = client.prices(single.watchlist);
  await staggered;
  await first;
  assert.equal(issues, 2);
  releaseStaggered(response({ error: { code: 'expired-token' } }, 401));
  await second;
  assert.equal(issues, 2);
  assert.equal(client.token, 'token-2');
  client.abort();
});

test('full catalog is searched and cached; missing credentials never produce simulated live prices', async t => {
  const { service, fetchImpl } = await live(t);
  assert.equal((await service.searchStocks('애플'))[0].symbol, 'AAPL');
  await service.searchStocks('삼성');
  assert.equal(fetchImpl.calls.filter(call => call.url.includes('/stocks/all?')).length, 7);
  const missing = new MarketService({ config: single });
  t.after(() => missing.stop());
  await missing.start('live');
  assert.equal(missing.getState().mode, 'live');
  assert.equal(missing.getState().connection.state, 'error');
  assert.equal(missing.getState().quotes[0].price, null);
});

test('source timestamps become stale without new trades even when repeated REST polls succeed', async t => {
  let now = AT;
  const { service } = await live(t, { now: () => now });
  assert.equal(service.getState().quotes[0].stale, false);
  now += 180000;
  await service.refresh();
  assert.equal(service.getState().quotes[0].stale, true);
  assert.equal(service.getState().quotes[0].updatedAt, AT);
});

test('a genuine fresh trade still crosses thresholds after a quiet period on a continuous connection', async t => {
  let now = AT;
  const { service, socket } = await live(t, { now: () => now });
  now += 180_000;
  socket.push({ type: 'message', topic: 'trade:us:AAPL', data: { price: '110', currency: 'USD', timestamp: new Date(now).toISOString() } });
  assert.equal(service.getState().quotes[0].stale, false);
  assert.equal(service.getState().alerts[0].level, 10);
  now += 1000;
  socket.push({ type: 'message', topic: 'trade:us:AAPL', data: { price: '115', currency: 'USD', timestamp: new Date(now).toISOString() } });
  assert.equal(service.getState().alerts[0].level, 15);
});

test('regular bulletins retain the last known prices and explicitly carry stale flags', async t => {
  const { service } = await live(t, { fetchImpl: fixture({ timestamp: new Date(AT - 180_000).toISOString() }) });
  const bulletins = [];
  service.on('bulletin', bulletin => bulletins.push(bulletin));
  service._emitBulletin();
  assert.equal(bulletins.length, 1);
  assert.equal(bulletins[0].quotes[0].price, 100);
  assert.equal(bulletins[0].quotes[0].stale, true);
});

test('late REST snapshot from an old watchlist cannot restore a removed stock', async t => {
  let delay = false;
  let resolvePrice;
  let requested;
  const pending = new Promise(resolve => { requested = resolve; });
  const fetchImpl = fixture({ onRequest: url => {
    if (url.includes('/prices?') && delay) { requested(); return new Promise(resolve => { resolvePrice = resolve; }); }
  } });
  const { service } = await live(t, { fetchImpl });
  delay = true;
  const refresh = service.refresh();
  await pending;
  await service.updateConfig({ watchlist: [] });
  resolvePrice(response({ result: [{ symbol: 'AAPL', lastPrice: '200', currency: 'USD', timestamp: new Date(AT).toISOString() }] }));
  await refresh;
  assert.equal(service.getState().quotes.length, 0);
  assert.equal(service.quotes.size, 0);
  assert.equal(service.getState().alerts.length, 0);
});

test('startup bulletin fires and changing interval resets its schedule', async t => {
  const service = new MarketService({ config: single, now: () => AT });
  t.after(() => service.stop());
  const bulletins = [];
  service.on('bulletin', bulletin => bulletins.push(bulletin));
  await service.start('demo');
  const prior = service.bulletinTimer;
  await service.updateConfig({ intervalMinutes: 1 });
  assert.equal(bulletins.length, 1);
  assert.equal(bulletins[0].quotes[0].symbol, 'AAPL');
  assert.notEqual(prior, service.bulletinTimer);
  assert.equal(service.bulletinTimer._idleTimeout, 60_000);
});

test('speech size saves without live reconnects, network refreshes, or threshold-state resets', async t => {
  const {service, socket, fetchImpl} = await live(t);
  const alerts = [], saved = [];
  service.on('alert', alert => alerts.push(alert));
  service.on('config', config => saved.push(config));
  const trade = (price, time) => socket.push({type: 'message', topic: 'trade:us:AAPL', data: {price: String(price), currency: 'USD', timestamp: new Date(AT + time).toISOString()}});
  trade(105, 1);
  assert.equal(alerts.length, 1);
  const before = service.getState();
  const samplesBefore = structuredClone(service.engine.samples);
  const epoch = service.epoch, revision = service.configRevision;
  const requestCount = fetchImpl.calls.length, subscriptionCount = socket.sent.length;
  await service.updateConfig({speechScale: 150});
  assert.equal(service.socket, socket);
  assert.equal(socket.readyState, 1);
  assert.equal(service.running, true);
  assert.equal(service.epoch, epoch);
  assert.equal(service.configRevision, revision);
  assert.equal(fetchImpl.calls.length, requestCount);
  assert.equal(socket.sent.length, subscriptionCount);
  assert.deepEqual(service.getState().connection, before.connection);
  assert.deepEqual(service.getState().quotes, before.quotes);
  assert.deepEqual(service.getState().alerts, before.alerts);
  assert.deepEqual(service.engine.samples, samplesBefore);
  assert.equal(saved.at(-1).speechScale, 150);
  assert.deepEqual(saved.at(-1).watchlist, before.config.watchlist);
  trade(106, 2);
  assert.equal(alerts.length, 1, 'staying above the same threshold must not alert after a visual change');
  trade(104, 3); trade(105, 4);
  assert.equal(alerts.length, 2, 'a fresh crossing still alerts after changing speech size');
});


test('switching every character keeps live subscriptions, portfolio, countdown, and threshold state intact', async t => {
  const fetchImpl = fixture({onRequest: url => {
    if (url.includes('/accounts?')) return response({result: [{accountSeq: 7, accountNo: '1234567890', accountType: 'BROKERAGE'}]});
    if (url.includes('/holdings?')) return response({result: {items: [{symbol: 'AAPL', name: '애플', marketCountry: 'US', currency: 'USD', quantity: '2.5', lastPrice: '100', averagePurchasePrice: '80'}]}});
  }});
  const {service, socket} = await live(t, {fetchImpl});
  const alerts = [], saved = [];
  service.on('alert', alert => alerts.push(alert)); service.on('config', config => saved.push(config));
  const trade = (price, time) => socket.push({type: 'message', topic: 'trade:us:AAPL', data: {price: String(price), currency: 'USD', timestamp: new Date(AT + time).toISOString()}});
  trade(105, 1);
  const before = structuredClone(service.getState());
  assert.equal(before.portfolio.selectedAccountId, 7);
  assert.equal(before.portfolio.holdings.items[0].quantity, 2.5);
  const samplesBefore = structuredClone(service.engine.samples);
  const epoch = service.epoch, revision = service.configRevision, portfolioRevision = service.portfolioRevision;
  const requestCount = fetchImpl.calls.length, subscriptionCount = socket.sent.length, bulletinTimer = service.bulletinTimer, portfolioTimer = service.portfolioTimer;
  for (const characterId of ['hachiware', 'usagi', 'chiikawa']) {
    const after = await service.updateConfig({characterId});
    assert.equal(after.config.characterId, characterId);
    assert.equal(service.socket, socket); assert.equal(socket.readyState, 1); assert.equal(service.running, true);
    assert.equal(service.epoch, epoch); assert.equal(service.configRevision, revision); assert.equal(service.portfolioRevision, portfolioRevision);
    assert.equal(service.bulletinTimer, bulletinTimer); assert.equal(service.portfolioTimer, portfolioTimer);
    assert.equal(fetchImpl.calls.length, requestCount); assert.equal(socket.sent.length, subscriptionCount);
    assert.deepEqual(after.connection, before.connection); assert.deepEqual(after.quotes, before.quotes); assert.deepEqual(after.alerts, before.alerts); assert.deepEqual(after.portfolio, before.portfolio);
    assert.deepEqual(service.engine.samples, samplesBefore);
    assert.deepEqual(after.config, {...before.config, characterId});
    assert.equal(saved.at(-1).characterId, characterId); assert.deepEqual(saved.at(-1).watchlist, before.config.watchlist);
  }
  trade(106, 2); assert.equal(alerts.length, 1, 'character changes must not rearm an already-crossed threshold');
  trade(104, 3); trade(105, 4); assert.equal(alerts.length, 2, 'fresh crossings continue after switching characters');
});

function multipleStocks(count) {
  return Array.from({ length: count }, (_, index) => ({ symbol: `TEST${index}`, name: `테스트 ${index}`, market: 'US' }));
}

function stockPrices({ unavailable = new Set(), status = 404, code = 'stock-not-found', timestamp = new Date(AT).toISOString() } = {}) {
  return fixture({ onRequest: url => {
    if (!url.includes('/prices?')) return;
    const symbols = new URL(url).searchParams.get('symbols').split(',');
    if (symbols.some(symbol => unavailable.has(symbol))) return response({ error: { code } }, status);
    return response({ result: symbols.map(symbol => ({ symbol, lastPrice: '100', currency: 'USD', timestamp })) });
  } });
}

for (const count of [2, 21, 100]) test(`${count} stocks isolate one unavailable quote and keep the remaining stocks connected without reconnecting`, async t => {
  const watchlist = multipleStocks(count), bad = watchlist[Math.min(19, count - 1)];
  const fetchImpl = stockPrices({ unavailable: new Set([bad.symbol]) });
  const { service, socket } = await live(t, { config: { watchlist }, fetchImpl });
  const halts = []; service.on('halt', event => halts.push(event));
  const state = service.getState();
  assert.equal(state.connection.state, 'connected');
  assert.equal(state.quotes.filter(quote => quote.price === 100).length, count - 1);
  const missing = state.quotes.find(quote => quote.symbol === bad.symbol);
  assert.equal(missing.price, null); assert.equal(missing.unavailable, true);
  assert.match(state.connection.message, new RegExp(bad.name));
  assert.ok(!JSON.parse(socket.sent[0]).flatMap(group => group.codes).includes(bad.symbol));
  assert.ok(!fetchImpl.calls.some(call => call.url.includes('/candles?') && new URL(call.url).searchParams.get('symbol') === bad.symbol));
  const priceCalls = () => fetchImpl.calls.filter(call => call.url.includes('/prices?'));
  assert.ok(priceCalls().every(call => new URL(call.url).searchParams.get('symbols').split(',').length <= 20));
  for (let poll = 0; poll < 3; poll += 1) {
    const before = priceCalls().length;
    await service.refresh();
    assert.equal(priceCalls().length - before, Math.ceil((count - 1) / 20), 'polls request only healthy chunks, without repeated bisection');
    assert.ok(priceCalls().slice(before).every(call => !new URL(call.url).searchParams.get('symbols').split(',').includes(bad.symbol)));
  }
  assert.equal(service.reconnectAttempt, 0); assert.equal(service.reconnectTimer, null);
  assert.deepEqual(halts, []);
  await service.updateConfig({ watchlist: watchlist.filter(stock => stock !== bad) });
  assert.equal(service.unavailable.size, 0);
  assert.ok(service.getState().quotes.every(quote => !quote.unavailable));
});

test('all unavailable stocks stay connected with empty prices and no repeated price requests until explicitly restarted', async t => {
  const fetchImpl = stockPrices({ unavailable: new Set(['AAPL']) });
  const { service } = await live(t, { fetchImpl });
  assert.equal(service.connection.state, 'connected');
  assert.equal(service.getState().quotes[0].unavailable, true);
  const count = fetchImpl.calls.filter(call => call.url.includes('/prices?')).length;
  await service.refresh();
  assert.equal(fetchImpl.calls.filter(call => call.url.includes('/prices?')).length, count);
  await service.start('live');
  assert.equal(fetchImpl.calls.filter(call => call.url.includes('/prices?')).length, count + 1);
});

for (const [status, code, terminal] of [[500, 'internal-error', false], [401, 'invalid-token', true], [403, 'forbidden', true], [429, 'rate-limit-exceeded', false]]) {
  test(`price ${status} errors retain ${terminal ? 'terminal' : 'reconnect'} behavior instead of being isolated as unavailable`, async t => {
    let failing = false;
    const fetchImpl = fixture({ onRequest: url => failing && url.includes('/prices?') ? response({ error: { code } }, status) : null });
    const { service, socket } = await live(t, { fetchImpl });
    const halts = []; service.on('halt', event => halts.push(event)); failing = true;
    await service.refresh();
    assert.equal(service.connection.state, 'error');
    assert.equal(service.unavailable.size, 0);
    assert.equal(socket.readyState, 3);
    assert.equal(service.running, !terminal);
    assert.equal(Boolean(service.reconnectTimer), !terminal);
    assert.deepEqual(halts, terminal ? [{ code }] : []);
  });
}

test('first live batch stores all twenty original registration prices in one config event', async t => {
  const watchlist = multipleStocks(20);
  const service = new MarketService({ config: { watchlist, baseline: 'previousClose' }, credentialProvider: creds, fetchImpl: stockPrices(), WebSocketImpl: FakeSocket, now: () => AT, sleepImpl: async () => {} });
  t.after(() => service.stop());
  const saved = []; service.on('config', config => saved.push(config));
  await service.start('live');
  assert.equal(saved.length, 1);
  assert.ok(saved[0].watchlist.every(stock => stock.trackingPrice === 100));
  await service.refresh();
  assert.equal(saved.length, 1);
});

test('new registration prices from a trade burst are persisted with the existing snapshot coalescing timer', async t => {
  const watchlist = multipleStocks(20);
  const { service, socket } = await live(t, { config: { watchlist }, fetchImpl: stockPrices({ timestamp: null }) });
  const saved = []; service.on('config', config => saved.push(config));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const [index, stock] of watchlist.entries()) socket.push({ type: 'message', topic: `trade:us:${stock.symbol}`, data: { price: String(100 + index), currency: 'USD', timestamp: new Date(AT + 1).toISOString() } });
  assert.equal(saved.length, 0);
  t.mock.timers.tick(120);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].watchlist.map(stock => stock.trackingPrice), watchlist.map((_, index) => 100 + index));
});

test('partial exchange catalog survives failure, shows progress, cools down typing and resumes only missing exchanges', async t => {
  let now = AT, fail = true;
  const fetchImpl = fixture({ onRequest: url => {
    if (!url.includes('/stocks/all?')) return;
    const exchange = new URL(url).searchParams.get('market');
    if (exchange === 'NYSE' && fail) return response({ error: { code: 'internal-error' } }, 500);
    return response({ result: [{ symbol: exchange === 'KOSPI' ? '000001' : exchange === 'KOSDAQ' ? '000002' : exchange === 'KR_ETC' ? '000003' : exchange, name: `${exchange} 고유 종목` }] });
  } });
  const { service } = await live(t, { fetchImpl, now: () => now });
  const progress = []; service.on('state', state => progress.push(state.catalogStatus));
  assert.equal((await service.searchStocks('000002'))[0].name, 'KOSDAQ 고유 종목');
  assert.equal(service.catalogStatus.state, 'partial');
  assert.equal(service.catalogStatus.completed, 2);
  assert.equal(service.catalogStatus.total, 7);
  assert.equal(service.catalogStatus.retryAt, AT + 60_000);
  assert.ok(progress.some(state => state.state === 'loading' && state.completed === 1));
  const calls = () => fetchImpl.calls.filter(call => call.url.includes('/stocks/all?'));
  assert.equal(calls().length, 3);
  await Promise.all(['삼', '삼성', '000', '고유', '나스닥'].map(query => service.searchStocks(query)));
  now += 59_999; await service.searchStocks('000002');
  assert.equal(calls().length, 3);
  now += 1; fail = false;
  await service.searchStocks('고유');
  assert.equal(calls().length, 8);
  assert.deepEqual(calls().slice(3).map(call => new URL(call.url).searchParams.get('market')), ['NYSE', 'NASDAQ', 'AMEX', 'KR_ETC', 'US_ETC']);
  assert.equal(service.catalogStatus.state, 'ready');
  assert.equal(service.catalogStatus.completed, 7);
  assert.equal(service.catalogAt, now);
});

test('concurrent catalog searches share one exchange-loading job', async t => {
  const { service, fetchImpl } = await live(t);
  await Promise.all(['애플', '삼성', 'AAPL', '005930'].map(query => service.searchStocks(query)));
  assert.equal(fetchImpl.calls.filter(call => call.url.includes('/stocks/all?')).length, 7);
  assert.equal(service.catalogStatus.state, 'ready');
});

test('WebSocket rate limits retry the declaration after one second without disconnecting and reset after success', async t => {
  const { service, socket } = await live(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const before = socket.sent.length;
  socket.push({ type: 'error', error: { code: 'rate-limit-exceeded' } });
  assert.equal(service.socket, socket); assert.equal(socket.readyState, 1);
  assert.equal(service.connection.state, 'connected'); assert.equal(service.reconnectTimer, null);
  t.mock.timers.tick(999); assert.equal(socket.sent.length, before);
  t.mock.timers.tick(1); assert.equal(socket.sent.length, before + 1);
  await tick();
  assert.equal(service.redeclarationFailures, 0);
  assert.equal(service.connection.state, 'connected');
});

test('three unsuccessful WebSocket redeclarations fall back to reconnect; server shutdown still reconnects immediately', async t => {
  const { service, socket } = await live(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  socket.send = text => socket.sent.push(text);
  const before = socket.sent.length;
  for (let retry = 0; retry < 3; retry += 1) {
    socket.push({ type: 'error', error: { code: 'rate-limit-exceeded' } });
    t.mock.timers.tick(1000);
    assert.equal(service.socket, socket);
  }
  assert.equal(socket.sent.length, before + 3);
  socket.push({ type: 'error', error: { code: 'rate-limit-exceeded' } });
  assert.equal(socket.readyState, 3); assert.ok(service.reconnectTimer);
  const second = await live(t);
  second.socket.push({ type: 'error', error: { code: 'server-shutdown' } });
  assert.equal(second.socket.readyState, 3); assert.ok(second.service.reconnectTimer);
});

test('rapid watchlist edits coalesce to one full subscription declaration after 300ms', async t => {
  const { service, socket } = await live(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const before = socket.sent.length;
  for (const count of [2, 3, 4]) await service.updateConfig({ watchlist: multipleStocks(count) });
  assert.equal(socket.sent.length, before);
  t.mock.timers.tick(299); assert.equal(socket.sent.length, before);
  t.mock.timers.tick(1); assert.equal(socket.sent.length, before + 1);
  assert.deepEqual(JSON.parse(socket.sent.at(-1)), [{ type: 'trade:us', codes: ['TEST0', 'TEST1', 'TEST2', 'TEST3'] }]);
  service.stop();
  t.mock.timers.tick(1000); assert.equal(socket.sent.length, before + 1);
});

test('forced authentication issuance uses its own 220ms rate gate and concurrent issuers still share a token', async () => {
  let now = AT; const issuedAt = [], waits = [];
  const fetchImpl = fixture({ onRequest: url => { if (url.endsWith('/oauth2/token')) issuedAt.push(now); } });
  const client = new TossClient({ credentialProvider: creds, fetchImpl, now: () => now, sleepImpl: async delay => { waits.push(delay); now += delay; } });
  await client.getToken();
  await Promise.all([client.getToken(true), client.getToken(true), client.getToken(true)]);
  await client.getToken(true);
  assert.deepEqual(issuedAt, [AT, AT + 220, AT + 440]);
  assert.deepEqual(waits, [220, 220]);
  client.abort();
});

test('price isolation keeps every recursive request within the existing 85ms market-data rate gate', async () => {
  let now = AT; const requestedAt = [];
  const fetchImpl = stockPrices({ unavailable: new Set(['TEST19']) });
  const client = new TossClient({ credentialProvider: creds, fetchImpl: async (url, options) => { if (url.includes('/prices?')) requestedAt.push(now); return fetchImpl(url, options); }, now: () => now, sleepImpl: async delay => { now += delay; } });
  const result = await client.prices(multipleStocks(21));
  assert.equal(result.items.length, 20);
  assert.equal(result.unavailable[0].symbol, 'TEST19');
  assert.ok(requestedAt.length > 2);
  assert.ok(requestedAt.slice(1).every((at, index) => at - requestedAt[index] >= 85));
  client.abort();
});
