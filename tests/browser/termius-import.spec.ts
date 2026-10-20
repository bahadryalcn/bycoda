import { expect, test } from "@playwright/test";

test("imports only eligible selected records and prevents a repeated pending import", async ({
  page,
}) => {
  await page.goto("/tests/browser/termius-import.html");
  await page.getByRole("button", { name: "Scan this computer" }).click();
  await expect(page.getByText("1 of 3 selected")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Import Existing database" })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "Import Internal proxy target" })).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "Import linked SSH keys into private local files" })
    .uncheck();
  const apply = page.getByRole("button", { name: "Import selected (1)", exact: true });
  await apply.click();
  await expect(apply).toBeDisabled();
  await expect(
    page.getByText("Imported 1 servers. Skipped 0 existing records. Saved 0 SSH keys."),
  ).toBeVisible();
  const requests = await page.evaluate(
    () =>
      (window as unknown as { __termiusRequests: { command: string; input: unknown }[] })
        .__termiusRequests,
  );
  expect(requests.filter((r) => r.command === "termius_import_apply")).toEqual([
    {
      command: "termius_import_apply",
      input: { ticket: "preview-ticket", sourceIds: ["one"], importKeys: false },
    },
  ]);
});

test("recovers from a failed scan and reports an expired preview without losing selection", async ({
  page,
}) => {
  await page.goto("/tests/browser/termius-import.html?error&expired");
  await page.getByRole("button", { name: "Scan this computer" }).click();
  await expect(page.getByRole("alert")).toContainText("Close Termius and try again");
  await page.getByRole("button", { name: "Scan this computer" }).click();
  await page.getByRole("button", { name: "Import selected (1)", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Migration preview expired");
  await expect(page.getByText("1 of 3 selected")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

for (const light of [false, true]) {
  test(`supports narrow ${light ? "light" : "dark"} layouts, Turkish labels and keyboard selection`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 750 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/tests/browser/termius-import.html?tr${light ? "&light" : ""}`);
    await page.getByRole("button", { name: "Bu bilgisayarı tara" }).click();
    await expect(page.getByRole("dialog")).toHaveAccessibleName("Termius'tan içe aktar");
    const all = page.getByRole("checkbox", { name: "Tümünü seç", exact: true });
    await all.focus();
    await page.keyboard.press("Space");
    await expect(
      page.getByRole("button", { name: "Seçilenleri aktar (0)", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Space");
    await expect(
      page.getByRole("button", { name: "Seçilenleri aktar (1)", exact: true }),
    ).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `temp/verification/2026-10-21-termius-import/narrow-${light ? "light" : "dark"}.png`,
    });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}
