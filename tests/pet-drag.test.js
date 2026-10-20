import test from 'node:test';
import assert from 'node:assert/strict';
import { PetDragController } from '../electron/pet-drag.js';

const grab = (sessionId = 1) => ({ sessionId, size: 150, offset: { x: 75, y: 70 } });

function harness(options = {}) {
  let clock = 1000, nextTimer = 0;
  const timers = new Map();
  const state = {
    cursor: { x: 600, y: 400 },
    displays: [
      { id: 11, scaleFactor: 2, bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 850 } },
      { id: 22, scaleFactor: 1, bounds: { x: -1920, y: -240, width: 1920, height: 1080 }, workArea: { x: -1920, y: -215, width: 1920, height: 1030 } },
    ],
    contentOffset: { x: 0, y: 0 },
    boundsCalls: [], ignoreCalls: [], messages: [], ended: [], eventOrder: [], displayChanges: [],
    destroyed: false, visible: true, sendError: null, boundsError: null,
    timers,
  };
  let bounds = { ...state.displays[0].workArea };
  const window = {
    isDestroyed: () => state.destroyed,
    isVisible: () => state.visible,
    getBounds: () => ({ ...bounds }),
    getContentBounds: () => {
      if (state.boundsError) throw state.boundsError;
      return { ...bounds, x: bounds.x + state.contentOffset.x, y: bounds.y + state.contentOffset.y };
    },
    setBounds(value, animate) { bounds = { ...value }; state.boundsCalls.push({ bounds: { ...value }, animate }); },
    setIgnoreMouseEvents(ignore, details) { state.ignoreCalls.push({ ignore, ...details }); state.eventOrder.push(`ignore:${ignore}`); },
    webContents: {
      send(channel, payload) {
        if (state.sendError) throw state.sendError;
        state.eventOrder.push(channel);
        const message = { channel, ...structuredClone(payload) };
        if (channel === 'chii:pet-drag-ended') state.ended.push(message);
        else state.messages.push(message);
      },
    },
  };
  state.window = window;
  state.controller = new PetDragController({
    screen: { getCursorScreenPoint: () => ({ ...state.cursor }), getAllDisplays: () => state.displays },
    getWindow: () => state.window,
    onDisplayChange: id => state.displayChanges.push(id),
    now: () => clock,
    schedule: (callback, interval) => { assert.equal(interval, 16); const id = ++nextTimer; timers.set(id, callback); return id; },
    unschedule: id => timers.delete(id),
    ...options,
  });
  state.tick = (elapsed = 16) => { clock += elapsed; for (const callback of [...timers.values()]) callback(); };
  state.lastMessage = () => state.messages.at(-1);
  return state;
}

test('drag crosses monitors without resizing on every sample and follows changed work areas', () => {
  const h = harness();
  assert.equal(h.controller.begin(grab()), true);
  assert.equal(h.boundsCalls.length, 0);
  assert.deepEqual(h.displayChanges, [11]);
  h.cursor = { x: 700, y: 450 }; h.tick();
  assert.equal(h.boundsCalls.length, 0);
  h.cursor = { x: -800, y: 100 }; h.tick();
  assert.deepEqual(h.boundsCalls, [{ bounds: h.displays[1].workArea, animate: false }]);
  assert.deepEqual(h.displayChanges, [11, 22]);
  h.tick();
  assert.equal(h.boundsCalls.length, 1);
  h.displays[1].workArea = { ...h.displays[1].workArea, height: 1000 };
  h.tick();
  assert.equal(h.boundsCalls.length, 2);
  assert.deepEqual(h.displayChanges, [11, 22]);
  assert.equal(h.lastMessage().viewport.height, 1000);
  assert.ok(h.messages.every(message => message.channel === 'chii:pet-placement'));
  assert.deepEqual(h.messages.map(message => message.sequence), [1, 2, 3, 4, 5]);
  h.controller.end();
});

test('placement uses actual content origin and global DIP without multiplying mixed display scales', () => {
  const h = harness();
  h.contentOffset = { x: 7, y: 5 };
  h.controller.begin(grab());
  assert.deepEqual({ x: h.lastMessage().x, y: h.lastMessage().y }, { x: 518, y: 300 });
  h.cursor = { x: -800, y: 100 }; h.tick();
  assert.deepEqual({ x: h.lastMessage().x, y: h.lastMessage().y }, { x: 1038, y: 240 });
  assert.deepEqual(h.lastMessage().cursor, { x: 1113, y: 310 });
  assert.equal(h.lastMessage().displayId, 22);
  h.controller.end();
});

