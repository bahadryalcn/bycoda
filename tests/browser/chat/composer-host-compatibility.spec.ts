import { expect, test, type Page } from "@playwright/test";

const fixture = "/tests/browser/chat/composer-host-compatibility.html";
const waiting =
  "The Host update on this computer is waiting for active sessions to finish and will install automatically.";
// A blocked Send names its reason after the action.
const blockedSend = /^Send\. /;
const capture = (name: string) => `temp/verification/c1/${test.info().project.name}/${name}.png`;

async function readyCurrentCheckout(page: Page) {
  await expect(page.locator("[data-workspace-creation-status]")).toHaveCount(0);
  const send = page.getByRole("button", { name: "Send", exact: true });
  await expect(send).toBeEnabled();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
    "Keep this draft while the Host updates",
  );
  await expect(page.getByTestId("submitted")).toHaveText("");
  const hosts = await page.evaluate(async () => {
    const native = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke(command: string): Promise<{ id: string; environmentId: string; endpoint: string }[]>;
      };
    };
    return (await native.__TAURI_INTERNALS__.invoke("remote_machines")).map(
      ({ id, environmentId, endpoint }) => ({ id, environmentId, endpoint }),
    );
  });
  expect(hosts).toEqual([
    { id: "c1-local-host", environmentId: "c1-environment", endpoint: "http://fixture.invalid" },
  ]);
  expect(await page.evaluate(() => window.c1Host.upgraded)).toBe(false);
  return send;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.clear());
});

for (const theme of ["light", "dark"] as const) {
  test(`compact composer offers current checkout while the Host update waits (${theme})`, async ({
    page,
  }) => {
    // Only an explicit worktree choice waits for the Host; a default draft uses the checkout.
    await page.goto(`${fixture}?compact&mode=worktree`);
    await page.waitForLoadState("networkidle");
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    const status = page.locator("[data-workspace-creation-status]");
    await expect(status).toContainText(waiting);
    await expect(page.getByRole("button", { name: blockedSend })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Use current checkout", exact: true }),
    ).toBeInViewport();
    await page.screenshot({ path: capture(`compact-deferred-${theme}`) });
    await page.getByRole("button", { name: "Use current checkout", exact: true }).click();
    const send = await readyCurrentCheckout(page);
    await send.click();
    await expect(page.getByTestId("submitted")).toHaveText(
      "Keep this draft while the Host updates",
    );
  });

  test(`old Host accepts an explicit current checkout draft (${theme})`, async ({ page }) => {
    await page.goto(`${fixture}?mode=current`);
    await page.waitForLoadState("networkidle");
    await page.evaluate(
      (light) => document.documentElement.classList.toggle("theme-light", light),
      theme === "light",
    );
    const send = await readyCurrentCheckout(page);
    expect(
      await page.evaluate(() =>
        window.c1Host.calls.some((call) => call.method?.startsWith("projects.workspacePolicy.")),
      ),
    ).toBe(false);
    await page.screenshot({ path: capture(`current-checkout-${theme}`) });
    await send.click();
    await expect(page.getByTestId("submitted")).toHaveText(
      "Keep this draft while the Host updates",
    );
  });

  test(`deferred local Host update offers an explicit current checkout choice (${theme})`, async ({
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
    await expect(page.getByRole("button", { name: blockedSend })).toBeDisabled();
    await page.screenshot({ path: capture(`deferred-host-update-${theme}`) });
    await page.setViewportSize({ width: 800, height: 900 });
    await expect(
      page.getByRole("button", { name: "Use current checkout", exact: true }),
    ).toBeInViewport();
    expect(await status.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await page.screenshot({ path: capture(`deferred-host-update-${theme}-800`) });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("button", { name: "Use current checkout", exact: true }).click();
    const send = await readyCurrentCheckout(page);
    await send.click();
    await expect(page.getByTestId("submitted")).toHaveText(
      "Keep this draft while the Host updates",
    );
  });

  test(`old Host without a pending bundle update retains the update-required message (${theme})`, async ({
    page,
  }) => {
    await page.goto(`${fixture}?mode=worktree&bundle=current`);
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
    await expect(page.getByRole("button", { name: blockedSend })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Use current checkout", exact: true }),
    ).toBeEnabled();
    await page.screenshot({ path: capture(`update-required-${theme}`) });
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
    // The consequence leads; the exact ref and commit are the hover detail.
    await expect(status).toContainText("New worktree from main");
    await status.getByText("New worktree from main", { exact: true }).hover();
    await expect(page.getByRole("tooltip")).toHaveText("Based on main @ 01234567");
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
    await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
      "Keep this draft while the Host updates",
    );
    await expect(page.getByTestId("submitted")).toHaveText("");
    await page.screenshot({ path: capture(`reconnected-host-${theme}`) });
  });
}
