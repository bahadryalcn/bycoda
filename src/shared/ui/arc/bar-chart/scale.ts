/**
 * Clean gridlines: the smallest step of 1, 2, 3, or 5 covering the data in four rows or fewer, so
 * shared steps survive a range change. Whole-number data (counts) never gets a fractional step,
 * whose rounded labels would repeat ("0, 1, 1, 2, 2").
 */
export function scaleFor(max: number, wholeNumbers = false) {
  const safe = Math.max(max, 1);
  const magnitude = Math.max(wholeNumbers ? 1 : 0, 10 ** Math.floor(Math.log10(safe / 4)));
  for (const factor of [1, 2, 3, 5, 10]) {
    const step = factor * magnitude,
      rows = Math.ceil(safe / step);
    if (rows <= 4)
      return { top: rows * step, ticks: Array.from({ length: rows + 1 }, (_, row) => row * step) };
  }
  return { top: safe, ticks: [0, safe] };
}
