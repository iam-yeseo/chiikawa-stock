import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defaultConfig, normalizeConfig } from '../lib/config.js';
import { readConfig, atomicWrite } from '../electron/storage.js';
import { CHARACTER_CATALOG } from '../lib/characters.js';
import { MarketService } from '../lib/market-service.js';

test('0.1 settings migrate to Chiikawa without losing custom stocks or preferences', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chii-migration-'));
  const previous = {
    intervalMinutes: 11, baseline: 'purchase', roaming: false, petSize: 180,
    watchlist: [{symbol: 'AAPL', name: '애플', market: 'US', purchasePrice: 172.5}],
  };
  try {
    await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify(previous));
    const migrated = await readConfig(directory, defaultConfig, normalizeConfig);
    assert.deepEqual(migrated, {...previous, characterId: 'chiikawa', speechScale: 100, autoWatchHoldings: true, companionMode: false});
  } finally { await fs.rm(directory, {recursive: true, force: true}); }
});

test('all three shipped characters can be selected and unknown character IDs are rejected', () => {
  assert.deepEqual(CHARACTER_CATALOG.filter(item => item.available).map(item => item.id), ['chiikawa', 'hachiware', 'usagi']);
  for (const characterId of ['chiikawa', 'hachiware', 'usagi']) assert.equal(normalizeConfig({characterId}).characterId, characterId);
  for (const characterId of ['unknown', '../other', '', null, 0]) assert.throws(() => normalizeConfig({characterId}), /캐릭터/);
});

test('character utterances preserve limited vocabulary while Hachiware uses short conversational Korean', () => {
  const profiles=Object.fromEntries(CHARACTER_CATALOG.map(profile=>[profile.id,profile]));
  for(const line of Object.values(profiles.chiikawa.speech)){
    assert.match(line,/^[응와아흐으앙에…!?.\s]+$/u);
    assert.ok(line.length<=12);
  }
  for(const line of Object.values(profiles.usagi.speech)){
    assert.match(line,/^[우냐라야하…!?.\s]+$/u);
    assert.ok(line.length<=12);
  }
  assert.match(profiles.hachiware.speech.talk,/있잖아/);
  assert.match(profiles.hachiware.speech.rise,/말이야/);
  assert.match(profiles.hachiware.speech.fall,/확인해 볼까/);
  for(const profile of CHARACTER_CATALOG) for(const line of Object.values(profile.speech)){
    assert.doesNotMatch(line,/매수|매도|사야|팔아|오를 거|오를거|회복할|반등할|보장/);
  }
});

test('0.3 settings round-trip every new friend without changing stocks, preferences, or credential files', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chii-friends-migration-'));
  const prior = normalizeConfig({
    intervalMinutes: 3.5, baseline: 'purchase', roaming: false, petSize: 170, speechScale: 140, autoWatchHoldings: false,
    watchlist: [{symbol: 'AAPL', name: '내 애플', market: 'US', purchasePrice: 172.5, referencePrice: 180, trackingPrice: 165}],
  });
  const credentialFixture = Buffer.from('fixture-only-040-encrypted-credentials');
  try {
    await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify(prior));
    await fs.writeFile(path.join(directory, 'credentials.enc'), credentialFixture);
    assert.deepEqual(await readConfig(directory, defaultConfig, normalizeConfig), prior);
    for (const characterId of ['hachiware', 'usagi', 'chiikawa']) {
      const saved = normalizeConfig({characterId}, await readConfig(directory, defaultConfig, normalizeConfig));
      await atomicWrite(path.join(directory, 'settings.json'), JSON.stringify(saved));
      assert.deepEqual(await readConfig(directory, defaultConfig, normalizeConfig), {...prior, characterId});
      assert.deepEqual(await fs.readFile(path.join(directory, 'credentials.enc')), credentialFixture);
    }
  } finally {await fs.rm(directory, {recursive: true, force: true});}
});

test('appearance updates preserve the market service connection and alert history', async () => {
  const service = new MarketService({config: defaultConfig(), credentialProvider: async () => null});
  try {
    await service.start('demo');
    const epoch = service.epoch;
    const before = service.getState();
    await service.updateConfig({characterId: 'hachiware', petSize: 175, speechScale: 130});
    assert.equal(service.epoch, epoch);
    assert.equal(service.running, true);
    assert.deepEqual(service.getState().alerts, before.alerts);
    assert.equal(service.getState().quotes.length, before.quotes.length);
    assert.equal(service.getState().config.speechScale, 130);
    assert.equal(service.getState().config.characterId, 'hachiware');
    assert.deepEqual(service.getState().portfolio, before.portfolio);
  } finally { service.stop(); }
});

test('0.2.1 settings gain default speech scale and retain it after saving and reloading', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chii-speech-migration-'));
  const previous = {
    intervalMinutes: 7.5, baseline: 'custom', roaming: false, petSize: 180, characterId: 'chiikawa',
    watchlist: [{symbol: '005930', name: '삼성전자', market: 'KR', purchasePrice: 71000, referencePrice: 70000, trackingPrice: 72000}],
  };
  const credentialFixture = Buffer.from('fixture-only-encrypted-credential-marker');
  try {
    await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify(previous));
    await fs.writeFile(path.join(directory, 'credentials.enc'), credentialFixture);
    const migrated = await readConfig(directory, defaultConfig, normalizeConfig);
    assert.deepEqual(migrated, {...previous, speechScale: 100, autoWatchHoldings: true, companionMode: false});
    const saved = normalizeConfig({speechScale: 140}, migrated);
    await atomicWrite(path.join(directory, 'settings.json'), JSON.stringify(saved));
    assert.deepEqual(await readConfig(directory, defaultConfig, normalizeConfig), {...previous, speechScale: 140, autoWatchHoldings: true, companionMode: false});
    assert.deepEqual(await fs.readFile(path.join(directory, 'credentials.enc')), credentialFixture);
  } finally {await fs.rm(directory, {recursive: true, force: true});}
});
