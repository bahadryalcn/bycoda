import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";

const translations = JSON.parse(
  await readFile(new URL("../../src/shared/i18n/locales/tr.json", import.meta.url), "utf8"),
);
const tr = (key: string) => translations[key] ?? key;
async function requests(page: Page) {
  return page.evaluate(() => (window as any).__setupRequests ?? []) as Promise<
    Array<{ method: string; input: { op: string } }>
  >;
}
// The permission row renders CapabilityStatus: independent permission, readiness
// and activity axes, each a term/definition pair rather than a live status.
function capabilityAxis(scope: Locator, axis: "permission" | "readiness" | "activity") {
  return scope.locator(`[data-capability-axis="${axis}"]`);
}
async function expectAxis(
  scope: Locator,
  axis: "permission" | "readiness" | "activity",
  state: string,
  label: string,
) {
  const element = capabilityAxis(scope, axis);
  await expect(element).toHaveAttribute("data-state", state);
  await expect(element.getByRole("definition")).toHaveText(tr(label));
}
async function openSettings(page: Page, extra = "") {
  await page.goto(
    `/tests/browser/assistant-room.html?real-controls&desktop&manual&lang=tr${extra}`,
  );
  await page.getByRole("button", { name: tr("Settings"), exact: true }).click();
  const dialog = page.getByRole("dialog").first();
  await dialog.getByRole("tab", { name: tr("Computer use"), exact: true }).click();
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
    if (state === "unavailable") {
      await expect(
        computer
          .getByRole("status")
          .filter({ hasText: tr("Unavailable") })
          .first(),
      ).toBeVisible();
      await expect(computer.getByText(tr("Verified"), { exact: true })).toHaveCount(0);
    } else {
      await expect(computer.getByRole("status").filter({ hasText: tr("Verified") })).toBeVisible();
      const enabled = state === "enabled-idle" || state === "active";
      await expectAxis(
        computer,
        "permission",
        enabled ? "enabled" : "disabled",
        enabled ? "Enabled" : "Disabled",
      );
      await expect(computer.getByText(tr("Stopped"), { exact: true })).toHaveCount(
        state === "stopped" ? 1 : 0,
      );
      await expectAxis(
        computer,
        "activity",
        state === "active" ? "running" : "idle",
        state === "active" ? "Running" : "Idle",
      );
      if (state === "disabled") {
        await page.evaluate(() => {
          (window as any).__desktopStatusFailure = true;
        });
        await computer.getByRole("button", { name: tr("Refresh"), exact: true }).click();
        await expect(computer.getByText(tr("Verified"), { exact: true })).toHaveCount(0);
        await expect(
          computer
            .getByRole("status")
            .filter({ hasText: tr("Unavailable") })
            .first(),
        ).toBeVisible();
      }
    }
    const desktopRequests = (await requests(page)).filter(
      (r) => r.method === "desktop.request" || r.method === "desktop.helper.request",
    );
    expect(desktopRequests.length).toBeGreaterThan(0);
    expect(desktopRequests.every((r) => r.input.op === "status")).toBe(true);
  });

test("profile save retains computer draft and only explicit computer save enables permission", async ({
  page,
}) => {
  const dialog = await openSettings(page);
  await dialog.getByRole("tab", { name: tr("Personal"), exact: true }).click();
  await dialog
    .getByRole("textbox", { name: tr("Assistant name"), exact: true })
    .fill("Saved profile");
  await dialog.getByRole("tab", { name: tr("Computer use"), exact: true }).click();
  const application = dialog.getByRole("textbox", { name: tr("Application name"), exact: true });
  await application.fill("Notepad");
  await dialog.getByRole("button", { name: tr("Save profile settings"), exact: true }).click();
  await expect(dialog.getByText(tr("Profile settings saved."), { exact: true })).toBeVisible();
  expect(
    (await requests(page)).filter((r) => r.method === "desktop.request" && r.input.op !== "status"),
  ).toHaveLength(0);
  await dialog.getByRole("button", { name: tr("Close"), exact: true }).click();
  await expect(
    dialog.getByText(tr("Discard unsaved changes in assistant settings?"), { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: tr("Keep editing"), exact: true }).click();
  await expect(application).toHaveValue("Notepad");
  await dialog.getByRole("button", { name: tr("Add application"), exact: true }).click();
  await dialog.getByRole("switch", { name: tr("Enable computer use"), exact: true }).click();
  // The switch edits a draft; the observed permission stays disabled until saved.
  await expectAxis(dialog, "permission", "disabled", "Disabled");
  await page.evaluate(() => {
    (window as any).__desktopHoldConfigure = true;
  });
  const saveComputer = dialog.getByRole("button", {
    name: tr("Save computer controls"),
    exact: true,
  });
  await saveComputer.click();
  await expect(saveComputer).toBeDisabled();
  await dialog.getByRole("button", { name: tr("Close"), exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText(tr("Discard unsaved changes in assistant settings?"), { exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: tr("Run setup again"), exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => (window as any).__desktopConfigureRelease());
  await expectAxis(dialog, "permission", "enabled", "Enabled");
  expect(await page.evaluate(() => (window as any).__desktopFixtureConfiguration)).toMatchObject({
    enabled: true,
    allowedApps: ["Notepad"],
    allowPhysicalInput: false,
  });
  await expectAxis(dialog, "activity", "idle", "Idle");
  await dialog.getByRole("button", { name: tr("Close"), exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
