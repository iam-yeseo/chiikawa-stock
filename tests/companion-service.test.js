import test from 'node:test';
import assert from 'node:assert/strict';
import { MarketService } from '../lib/market-service.js';

test('saved companion mode never opens credentials or market traffic on startup', async t => {
  let reads = 0, requests = 0;
  const service = new MarketService({ config: { companionMode: true },
    credentialProvider: async () => { reads++; throw new Error('unexpected vault read'); },
    fetchImpl: async () => { requests++; throw new Error('unexpected market request'); } });
  t.after(() => service.stop());
  for (const mode of ['live', 'demo']) {
    await service.start(mode);
    assert.equal(service.running, false);
    assert.equal(service.getState().mode, 'offline');
    assert.equal(service.getState().portfolio.holdings, null);
    assert.equal(service.bulletinTimer, null);
    assert.equal(service.demoTimer, null);
  }
  assert.equal(reads, 0);
  assert.equal(requests, 0);
});

test('enabling companion mode clears monitoring timers and synthetic holdings; disabling can resume', async t => {
  const service = new MarketService({ config: { roaming: false } });
  t.after(() => service.stop());
  await service.start('demo');
  assert.equal(service.running, true);
  assert.equal(service.getState().mode, 'demo');
  await service.updateConfig({ companionMode: true });
  assert.equal(service.running, false);
  assert.equal(service.getState().mode, 'offline');
  assert.equal(service.getState().portfolio.holdings, null);
  assert.equal(service.config.roaming, false);
  assert.equal(service.demoAddedKeys.size, 0);
  assert.equal(service.demoTimer, null);
  assert.equal(service.portfolioTimer, null);
  assert.equal(service.bulletinTimer, null);
  const bulletins = [];
  service.on('bulletin', value => bulletins.push(value));
  await service.updateConfig({ intervalMinutes: 0.1, characterId: 'usagi' });
  service._emitBulletin();
  assert.deepEqual(bulletins, []);
  assert.equal(service.bulletinTimer, null);
  await service.updateConfig({ companionMode: false });
  await service.start('demo');
  assert.equal(service.running, true);
  assert.equal(service.getState().mode, 'demo');
  assert.ok(service.getState().quotes.some(quote => quote.price !== null));
  assert.equal(service.config.characterId, 'usagi');
  assert.equal(service.config.roaming, false);
});

test('enabling companion mode invalidates a still-pending live startup immediately', async t => {
  let releasePortfolio, portfolioEntered;
  const entered = new Promise(resolve => { portfolioEntered = resolve; });
  const pendingPortfolio = new Promise(resolve => { releasePortfolio = resolve; });
  const service = new MarketService();
  t.after(() => service.stop());
  service.refreshPortfolio = async () => { portfolioEntered(); await pendingPortfolio; };
  const starting = service.start('live');
  await entered;
  const startupEpoch = service.epoch;
  await service.updateConfig({ companionMode: true });
  assert.equal(service.running, false, 'stopping does not wait for the old request to finish');
  assert.ok(service.epoch > startupEpoch);
  assert.equal(service.client, null);
  releasePortfolio();
  await starting;
  assert.equal(service.getState().mode, 'offline');
  assert.equal(service.running, false, 'late startup completion cannot resume monitoring');
});

test('companion mode closes a retained client after reconnect exhaustion and searches locally', async t => {
  let requests = 0, aborts = 0;
  const service = new MarketService();
  t.after(() => service.stop());
  service.mode = 'live'; service.running = true; service.reconnectAttempt = 8;
  service.client = { abort() { aborts++; }, async stocks() { requests++; return []; } };
  service._scheduleReconnect();
  assert.equal(service.running, false);
  await service.updateConfig({ companionMode: true });
  await service.searchStocks('삼성');
  assert.equal(service.getState().mode, 'offline');
  assert.equal(service.client, null);
  assert.equal(aborts, 1);
  assert.equal(requests, 0);
});
