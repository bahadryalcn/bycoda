import { act } from "react";
import { expect } from "vitest";

/** Assert the failure headline and check the raw error through the real Details disclosure. */
export async function expectErrorDetails(scope: ParentNode, title: string, detail: string) {
  const alert = scope.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain(title);
  expect(alert?.textContent).not.toContain(detail);
  const trigger = alert!.querySelector<HTMLButtonElement>('button[aria-label^="Details"]')!;
  await act(async () => trigger.click());
  const dialog = document.getElementById(trigger.getAttribute("aria-controls")!);
  expect(dialog?.textContent).toContain(detail);
  await act(async () => trigger.click());
}
