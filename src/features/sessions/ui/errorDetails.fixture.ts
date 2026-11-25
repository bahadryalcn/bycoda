import { act } from "react";

/** Opens the Details popover of the first alert under `root` and returns the raw error text it shows. */
export function openErrorDetails(root: ParentNode): string | null {
  const open = () => document.body.querySelector('[aria-label="Error details"]');
  if (open()) return open()!.textContent;
  const alert = root.querySelector('[role="alert"]');
  act(() => alert?.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.click());
  return open()?.textContent ?? null;
}
