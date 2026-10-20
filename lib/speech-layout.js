const clamp = (value, low, high) => Math.min(Math.max(low, high), Math.max(low, value));

/** Position a measured bubble inside its monitor without moving the character. */
export function speechPlacement({ pet, viewport, bubble, gap = 16, margin = 12 }) {
  const center = pet.x + pet.size / 2;
  const left = clamp(center - bubble.width / 2, margin, viewport.width - margin - bubble.width);
  const above = pet.y - gap - bubble.height;
  const below = pet.y + pet.size + gap;
  const fitsAbove = above >= margin;
  const fitsBelow = below + bubble.height <= viewport.height - margin;
  const side = fitsAbove || (!fitsBelow && pet.y >= viewport.height - pet.y - pet.size) ? 'above' : 'below';
  const top = clamp(side === 'above' ? above : below, margin, viewport.height - margin - bubble.height);
  return {
    left: left - pet.x,
    top: top - pet.y,
    tailLeft: clamp(center - left, Math.min(20, bubble.width / 2), bubble.width - 20),
    side,
  };
}
