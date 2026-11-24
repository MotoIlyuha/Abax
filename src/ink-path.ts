export interface InkPoint { x: number; y: number; p?: number }

/** Длины вдоль штриха позволяют сопоставлять точки независимо от скорости рисования. */
export function measurePath(points: readonly InkPoint[]) {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  const length = lengths[lengths.length - 1];
  function at(fraction: number) {
    const position = Math.max(0, Math.min(1, fraction)) * length;
    let lo = 0, hi = points.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >>> 1;
      if (lengths[mid] <= position) lo = mid;
      else hi = mid;
    }
    const a = points[lo], b = points[hi];
    const t = (position - lengths[lo]) / (lengths[hi] - lengths[lo] || 1);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: (a.p ?? 0.5) + ((b.p ?? 0.5) - (a.p ?? 0.5)) * t };
  }
  return { length, lengths, at };
}
