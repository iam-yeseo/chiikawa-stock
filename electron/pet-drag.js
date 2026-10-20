import { displayForPoint, placementForCursor } from '../lib/pet-geometry.js';
import { PET_SIZE } from '../lib/config.js';

// Electron's cursor, display bounds, and BrowserWindow bounds all use DIP.
// Keep drag ownership here so moving the overlay cannot invalidate clientX/Y.
export class PetDragController {
  constructor({ screen, getWindow, onDisplayChange = () => {}, now = Date.now,
    schedule = setInterval, unschedule = clearInterval, timeoutMs = 30000 }) {
    Object.assign(this, { screen, getWindow, onDisplayChange, now, schedule, unschedule, timeoutMs });
    this.session = null;
    this.timer = null;
  }

  get active() { return this.session !== null; }

  begin(input, cursor = null) {
    const window = this.getWindow();
    if (!window || window.isDestroyed() || !window.isVisible() || !input ||
      !Number.isSafeInteger(input.sessionId) || input.sessionId < 1 ||
      !Number.isFinite(input.size) || input.size < PET_SIZE.min || input.size > PET_SIZE.max ||
      !Number.isFinite(input.offset?.x) || !Number.isFinite(input.offset?.y) ||
      Math.abs(input.offset.x) > input.size * 2 || Math.abs(input.offset.y) > input.size * 2) {
      if (input?.sessionId !== this.session?.id) this.notifyEnded(input?.sessionId, 'unavailable');
      return false;
    }
    this.end(undefined, 'replaced');
    this.session = { id: input.sessionId, size: input.size, offset: { ...input.offset },
      started: this.now(), sequence: 0, displayId: null };
    try {
      window.setIgnoreMouseEvents(false, { forward: true });
      this.update(false, '', cursor);
      if (!this.session) return false;
      this.timer = this.schedule(() => {
        if (!this.session) return;
        if (this.now() - this.session.started >= this.timeoutMs) this.end(undefined, 'timeout');
        else this.update();
      }, 16);
      return true;
    } catch { this.cancel('error'); return false; }
  }

  update(finishing = false, reason = '', cursor = null) {
    try { this.place(finishing, reason, cursor); }
    catch {
      // A renderer can disappear between checking the window and sending IPC.
      this.cancel('error');
    }
  }

  place(finishing = false, reason = '', nativeCursor = null) {
    const session = this.session, window = this.getWindow();
    if (!session) return;
    if (!window || window.isDestroyed()) { this.cancel('window-gone'); return; }
    if (!window.isVisible()) { this.cancel('hidden'); return; }
    const cursor = nativeCursor && Number.isFinite(nativeCursor.x) && Number.isFinite(nativeCursor.y)
      ? nativeCursor : this.screen.getCursorScreenPoint();
    const display = displayForPoint(this.screen.getAllDisplays(), cursor, session.displayId);
    if (!display) { this.cancel('no-displays'); return; }
    const area = display.workArea;
    const previous = window.getBounds();
    if (['x', 'y', 'width', 'height'].some(key => previous[key] !== area[key])) window.setBounds(area, false);
    if (session.displayId !== display.id) {
      session.displayId = display.id;
      this.onDisplayChange(display.id);
    }
    const viewport = window.getContentBounds();
    const position = placementForCursor(cursor, session.offset, session.size, viewport);
    window.webContents.send('chii:pet-placement', { sessionId: session.id, sequence: ++session.sequence,
      ...position, viewport: { width: viewport.width, height: viewport.height }, displayId: display.id,
      cursor: { x: cursor.x - viewport.x, y: cursor.y - viewport.y }, dragging: !finishing, reason });
  }

  end(sessionId, reason = 'released', cursor = null) {
    if (!this.session || (sessionId !== undefined && sessionId !== this.session.id)) return;
    const session = this.session;
    try { this.update(true, reason, cursor); }
    finally { if (this.session === session) this.cancel(reason); }
  }

  cancel(reason = 'cancelled') {
    const session = this.session;
    if (!session) return;
    this.clear();
    // Release the native latch before notifying the renderer. A geometry failure
    // must not leave its dragging flag set forever and suppress autonomous walks.
    try {
      const window = this.getWindow();
      if (window && !window.isDestroyed()) window.setIgnoreMouseEvents(true, { forward: true });
    } catch { /* The native window can disappear during teardown. */ }
    this.notifyEnded(session.id, reason);
  }

  notifyEnded(sessionId, reason) {
    if (!Number.isSafeInteger(sessionId) || sessionId < 1) return;
    try {
      const window = this.getWindow();
      if (window && !window.isDestroyed()) window.webContents.send('chii:pet-drag-ended', { sessionId, reason });
    } catch { /* A new renderer starts without a drag session. */ }
  }

  clear() {
    if (this.timer !== null) this.unschedule(this.timer);
    this.timer = null;
    this.session = null;
  }
}