test('native mouse-down coordinates determine the initial display even if the sampled cursor is elsewhere', () => {
  const h = harness();
  assert.equal(h.controller.begin(grab(), { x: -800, y: 100 }), true);
  assert.deepEqual(h.cursor, { x: 600, y: 400 });
  assert.equal(h.lastMessage().displayId, 22);
  assert.deepEqual({ x: h.lastMessage().x, y: h.lastMessage().y }, { x: 1045, y: 245 });
  assert.deepEqual(h.displayChanges, [22]);
  h.controller.end();
});

test('native move and final release coordinates take precedence over a different sampled cursor', () => {
  const h = harness();
  h.controller.begin(grab());
  h.controller.update(false, '', { x: -900, y: 180 });
  assert.equal(h.lastMessage().displayId, 22);
  assert.deepEqual({ x: h.lastMessage().x, y: h.lastMessage().y }, { x: 945, y: 325 });
  h.controller.end(1, 'released', { x: -600, y: 220 });
  const final = h.lastMessage();
  assert.equal(final.displayId, 22);
  assert.deepEqual({ x: final.x, y: final.y }, { x: 1245, y: 365 });
  assert.deepEqual(final.cursor, { x: 1320, y: 435 });
  assert.equal(final.dragging, false);
  assert.equal(final.reason, 'released');
  assert.equal(h.controller.active, false);
  assert.equal(h.timers.size, 0);
  assert.equal(h.ignoreCalls.at(-1).ignore, true);
  const count = h.messages.length;
  h.tick();
  assert.equal(h.messages.length, count, 'a later cursor poll cannot overwrite the final native point');
});

test('unavailable or invalid native coordinates fall back to the sampled DIP cursor', () => {
  const h = harness();
  h.controller.begin(grab(), { x: NaN, y: 100 });
  assert.equal(h.lastMessage().displayId, 11);
  h.cursor = { x: -800, y: 100 };
  h.controller.update(false, '', { x: -600, y: Infinity });
  assert.deepEqual({ x: h.lastMessage().x, y: h.lastMessage().y }, { x: 1045, y: 245 });
  h.controller.end(1, 'released', null);
  assert.equal(h.lastMessage().displayId, 22);
  assert.equal(h.lastMessage().dragging, false);
});

test('replacing a drag retires its timer and a delayed old release cannot end the new session', () => {
  const h = harness();
  h.controller.begin(grab(10));
  h.controller.begin(grab(20));
  assert.equal(h.timers.size, 1);
  const oldFinal = h.messages.find(message => message.sessionId === 10 && !message.dragging);
  assert.equal(oldFinal.reason, 'replaced');
  assert.equal(h.lastMessage().sessionId, 20);
  assert.equal(h.lastMessage().sequence, 1);
  const count = h.messages.length, ignores = h.ignoreCalls.length;
  h.controller.end(10);
  assert.equal(h.controller.active, true);
  assert.equal(h.messages.length, count);
  assert.equal(h.ignoreCalls.length, ignores);
  h.controller.end(20);
  assert.equal(h.timers.size, 0);
});

test('invalid drag inputs do not acquire the mouse or interrupt a valid session', () => {
  const h = harness();
  h.controller.begin(grab(4));
  const invalid = [null, {}, { ...grab(), sessionId: 0 }, { ...grab(), sessionId: 1.5 },
    { ...grab(), sessionId: Number.MAX_SAFE_INTEGER + 1 }, { ...grab(), size: 79 },
    { ...grab(), size: 301 }, { ...grab(), size: NaN }, { ...grab(), size: '150' },
    { ...grab(), offset: null }, { ...grab(), offset: { x: Infinity, y: 0 } },
    { ...grab(), offset: { x: 0, y: NaN } }, { ...grab(), offset: { x: 301, y: 0 } },
    { ...grab(), offset: { x: 0, y: -301 } }];
  const count = h.messages.length, ignores = h.ignoreCalls.length;
  for (const input of invalid) assert.equal(h.controller.begin(input), false);
  assert.equal(h.controller.active, true);
  assert.equal(h.lastMessage().sessionId, 4);
  assert.equal(h.messages.length, count);
  assert.equal(h.ignoreCalls.length, ignores);
  assert.equal(h.timers.size, 1);
  h.controller.end();
});

