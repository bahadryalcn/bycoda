/** How an hour cell of the day-and-hour grid reads; only "zero" and "value" are measured amounts. */
export type HourCellState = "outside" | "unavailable" | "partial" | "zero" | "value";

/**
 * Outside the period and unpriced hours are not zero: an hour outside has no data to show, and an
 * hour whose tokens have no price has an unknown cost, not a cost of 0 (missing is not zero).
 * `unpriced` only applies to the cost metric.
 */
export function hourCellState({
  amount,
  outside,
  unpriced,
}: {
  amount: number;
  outside: boolean;
  unpriced: boolean;
}): HourCellState {
  if (outside) return "outside";
  if (unpriced) return amount > 0 ? "partial" : "unavailable";
  return amount > 0 ? "value" : "zero";
}
