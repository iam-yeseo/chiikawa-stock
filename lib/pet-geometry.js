/**
 * All positions here are Electron screen coordinates in device-independent pixels.
 * Display scaleFactor deliberately has no role in monitor selection or placement.
 */
export function petBounds({width, height}, size) {
  const left = Math.min(62, Math.max(0, (width - size) / 2));
  const top = Math.min(Math.max(12, size * 0.4), Math.max(0, height - size));
  return {
    left,
    right: Math.max(left, width - size - 62),
    top,
    bottom: Math.max(top, height - size - 12),
  };
}

export function clampPetPosition({x, y}, viewport, size) {
  const {left, right, top, bottom} = petBounds(viewport, size);
  return {
    x: Math.min(right, Math.max(left, x)),
    y: Math.min(bottom, Math.max(top, y)),
  };
}

function containsPoint({x, y, width, height}, point) {
  // Shared edges belong to the display beginning at that edge, not both displays.
  return point.x >= x && point.x < x + width && point.y >= y && point.y < y + height;
}

function squaredDistanceToBounds({x, y, width, height}, point) {
  const dx = Math.max(x - point.x, 0, point.x - (x + width));
  const dy = Math.max(y - point.y, 0, point.y - (y + height));
  return dx * dx + dy * dy;
}

/** Returns the original display object, or null when no displays are available. */
export function displayForPoint(displays, point, fallbackId) {
  const containing = displays.find(display => containsPoint(display.bounds, point));
  if (containing) return containing;

  let nearest = null;
  let nearestDistance = Infinity;
  for (const display of displays) {
    const distance = squaredDistanceToBounds(display.bounds, point);
    if (distance < nearestDistance || (distance === nearestDistance && display.id === fallbackId)) {
      nearest = display;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/** Keep the grab point under the cursor when moving into a new monitor viewport. */
export function placementForCursor(cursor, offset, size, viewport) {
  return clampPetPosition({
    x: cursor.x - viewport.x - offset.x,
    y: cursor.y - viewport.y - offset.y,
  }, viewport, size);
}
