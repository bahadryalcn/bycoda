import type { SteerTurnInput } from "../../core/types";

export async function steerAntigravityTurn(_input: SteerTurnInput): Promise<void> {
  throw new Error("Antigravity does not support steering an in-flight turn");
}
