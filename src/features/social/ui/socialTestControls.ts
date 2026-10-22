import { act } from "react";
import { expect } from "vitest";

/** Exercise the real portalled option, including permission guards and callback. */
export async function chooseSocialValue(trigger: HTMLButtonElement, value: string) {
  expect(trigger).toBeTruthy();
  await act(async () => trigger.click());
  const option = Array.from(
    document.body.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ).find((item) => item.dataset.value === value);
  expect(option, `Missing selectable value: ${value}`).toBeTruthy();
  expect(option!.disabled).toBe(false);
  await act(async () => option!.click());
}
