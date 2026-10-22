/** Everything a decorative animation loop needs to know to justify a frame. */
export type LoopGate = {
  enabled?: boolean;
  documentHidden: boolean;
  /** IntersectionObserver result for the animated element. */
  visible: boolean;
  /** False while the element has no size (hidden tab, display: none). */
  sized: boolean;
  reducedMotion?: boolean;
};

/**
 * Whether a requestAnimationFrame chain should exist at all. When this is false
 * the loop must be cancelled, not merely skip its work, so a hidden instance
 * costs no per-frame callback.
 */
export function shouldRunLoop(gate: LoopGate): boolean {
  if (gate.enabled === false) return false;
  if (gate.reducedMotion) return false;
  return !gate.documentHidden && gate.visible && gate.sized;
}

/**
 * One zero-filled Float32Array reused across paints. Reallocates only when the
 * requested length changes; the contents are cleared on every call so callers
 * that rely on a fresh buffer see no leftovers.
 */
export function createFloatBuffer() {
  let buffer = new Float32Array(0);
  return (length: number): Float32Array => {
    if (buffer.length !== length) buffer = new Float32Array(length);
    else buffer.fill(0);
    return buffer;
  };
}
