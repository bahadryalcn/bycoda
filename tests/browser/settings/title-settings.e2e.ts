import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`title helper uses Host assignments and persists its role: ${theme} ${width}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/settings/title-settings.html?theme=${theme}`);
      const helperModels = page.locator('[data-setting-id="helper-models"]');
      await expect(helperModels.getByRole("img", { name: "Help", exact: true })).toHaveCount(0);
      await expect(helperModels.getByRole("button", { name: "Help", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Manage models", exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as { titleRoleFixture: { openedTab: string } }).titleRoleFixture
                .openedTab,
          ),
        )
        .toBe("roles");
      // A helper follows Automatic until its switch is turned off, which reveals the model choice.
      const automatic = page.getByRole("switch", {
        name: "Automatic model for Title",
        exact: true,
      });
      const choice = page.getByRole("button", { name: /^Model for Title:/ });
      await expect(automatic).toBeChecked();
      await expect(choice).toHaveCount(0);
      await automatic.uncheck();
      await expect(choice).toContainText("Any model, in order");
      const read = () =>
        page.evaluate(() =>
          (
            window as unknown as {
              titleRoleFixture: {
                state: () => {
                  roles: Record<string, unknown>;
                  version: number;
                };
              };
            }
          ).titleRoleFixture.state(),
        );
      expect((await read()).roles["text.title"]).toBeUndefined();
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect.poll(async () => (await read()).roles["text.title"]).toEqual({ kind: "order" });
      await expect
        .poll(() =>
          page.evaluate(() =>
            (
              window as unknown as {
                titleRoleFixture: {
                  calls: {
                    method: string;
                    machineId: string;
                    params: { expectedVersion?: number };
                  }[];
                };
              }
            ).titleRoleFixture.calls
              .filter((call) => call.method === "modelRouting.save")
              .map((call) => ({
                machineId: call.machineId,
                expectedVersion: call.params.expectedVersion,
              })),
          ),
        )
        .toEqual([{ machineId: "fixture-host", expectedVersion: 1 }]);
      await page.reload();
      await page.getByRole("button", { name: "Manage models", exact: true }).click();
      await expect(choice).toContainText("Any model, in order");
      await choice.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath(`title-host-role-${theme}-${width}.png`),
        animations: "disabled",
      });
      await automatic.check();
      await expect(choice).toHaveCount(0);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect.poll(async () => (await read()).roles["text.title"]).toBeUndefined();
      expect(await page.evaluate(() => localStorage.getItem("bycoda.title.default.v1"))).toBeNull();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    });
  }

test("unsupported Host never reads or mutates routing", async ({ page }) => {
  await page.goto("/settings/title-settings.html?unsupported");
  await page.getByRole("button", { name: "Manage models", exact: true }).click();
  await expect(
    page.getByText("Background work is not available on this Host.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { titleRoleFixture: { calls: unknown[] } }).titleRoleFixture.calls,
    ),
  ).toEqual([]);
});

test("denied Host save preserves the role draft and persisted state", async ({ page }) => {
  await page.goto("/settings/title-settings.html?denied");
  await page.getByRole("button", { name: "Manage models", exact: true }).click();
  const choice = page.getByRole("button", { name: /^Model for Title:/ });
  await page.getByRole("switch", { name: "Automatic model for Title", exact: true }).uncheck();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("Model roles could not be saved. Try again.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(choice).toContainText("Any model, in order");
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            titleRoleFixture: {
              state: () => { roles: Record<string, unknown> };
            };
          }
        ).titleRoleFixture.state().roles["text.title"],
    ),
  ).toBeUndefined();
});
