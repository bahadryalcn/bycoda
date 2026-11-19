import { expect, it } from "vitest";
import { isRoutingSaveConflict, routingSaveMessage } from "./routingSaveConflict";

const legacy = "Model routing changed; reload before saving.";

it("accepts the Host's machine code, as an error code or as the message prefix", () => {
  expect(isRoutingSaveConflict(Object.assign(new Error("anything"), { code: "MODEL_ROUTING_CONFLICT" }))).toBe(
    true,
  );
  expect(isRoutingSaveConflict(new Error(`MODEL_ROUTING_CONFLICT: ${legacy}`))).toBe(true);
  expect(isRoutingSaveConflict(new Error(`Host rejected request: MODEL_ROUTING_CONFLICT: ${legacy}`))).toBe(
    true,
  );
});

it("accepts the exact legacy message of a Host without the code", () => {
  expect(isRoutingSaveConflict(new Error(legacy))).toBe(true);
  expect(isRoutingSaveConflict(new Error(`Host rejected request: ${legacy}`))).toBe(true);
});

it("treats other failures that merely mention version, changed or conflict as ordinary errors", () => {
  for (const text of [
    "Host version 0.3 does not support work limits.",
    "The limit changed while saving.",
    "Unsupported conflict strategy.",
    `${legacy} Try again later.`,
    "Model routing changed",
    "NOT_MODEL_ROUTING_CONFLICT: other",
  ])
    expect(isRoutingSaveConflict(new Error(text))).toBe(false);
  expect(isRoutingSaveConflict(Object.assign(new Error("x"), { code: "RPC_WS_DEADLINE" }))).toBe(false);
  expect(isRoutingSaveConflict(undefined)).toBe(false);
});

it("shows the Host message without its machine code", () => {
  expect(routingSaveMessage(`MODEL_ROUTING_CONFLICT: ${legacy}`)).toBe(legacy);
  expect(routingSaveMessage(legacy)).toBe(legacy);
});
