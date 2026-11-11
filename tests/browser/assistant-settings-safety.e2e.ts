import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const translations = JSON.parse(
  await readFile(new URL("../../src/shared/i18n/locales/tr.json", import.meta.url), "utf8"),
);
const tr = (key: string) => translations[key] ?? key;
async function requests(page: Page) {
  return page.evaluate(() => (window as any).__setupRequests ?? []) as Promise<
    Array<{ method: string; input: { op: string } }>
  >;
}
async function openSettings(page: Page, extra = "") {
  await page.goto(
    `/tests/browser/assistant-room.html?real-controls&desktop&manual&lang=tr${extra}`,
  );
  await page.getByRole("button", { name: tr("Settings"), exact: true }).click();
  const dialog = page.getByRole("dialog").first();
  await dialog.getByRole("tab", { name: tr("Access"), exact: true }).click();
  return dialog;
}
for (const state of ["disabled", "enabled-idle", "active", "stopped", "unavailable"] as const)
  test(`computer settings only read state on open: ${state}`, async ({ page }) => {
    if (state === "unavailable")
      await page.addInitScript(() => {
        (window as any).__desktopStatusFailure = true;
      });
    const params =
      state === "enabled-idle"
        ? "&desktop-enabled"
        : state === "active"
          ? "&desktop-enabled&desktop-active"
          : state === "stopped"
            ? "&desktop-stopped"
            : "";
    const dialog = await openSettings(page, params);
    const computer = dialog
      .locator("section")
      .and(dialog.getByRole("region", { name: tr("Computer use"), exact: true }));
    const toggle = computer.getByRole("switch", { name: tr("Enable computer use"), exact: true });
    const stop = computer.getByRole("button", { name: tr("Stop computer use"), exact: true });
    const unavailable = state === "unavailable";
    if (unavailable) {
      // A failed status read leaves no stale state: the error shows and no control is offered.
      await expect(computer.getByRole("alert")).toContainText("Desktop status unavailable");
      await expect(toggle).toHaveCount(0);
      await expect(stop).toHaveCount(0);
    } else {
      const enabled = state === "enabled-idle" || state === "active";
      await expect(toggle).toHaveAttribute("aria-checked", String(enabled));
      await expect(computer.getByText(tr("Stopped"), { exact: true })).toHaveCount(
        state === "stopped" ? 1 : 0,
      );
      await expect(computer.getByText(tr("Running"), { exact: true })).toHaveCount(
        state === "active" ? 1 : 0,
      );
      // Emergency stop is offered only while computer use is on.
      await expect(stop).toHaveCount(enabled ? 1 : 0);
      if (state === "disabled") {
        await page.evaluate(() => {
          (window as any).__desktopStatusFailure = true;
        });
        await computer.getByRole("button", { name: tr("Refresh"), exact: true }).click();
        await expect(computer.getByRole("alert")).toContainText("Desktop status unavailable");
        await expect(computer.getByText(tr("Running"), { exact: true })).toHaveCount(0);
      }
    }
    const requested = await requests(page);
    // The desktop itself is only ever asked for its status; an enabled draft may also let the
    // helper row prepare its pinned helper, which never enables or drives control.
    const desktopRequests = requested.filter((r) => r.method === "desktop.request");
    expect(desktopRequests.length).toBeGreaterThan(0);
    expect(desktopRequests.every((r) => r.input.op === "status")).toBe(true);
    const helperRequests = requested.filter((r) => r.method === "desktop.helper.request");
    expect(helperRequests.length).toBeGreaterThan(0);
    expect(
      helperRequests.every(
        (r) =>
          r.input.op === "status" ||
          (r.input.op === "prepare" && (state === "enabled-idle" || state === "active")),
      ),
    ).toBe(true);
  });

test("single save writes the profile and the computer draft together", async ({ page }) => {
  const dialog = await openSettings(page);
  await dialog.getByRole("tab", { name: tr("Personal"), exact: true }).click();
  await dialog
    .getByRole("textbox", { name: tr("Assistant name"), exact: true })
    .fill("Saved profile");
  await dialog.getByRole("tab", { name: tr("Access"), exact: true }).click();
  const application = dialog.getByRole("textbox", { name: tr("Application name"), exact: true });
  await application.fill("Notepad");
  await dialog.getByRole("button", { name: tr("Add application"), exact: true }).click();
  const toggle = dialog.getByRole("switch", { name: tr("Enable computer use"), exact: true });
  await toggle.click();
  // The switch edits a draft; the saved permission stays disabled until the footer saves it.
  expect(
    await page.evaluate(() => (window as any).__desktopFixtureConfiguration?.enabled ?? false),
  ).toBe(false);
  await page.evaluate(() => {
    (window as any).__desktopHoldConfigure = true;
  });
  const save = dialog.locator("button[type=submit][form]");
  await save.click();
  await expect(save).toBeDisabled();
  await dialog.getByRole("button", { name: tr("Close"), exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(tr("Discard unsaved changes?"), { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: tr("Quick setup"), exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).__desktopConfigureRelease());
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  expect(await page.evaluate(() => (window as any).__desktopFixtureConfiguration)).toMatchObject({
    enabled: true,
    allowedApps: ["Notepad"],
    allowPhysicalInput: false,
  });
  await expect(dialog.getByText(tr("Running"), { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: tr("Close"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
