import test from 'node:test';
import assert from 'node:assert/strict';
import {petBounds, clampPetPosition, displayForPoint, placementForCursor} from '../lib/pet-geometry.js';

const display = (id, x, y, width, height, scaleFactor = 1) => ({id, bounds: {x, y, width, height}, scaleFactor});

test('pet bounds reserve speech and edge margins with ordered limits', () => {
  assert.deepEqual(petBounds({width: 1920, height: 1080}, 150), {left: 62, right: 1708, top: 60, bottom: 918});
  assert.deepEqual(clampPetPosition({x: -50, y: 1000}, {width: 1920, height: 1080}, 150), {x: 62, y: 918});
  assert.deepEqual(clampPetPosition({x: 300.25, y: 125.5}, {width: 1920, height: 1080}, 150), {x: 300.25, y: 125.5});
});

test('horizontal displays select by global cursor and preserve local grab offset', () => {
  const primary = display(1, 0, 0, 1920, 1080);
  const right = display(2, 1920, 0, 2560, 1440);
  assert.equal(displayForPoint([primary, right], {x: 2400, y: 500}, primary.id), right);
  assert.deepEqual(placementForCursor({x: 2400, y: 500}, {x: 35, y: 50}, 150, right.bounds), {x: 445, y: 450});
});

test('left monitor with negative origin receives cursor without zero-origin bias', () => {
  const primary = display(1, 0, 0, 1920, 1080);
  const left = display(2, -1600, -100, 1600, 1000);
  assert.equal(displayForPoint([primary, left], {x: -1200, y: 250}, primary.id), left);
  assert.deepEqual(placementForCursor({x: -1200, y: 250}, {x: 40, y: 30}, 150, left.bounds), {x: 360, y: 320});
});

test('above monitor with negative y origin receives cursor and preserves fractional DIP', () => {
  const primary = display(1, 0, 0, 1920, 1080);
  const above = display(2, 240, -1200, 1600, 1200);
  assert.equal(displayForPoint([primary, above], {x: 800.5, y: -750.25}, primary.id), above);
  assert.deepEqual(placementForCursor({x: 800.5, y: -750.25}, {x: 20.25, y: 30.5}, 150, above.bounds), {x: 540.25, y: 419.25});
});

test('mixed display scale factors never multiply device-independent coordinates', () => {
  const retina = display(1, -1728, 0, 1728, 1117, 2);
  const external = display(2, 0, 0, 2560, 1440, 1.25);
  const cursor = {x: 400.5, y: 500.25};
  assert.equal(displayForPoint([retina, external], cursor, retina.id), external);
  assert.deepEqual(placementForCursor(cursor, {x: 41.25, y: 60.5}, 150, external.bounds), {x: 359.25, y: 439.75});
  assert.equal(displayForPoint([retina, external], {x: -800, y: 400}, external.id), retina);
  assert.deepEqual(placementForCursor({x: -800, y: 400}, {x: 20, y: 30}, 150, retina.bounds), {x: 908, y: 370});
});

test('gaps use nearest rectangle and the fallback monitor only breaks equal distances', () => {
  const left = display(1, 0, 0, 1000, 800);
  const right = display(2, 1200, 0, 1000, 800);
  assert.equal(displayForPoint([left, right], {x: 1050, y: 400}, right.id), left);
  assert.equal(displayForPoint([left, right], {x: 1150, y: 400}, left.id), right);
  assert.equal(displayForPoint([left, right], {x: 1100, y: 400}, right.id), right);
  assert.equal(displayForPoint([right, left], {x: 1100, y: 400}, left.id), left);
  assert.equal(displayForPoint([left, right], {x: 1100, y: 400}, 99), left);
  assert.equal(displayForPoint([left, right], {x: 1050, y: 900}, right.id), left);
});

test('nearest display is based on its rectangle rather than its center', () => {
  const tall = display('tall', 0, 0, 300, 2000);
  const short = display('short', 600, 200, 300, 300);
  assert.equal(displayForPoint([tall, short], {x: 350, y: 300}, short.id), tall);
});

test('tiny viewports keep bounds ordered and placement anchored safely', () => {
  assert.deepEqual(petBounds({width: 100, height: 90}, 150), {left: 0, right: 0, top: 0, bottom: 0});
  assert.deepEqual(clampPetPosition({x: 1000, y: -1000}, {width: 100, height: 90}, 150), {x: 0, y: 0});
  assert.deepEqual(petBounds({width: 200, height: 180}, 150), {left: 25, right: 25, top: 30, bottom: 30});
  assert.deepEqual(placementForCursor({x: -200, y: -100}, {x: 75, y: 75}, 150, {x: -300, y: -200, width: 100, height: 90}), {x: 0, y: 0});
});

test('shared monitor boundaries use half-open bounds, including negative origins', () => {
  const left = display('left', -1000, 0, 1000, 800);
  const right = display('right', 0, 0, 1000, 800);
  const above = display('above', 0, -800, 1000, 800);
  assert.equal(displayForPoint([left, right, above], {x: 0, y: 200}, left.id), right);
  assert.equal(displayForPoint([above, right, left], {x: 200, y: 0}, above.id), right);
  assert.equal(displayForPoint([left, right, above], {x: -1000, y: 0}, right.id), left);
  assert.equal(displayForPoint([left, right, above], {x: 0, y: -800}, right.id), above);
  assert.equal(displayForPoint([left, right, above], {x: 1000, y: 200}, left.id), right);
});

test('placement clamps to monitor margins at exact and beyond-screen boundaries', () => {
  const viewport = {x: -1920, y: -1080, width: 1920, height: 1080};
  assert.deepEqual(placementForCursor({x: -1920, y: -1080}, {x: 40, y: 30}, 150, viewport), {x: 62, y: 60});
  assert.deepEqual(placementForCursor({x: 50, y: 100}, {x: 40, y: 30}, 150, viewport), {x: 1708, y: 918});
  assert.deepEqual(clampPetPosition({x: 62, y: 60}, viewport, 150), {x: 62, y: 60});
  assert.deepEqual(clampPetPosition({x: 1708, y: 918}, viewport, 150), {x: 1708, y: 918});
});

test('empty monitor inventory returns null without mutating inputs', () => {
  assert.equal(displayForPoint([], {x: 0, y: 0}, 1), null);
  const viewport = Object.freeze({x: -1920, y: 0, width: 1920, height: 1080});
  const cursor = Object.freeze({x: -1000, y: 400});
  const offset = Object.freeze({x: 30, y: 40});
  assert.deepEqual(placementForCursor(cursor, offset, 150, viewport), {x: 890, y: 360});
});
