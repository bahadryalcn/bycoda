import { expect, it } from "vitest";
import { createPointerMovement } from "./usePointerMovement";

it("treats the first event and any changed coordinate as movement", () => {
  const moved = createPointerMovement();
  expect(moved({ clientX: 4, clientY: 8 })).toBe(true);
  expect(moved({ clientX: 5, clientY: 8 })).toBe(true);
  expect(moved({ clientX: 5, clientY: 9 })).toBe(true);
});

it("ignores repeats at the last position, as dispatched after keyboard scrolling", () => {
  const moved = createPointerMovement();
  moved({ clientX: 4, clientY: 8 });
  expect(moved({ clientX: 4, clientY: 8 })).toBe(false);
  expect(moved({ clientX: 4, clientY: 8 })).toBe(false);
  expect(moved({ clientX: 4, clientY: 9 })).toBe(true);
});

it("keeps independent positions per guard", () => {
  const first = createPointerMovement();
  const second = createPointerMovement();
  first({ clientX: 1, clientY: 1 });
  expect(second({ clientX: 1, clientY: 1 })).toBe(true);
});
