import { expect, test } from "@playwright/test";

const fixture = "/tests/browser/composer-host-compatibility.html";
const waiting =
  "The Host update on this computer is waiting for active sessions to finish and will install automatically.";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.clear());
});

for (const theme of ["light", "dark"] as const) {
  test(`old Host accepts an explicit current checkout draft (${theme})`, async ({ page }) => {
    await page.goto(`${fixture}?mode=current`);
    await page.waitForLoadState("networkidle");
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    const send = page.getByRole("button", { name: "Send", exact: true });
    await expect(send).toBeEnabled();
    await expect(page.locator("[data-workspace-creation-status]")).not.toContainText(
      "Update bycoda",
    );
    expect(
      await page.evaluate(() =>
        window.c1Host.calls.some((call) => call.method?.startsWith("projects.workspacePolicy.")),
      ),
    ).toBe(false);
    await page.screenshot({ path: `temp/verification/c1/current-checkout-${theme}.png` });
    await send.click();
    await expect(page.getByTestId("submitted")).toHaveText(
      "Keep this draft while the Host updates",
    );
  });

  test(`deferred local Host update offers an explicit current checkout choice (${theme})`, async ({
    page,
  }) => {
    await page.goto(fixture);
    await page.waitForLoadState("networkidle");
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    const status = page.locator("[data-workspace-creation-status]");
    await expect(status).toContainText(waiting);
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
    await page.screenshot({ path: `temp/verification/c1/deferred-host-update-${theme}.png` });
    await page.setViewportSize({ width: 800, height: 900 });
    await expect(
      page.getByRole("button", { name: "Use current checkout", exact: true }),
    ).toBeInViewport();
    expect(await status.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `temp/verification/c1/deferred-host-update-${theme}-800.png` });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("button", { name: "Use current checkout", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
      "Keep this draft while the Host updates",
    );
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
    await expect(status).not.toContainText(waiting);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByTestId("submitted")).toHaveText(
      "Keep this draft while the Host updates",
    );
  });

  test(`old Host without a pending bundle update retains the update-required message (${theme})`, async ({
    page,
  }) => {
    await page.goto(`${fixture}?bundle=current`);
    await page.waitForLoadState("networkidle");
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    const status = page.locator("[data-workspace-creation-status]");
    await expect(status).toContainText(
      "Update bycoda Host on this project's machine to use managed workspaces. Your project checkout will not be used as a fallback.",
    );
    await expect(status).not.toContainText(waiting);
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Use current checkout", exact: true }),
    ).toBeEnabled();
    await page.screenshot({ path: `temp/verification/c1/update-required-${theme}.png` });
  });

  test(`Host upgrade and reconnect clears the managed workspace error (${theme})`, async ({
    page,
  }) => {
    await page.goto(`${fixture}?mode=worktree`);
    await page.waitForLoadState("networkidle");
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    const status = page.locator("[data-workspace-creation-status]");
    await expect(status).toContainText(waiting);
    await page
      .getByRole("button", { name: "Simulate Host upgrade and reconnect", exact: true })
      .click();
    await expect(status).toContainText("Based on main @ 01234567; 0 uncommitted paths excluded");
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
    await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
      "Keep this draft while the Host updates",
    );
    await page.screenshot({ path: `temp/verification/c1/reconnected-host-${theme}.png` });
  });
}
