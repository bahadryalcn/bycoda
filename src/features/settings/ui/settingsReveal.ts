/** Find the usable control within a revealed setting, excluding help outside its controls. */
export function settingsRevealControl(target: HTMLElement): HTMLElement | undefined {
  const root =
    target.querySelector<HTMLElement>(".settings-row-control, .settings-group-content") ?? target;
  return [
    ...root.querySelectorAll<HTMLElement>(
      'input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [tabindex="0"]',
    ),
  ].find(
    (element) =>
      element.tabIndex >= 0 &&
      !element.closest('[inert], [hidden], [aria-hidden="true"], [aria-disabled="true"]') &&
      element.getClientRects().length > 0,
  );
}
