import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const draft = "Keep the owner's draft while preparing an isolated workspace.";
const observations = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          workspaceCreationObservations: {
            ipc: { command: string; machineId?: string; method?: string; params?: unknown }[];
            submissions: { text: string; attachmentCount: number; mode: string; cwd: string }[];
          };
        }
      ).workspaceCreationObservations,
  );
const expectNoAdmission = async (page: Page) => {
  const observed = await observations(page);
  expect(observed.ipc.filter((call) => /^(workspaces|sessions)\./.test(call.method ?? ""))).toEqual(
    [],
  );
  expect(
    observed.ipc
      .filter((call) => call.command === "remote_request")
      .every((call) => call.machineId === "fixture"),
  ).toBe(true);
  return observed;
};
const expectReadyCurrentCheckout = async (page: Page) => {
  await expect(page.locator("[data-workspace-creation-status]")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(draft);
  const send = page.getByRole("button", { name: "Send", exact: true });
  await expect(send).toBeEnabled();
  const machines = await page.evaluate(async () => {
    const ipc = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke(
            command: string,
          ): Promise<{ id: string; environmentId: string; endpoint: string; localHost: boolean }[]>;
        };
      }
    ).__TAURI_INTERNALS__;
    return (await ipc.invoke("remote_machines")).map(
      ({ id, environmentId, endpoint, localHost }) => ({ id, environmentId, endpoint, localHost }),
    );
  });
  expect(machines).toEqual([
    {
      id: "fixture",
      environmentId: "fixture-environment",
      endpoint: "http://127.0.0.1:1",
      localHost: true,
    },
  ]);
  expect((await expectNoAdmission(page)).submissions).toEqual([]);
  await expect(page.getByText("Fixture send accepted", { exact: true })).toHaveCount(0);
  return send;
};
const sendCurrentCheckout = async (page: Page) => {
  const send = await expectReadyCurrentCheckout(page);
  await send.click();
  await expect(page.getByRole("status")).toHaveText("Fixture send accepted");
  expect((await expectNoAdmission(page)).submissions).toEqual([
    { text: draft, attachmentCount: 0, mode: "current", cwd: "/fixture/creation-project" },
  ]);
  // The fixture rejects after observing the callback, so the draft must survive.
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(draft);
};

for (const theme of ["light", "dark"]) {
  for (const width of [1280, 800]) {
    test(`new workspace default and older Host: ${theme} ${width}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/workspace-creation.html?theme=${theme}`);
      await expectReadyCurrentCheckout(page);
      await expect(
        page.getByRole("button", {
          name: "Workspace Current checkout",
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      mkdirSync("temp/verification/d1", { recursive: true });
      await page.screenshot({
        path: `temp/verification/d1/creation-${theme}-${width}.png`,
        fullPage: true,
      });
      const mode = page.getByRole("button", {
        name: "Workspace Current checkout",
        exact: true,
      });
      await mode.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog", { name: "Workspace", exact: true })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/d1/creation-picker-${theme}-${width}.png`,
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      await sendCurrentCheckout(page);
      await page.goto(`/tests/browser/workspace-creation.html?theme=${theme}&old-host&worktree`);
      await expect(page.locator("[data-workspace-creation-status]")).toContainText(
        "Update bycoda Host",
      );
      expect((await expectNoAdmission(page)).submissions).toEqual([]);
      // The disabled Send control carries the reason in its accessible name.
      await expect(page.getByRole("button", { name: /^Send\. Update bycoda Host/ })).toBeDisabled();
      await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(
        /Keep the owner's draft/,
      );
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(page.locator("[data-workspace-creation-status]")).toContainText(
        "Update bycoda Host",
      );
      await page.screenshot({
        path: `temp/verification/d1/creation-update-${theme}-${width}.png`,
        fullPage: true,
      });
    });
  }
}

test("project policy worktree remains an explicit visible selection", async ({ page }) => {
  await page.goto("/tests/browser/workspace-creation.html?worktree-policy");
  await expect(
    page.getByRole("button", { name: "Workspace New worktree", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
});

test("older Host defaults to current checkout without managed admission", async ({ page }) => {
  await page.goto("/tests/browser/workspace-creation.html?old-host");
  await expect(
    page.getByRole("button", {
      name: "Workspace Current checkout",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  await sendCurrentCheckout(page);
});
