import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultConfig, normalizeConfig} from '../lib/config.js';

test('new and legacy settings leave companion mode off without resetting preferences', () => {
  assert.equal(defaultConfig().companionMode, false);
  const legacy = {...defaultConfig(), roaming: false, petSize: 210, speechScale: 130, characterId: 'usagi', intervalMinutes: 17, watchlist: [{symbol: 'AAPL', name: '애플', market: 'US', purchasePrice: 201.25}]};
  delete legacy.companionMode;
  const migrated = normalizeConfig({}, legacy);
  assert.equal(migrated.companionMode, false);
  const {companionMode, ...preferences} = migrated;
  assert.deepEqual(preferences, legacy);
  assert.equal(Object.hasOwn(legacy, 'companionMode'), false);
});

test('toggling companion mode preserves roaming and stock preferences through a saved restart', () => {
  const original = normalizeConfig({roaming: false, baseline: 'purchase', autoWatchHoldings: false, characterId: 'hachiware', watchlist: [{symbol: '005930', name: '삼성전자', market: 'KR', purchasePrice: 70000, trackingPrice: 71000}]});
  const walking = normalizeConfig({companionMode: true}, original);
  assert.equal(walking.companionMode, true);
  assert.equal(original.companionMode, false);
  assert.deepEqual(walking, {...original, companionMode: true});
  const restored = normalizeConfig(JSON.parse(JSON.stringify(walking)));
  assert.deepEqual(restored, walking);
  assert.deepEqual(normalizeConfig({companionMode: false}, restored), original);
});

test('companion mode only accepts explicit booleans at the configuration boundary', () => {
  for (const value of [undefined, null, 0, 1, '', 'false', 'true', [], {}, new Boolean(true)]) {
    assert.throws(() => normalizeConfig({companionMode: value}), /산책 모드/);
  }
  assert.equal(normalizeConfig({companionMode: true}).companionMode, true);
  assert.equal(normalizeConfig({companionMode: false}).companionMode, false);
  assert.throws(() => normalizeConfig({companionMode: true, mode: 'companion'}), /알 수 없는/);
});
