export const RING_CAPACITY = 60;

export interface DancerPosition {
  x: number;
  y: number;
  scale: number;
  ring: number;
  index: number;
}

/** Position the first dancer at the near edge and retain the ranking within each ring. */
export function formation(count: number, width: number, height: number): DancerPosition[] {
  const wide = width > height;
  const total = Math.min(count, RING_CAPACITY * 2);
  const outer = Math.min(RING_CAPACITY, total > 16 ? Math.ceil(total * 0.64) : total);
  const sizes = [outer, total - outer];
  const crowdScale = Math.max(0.46, Math.min(1.13, 2.7 / Math.sqrt(Math.max(1, outer))));
  const centerX = width * (wide ? 0.56 : 0.5);
  const centerY = height * (wide ? 0.58 : 0.53);
  return sizes.flatMap((size, ring) => {
    const spread = Math.min(1, 0.04 + size * 0.058);
    const radiusX = width * (wide ? 0.36 : 0.4) * (ring ? 0.66 : 1) * spread;
    const radiusY = height * (wide ? 0.27 : 0.205) * (ring ? 0.62 : 1) * spread;
    return Array.from({ length: size }, (_, index) => {
      const angle = Math.PI / 2 + (index + ring / 2) * ((2 * Math.PI) / size);
      const depth = Math.sin(angle);
      return {
        x: centerX + Math.cos(angle) * radiusX,
        y: centerY + depth * radiusY,
        scale: crowdScale * (0.95 + depth * 0.19) * (ring ? 0.94 : 1),
        ring,
        index,
      };
    });
  });
}
