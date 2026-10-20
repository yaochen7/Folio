const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// A sheet stays flat up to the fold, wraps around a cylinder, then lies back
// over itself. Both end states are exactly flat; the spine never moves.
export function curlShape(progress, width) {
  const p = clamp(progress, 0, 1);
  const radius = width * .105 * Math.sin(Math.PI * p);
  return { radius, fold: width * (1 - p) - Math.PI * radius / 2 };
}

export function curlPoint(offset, width, progress) {
  const p = clamp(progress, 0, 1);
  if (p === 0) return { x: offset, z: 0 };
  if (p === 1) return { x: -offset, z: 0 };
  const { radius, fold } = curlShape(p, width);
  const arc = (offset - fold) / radius;
  if (arc <= 0) return { x: offset, z: 0 };
  if (arc >= Math.PI) return { x: 2 * fold + Math.PI * radius - offset, z: 2 * radius };
  return { x: fold + radius * Math.sin(arc), z: radius * (1 - Math.cos(arc)) };
}

// Use the same physical travel in a single page and a spread. The free edge
// travels two page widths as a sheet crosses from right to left.
export function dragProgress(distance, width, start = 0) {
  return clamp(start + distance / (2 * width), 0, 1);
}

export function completesTurn(progress, velocity) {
  const projected = progress + clamp(velocity, -3, 3) * .18;
  return progress > .035 && (projected > .18 || velocity > .45);
}

// Closed-form critical damping stays stable at 60/120 Hz and after a slow
// frame. It carries the release velocity without a rubbery overshoot.
export function settleProgress(start, velocity, target, seconds) {
  const omega = 22;
  const displacement = start - target;
  const coefficient = clamp(velocity, -3, 3) + omega * displacement;
  const decay = Math.exp(-omega * seconds);
  return {
    position: target + (displacement + coefficient * seconds) * decay,
    velocity: (coefficient - omega * (displacement + coefficient * seconds)) * decay
  };
}
