import test from 'node:test';
import assert from 'node:assert/strict';
import { speechPlacement } from '../lib/speech-layout.js';
import { petBounds } from '../lib/pet-geometry.js';
import { normalizeConfig } from '../lib/config.js';

test('80/100/160 percent bubbles stay inside every monitor edge', () => {
  const viewport = {width: 800, height: 600};
  for (const scale of [.8, 1, 1.6]) for (const x of [0, 325, 650]) for (const y of [0, 225, 450]) {
    const pet = {x, y, size: 150}, bubble = {width: 244 * scale, height: 140 * scale};
    const result = speechPlacement({pet, viewport, bubble, gap: 16 * scale});
    assert.ok(x + result.left >= 12);
    assert.ok(x + result.left + bubble.width <= viewport.width - 12 + 1e-8);
    assert.ok(y + result.top >= 12);
    assert.ok(y + result.top + bubble.height <= viewport.height - 12 + 1e-8);
    assert.ok(result.tailLeft >= 20 && result.tailLeft <= bubble.width - 20);
  }
});

test('bubble uses measured height, flipping below when large text will not fit above', () => {
  const base = {pet: {x: 300, y: 190, size: 150}, viewport: {width: 1000, height: 800}};
  assert.equal(speechPlacement({...base, bubble: {width: 244, height: 130}}).side, 'above');
  const large = speechPlacement({...base, bubble: {width: 390.4, height: 240}});
  assert.equal(large.side, 'below');
  assert.equal(large.top, 166);
});

test('long speech fitted to a small viewport remains reachable without shifting the pet', () => {
  const pet = {x: 62, y: 65, size: 150}, original = {...pet};
  const bubble = {width: 296, height: 276};
  const result = speechPlacement({pet, viewport: {width: 320, height: 300}, bubble});
  assert.equal(pet.x + result.left, 12);
  assert.equal(pet.y + result.top, 12);
  assert.deepEqual(pet, original);
});

test('80, 290 and 300 pixel pets retain configured size and keep maximum speech inside small laptop viewports', () => {
  for (const size of [80, 290, 300]) {
    assert.equal(normalizeConfig({petSize: size}).petSize, size);
    for (const viewport of [{width: 800, height: 600}, {width: 1024, height: 640}]) {
      const bounds = petBounds(viewport, size), bubble = {width: 390.4, height: 240};
      for (const x of [bounds.left, bounds.right]) for (const y of [bounds.top, bounds.bottom]) {
        assert.ok(x >= 0 && x + size <= viewport.width);
        assert.ok(y >= 0 && y + size <= viewport.height);
        const placement = speechPlacement({pet: {x, y, size}, viewport, bubble, gap: 25.6});
        assert.ok(x + placement.left >= 12 && x + placement.left + bubble.width <= viewport.width - 12 + 1e-8);
        assert.ok(y + placement.top >= 12 && y + placement.top + bubble.height <= viewport.height - 12 + 1e-8);
      }
    }
  }
});