test('all configured size endpoints permit dragging across displays without changing the grab offset', () => {
  for (const size of [80, 290, 300]) {
    const h = harness(), offset = {x: size / 2, y: size / 2};
    assert.equal(h.controller.begin({sessionId: 1, size, offset}), true);
    h.controller.end(1, 'released', {x: -800, y: 200});
    const final = h.lastMessage();
    assert.equal(final.displayId, 22);
    assert.deepEqual({x: final.x, y: final.y}, {x: 1120 - offset.x, y: 415 - offset.y});
    assert.equal(h.controller.active, false);
  }
});

test('missing, destroyed, and hidden windows reject drag acquisition', () => {
  for (const condition of ['missing', 'destroyed', 'hidden']) {
    const h = harness();
    if (condition === 'missing') h.window = null;
    if (condition === 'destroyed') h.destroyed = true;
    if (condition === 'hidden') h.visible = false;
    assert.equal(h.controller.begin(grab()), false, condition);
    assert.equal(h.controller.active, false);
    assert.equal(h.timers.size, 0);
    assert.equal(h.ignoreCalls.length, 0);
  }
});

test('native mouse-up finalizes the latest cursor location and restores click-through once', () => {
  const h = harness();
  h.controller.begin(grab());
  h.cursor = { x: -800, y: 100 }; // Release can arrive before the next polling tick.
  h.controller.end(undefined, 'released');
  const final = h.lastMessage();
  assert.equal(final.dragging, false);
  assert.equal(final.reason, 'released');
  assert.equal(final.displayId, 22);
  assert.deepEqual({ x: final.x, y: final.y }, { x: 1045, y: 245 });
  assert.deepEqual(h.ignoreCalls, [{ ignore: false, forward: true }, { ignore: true, forward: true }]);
  assert.equal(h.controller.active, false);
  assert.equal(h.timers.size, 0);
  const count = h.messages.length;
  h.controller.end(1); h.tick();
  assert.equal(h.messages.length, count);
  assert.equal(h.ignoreCalls.length, 2);
});

test('watchdog releases a stuck drag at its deadline and stops polling', () => {
  const h = harness({ timeoutMs: 32 });
  h.controller.begin(grab());
  h.tick(31);
  assert.equal(h.controller.active, true);
  h.tick(1);
  assert.equal(h.lastMessage().reason, 'timeout');
  assert.equal(h.lastMessage().dragging, false);
  assert.equal(h.controller.active, false);
  assert.equal(h.ignoreCalls.at(-1).ignore, true);
  assert.equal(h.timers.size, 0);
  const count = h.messages.length;
  h.tick(1000);
  assert.equal(h.messages.length, count);
});

test('a disappearing or destroyed window cancels polling without sending to a dead renderer', () => {
  for (const condition of ['missing', 'destroyed']) {
    const h = harness();
    h.controller.begin(grab());
    if (condition === 'missing') h.window = null;
    else h.destroyed = true;
    const count = h.messages.length;
    assert.doesNotThrow(() => h.tick());
    assert.equal(h.controller.active, false, condition);
    assert.equal(h.timers.size, 0);
    assert.equal(h.messages.length, count);
  }
});

test('loss of all displays cancels polling and restores click-through on the surviving window', () => {
  const h = harness();
  h.controller.begin(grab());
  h.displays = [];
  h.tick();
  assert.equal(h.controller.active, false);
  assert.equal(h.timers.size, 0);
  assert.equal(h.ignoreCalls.at(-1).ignore, true);
  assert.equal(h.ended.at(-1).reason, 'no-displays');
  assert.equal(h.ended.at(-1).sessionId, 1);
});

test('renderer failure while finishing cannot leave the drag timer and mouse capture active', () => {
  const h = harness();
  h.controller.begin(grab());
  h.sendError = new Error('WebContents destroyed');
  assert.doesNotThrow(() => h.controller.end(undefined, 'renderer-gone'));
  assert.equal(h.controller.active, false);
  assert.equal(h.timers.size, 0);
  assert.equal(h.ignoreCalls.at(-1).ignore, true);
});

