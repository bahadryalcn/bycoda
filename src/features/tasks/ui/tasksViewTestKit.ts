import { act } from "react";

export function buttonText(entry: HTMLButtonElement) {
  const copy = entry.cloneNode(true) as HTMLButtonElement;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return copy.textContent?.trim();
}
export const buttonName = (entry: HTMLButtonElement) =>
  entry.getAttribute("aria-label") ?? buttonText(entry);
// A control that explains why it is off stays focusable and reports aria-disabled.
export const isDisabled = (entry: HTMLButtonElement) =>
  entry.disabled || entry.getAttribute("aria-disabled") === "true";
export const button = (scope: ParentNode, label: string) =>
  Array.from(scope.querySelectorAll("button")).find(
    (entry) => buttonName(entry) === label || buttonText(entry) === label,
  );
/** Opens the shared "Agent settings" Disclosure (native details) of a task form. */
export async function openAgentSettings(form: ParentNode) {
  const summary = Array.from(form.querySelectorAll("summary")).find((entry) =>
    entry.textContent?.trim().startsWith("Agent settings"),
  )!;
  const details = summary.parentElement as HTMLDetailsElement;
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
}
/** A checkbox's accessible label: its aria-label, else the text of the label wrapping it. */
export const checkLabel = (box: HTMLInputElement) =>
  box.getAttribute("aria-label") ?? box.closest("label")?.textContent?.trim();
export const checkboxNamed = (scope: ParentNode, name: string) =>
  Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find((box) =>
    checkLabel(box)?.startsWith(name),
  )!;
