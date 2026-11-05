import { act } from "react";
import { expect } from "vitest";

/** Select the manual end-of-speech option in the real rendered voice menu. */
export async function chooseManualEndingFromMenu(click: (label: string) => Promise<void>) {
  await click("Reply when I pause");
  const option = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(
    (button) => button.textContent?.startsWith("I'll finish when ready"),
  );
  expect(option).toBeDefined();
  await act(async () => option!.click());
}

/** Float the companion through the rendered voice options menu. */
export async function floatVoiceFromMenu(click: (label: string) => Promise<void>) {
  await click("Voice options");
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((element) =>
    element.textContent?.includes("Float outside the app"),
  );
  expect(item).toBeDefined();
  await act(async () => item!.click());
}