test('renderer failure during acquisition or polling releases the mouse without an uncaught timer error', () => {
  for (const phase of ['begin', 'poll']) {
    const h = harness();
    if (phase === 'poll') h.controller.begin(grab());
    h.sendError = new Error('Renderer exited');
    if (phase === 'begin') assert.equal(h.controller.begin(grab()), false);
    else assert.doesNotThrow(() => h.tick());
    assert.equal(h.controller.active, false, phase);
    assert.equal(h.timers.size, 0);
    assert.equal(h.ignoreCalls.at(-1).ignore, true);
  }
});

test('geometry failure tells the surviving renderer to leave drag mode after releasing the native latch', () => {
  const h = harness();
  h.controller.begin(grab(5));
  h.boundsError = new Error('Display is changing');
  h.tick();
  assert.equal(h.controller.active, false);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.ended, [{ channel: 'chii:pet-drag-ended', sessionId: 5, reason: 'error' }]);
  assert.deepEqual(h.eventOrder.slice(-2), ['ignore:true', 'chii:pet-drag-ended']);
  h.boundsError = null;
  assert.equal(h.controller.begin(grab(6)), true, 'a fresh drag works after the transient failure');
  h.controller.end(5);
  assert.equal(h.controller.active, true);
  h.controller.end(6);
  assert.equal(h.ended.filter(event => event.sessionId === 6).length, 1);
});

test('hidden-window rejection and cancellation notify renderer even without a final placement', () => {
  const h = harness();
  h.visible = false;
  assert.equal(h.controller.begin(grab(1)), false);
  assert.deepEqual(h.ended, [{ channel: 'chii:pet-drag-ended', sessionId: 1, reason: 'unavailable' }]);
  assert.equal(h.messages.length, 0);
  h.visible = true;
  h.controller.begin(grab(2));
  const placements = h.messages.length;
  h.visible = false;
  h.tick();
  assert.equal(h.messages.length, placements);
  assert.equal(h.ended.at(-1).sessionId, 2);
  assert.equal(h.ended.at(-1).reason, 'hidden');
  assert.equal(h.ignoreCalls.at(-1).ignore, true);
  assert.equal(h.timers.size, 0);
});

test('Windows-style 125%, 150%, and 200% arrangement preserves DIP offsets across right and upper monitors', () => {
  const h = harness();
  h.displays = [
    { id: 101, scaleFactor: 1.25, bounds: { x: 0, y: 0, width: 1536, height: 864 }, workArea: { x: 0, y: 0, width: 1536, height: 824 } },
    { id: 102, scaleFactor: 1.5, bounds: { x: 1536, y: -200, width: 1707, height: 960 }, workArea: { x: 1536, y: -200, width: 1707, height: 920 } },
    { id: 103, scaleFactor: 2, bounds: { x: -100, y: -1100, width: 1440, height: 900 }, workArea: { x: -100, y: -1100, width: 1440, height: 860 } },
  ];
  h.controller.begin(grab(), { x: 800, y: 500 });
  assert.deepEqual({ x: h.lastMessage().x, y: h.lastMessage().y }, { x: 725, y: 430 });
  h.controller.update(false, '', { x: 2100, y: 250 });
  assert.deepEqual({ x: h.lastMessage().x, y: h.lastMessage().y }, { x: 489, y: 380 });
  h.controller.end(1, 'released', { x: 600, y: -800 });
  assert.deepEqual({ x: h.lastMessage().x, y: h.lastMessage().y }, { x: 625, y: 230 });
  assert.deepEqual(h.displayChanges, [101, 102, 103]);
  assert.deepEqual(h.boundsCalls.map(call => call.bounds), h.displays.map(display => display.workArea));
  assert.deepEqual(h.ended, [{ channel: 'chii:pet-drag-ended', sessionId: 1, reason: 'released' }]);
  assert.deepEqual(h.eventOrder.slice(-3), ['chii:pet-placement', 'ignore:true', 'chii:pet-drag-ended']);
});

test('removing the active monitor ends on the remaining work area and permits a new drag', () => {
  const h = harness();
  h.controller.begin(grab(1), { x: -800, y: 100 });
  h.displays = [h.displays[0]];
  h.cursor = { x: 600, y: 400 };
  h.controller.end(1, 'display-removed');
  assert.equal(h.lastMessage().displayId, 11);
  assert.equal(h.lastMessage().dragging, false);
  assert.equal(h.ended.at(-1).reason, 'display-removed');
  assert.equal(h.timers.size, 0);
  assert.equal(h.controller.begin(grab(2)), true);
  assert.equal(h.timers.size, 1);
  h.controller.end(2);
});
