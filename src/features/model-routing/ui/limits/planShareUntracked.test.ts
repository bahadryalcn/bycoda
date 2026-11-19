import { expect, it } from "vitest";
import type { useT } from "../../../../shared/i18n";
import { untrackedCopy } from "./planShareUntracked";

// Interpolates named slots only; the real catalog is exercised by the locale checks.
const t = ((text: string, values?: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (_, slot: string) => values?.[slot] ?? "")) as ReturnType<
  typeof useT
>;

it("names this computer only for the local Host", () => {
  const copy = untrackedCopy(t, { name: "This computer", local: true });
  expect(copy.label).toBe("Not tracked on this computer");
  expect(copy.info).toContain("sessions on this computer");
});

it("names the remote Host instead of this computer", () => {
  const copy = untrackedCopy(t, { name: "Studio Mac", local: false });
  expect(copy.label).toBe("Not tracked on Host Studio Mac");
  expect(copy.info).toContain("sessions on Host Studio Mac");
  expect(`${copy.label} ${copy.info}`).not.toContain("this computer");
});
