import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
const output = "temp/verification/assistant-social-account";
for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`Account grant ${theme} ${width}`, async ({ page }) => {
      await mkdir(output, { recursive: true });
      await writeFile(
        join(output, "README.md"),
        "Purpose: social Assistant account access and unavailable task observation UI. Origin: synthetic Assistant Room/account fixture; no account or provider writes.\n",
      );
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/assistant/assistant-room.html?account-grants&theme=${theme}`);
      // The permissions card is always visible (no disclosure to open).
      await expect(page.getByRole("heading", { name: "Who can use this account" })).toBeVisible();
      await expect(
        page.getByText("Sending still requires the autonomy level below.", { exact: false }),
      ).toBeVisible();
      await expect(page.getByRole("checkbox", { name: "Can read" })).toBeChecked();
      await page.screenshot({
        path: join(output, `account-${theme}-${width}.png`),
        animations: "disabled",
      });
    });
    test(`Task observation availability ${theme} ${width}`, async ({ page }) => {
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/assistant/assistant-room.html?global-room&theme=${theme}`);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const dialog = page.getByRole("dialog").first();
      await dialog.getByRole("tab", { name: "Work", exact: true }).click();
      await expect(dialog.getByText("Readiness not confirmed", { exact: true })).toBeVisible();
      await dialog.screenshot({
        path: join(output, `observation-${theme}-${width}.png`),
        animations: "disabled",
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`Task notification recovery ${theme} ${width}`, async ({ page }) => {
      const dir = "temp/verification/assistant-social-account";
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?global-room&notification-recovery-fixture&theme=${theme}`,
      );
      await page.getByText("Task notification recovery").click();
      await page.getByRole("button", { name: /^Project\b/ }).click();
      await page.getByRole("option", { name: "Fixture project", exact: true }).click();
      await page.getByRole("button", { name: "Check notifications", exact: true }).click();
      await expect(page.getByText("Outcome unknown")).toBeVisible();
      await expect(page.getByRole("button", { name: "Check original status" })).toBeVisible();
      await page.screenshot({
        path: join(dir, `notification-recovery-${theme}-${width}.png`),
        animations: "disabled",
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`Room message author ${theme} ${width}`, async ({ page }) => {
      const dir = "temp/verification/assistant-room-author";
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "README.md"),
        "Purpose: Assistant Room message author provenance. Origin: actual SessionMessageAuthor with synthetic author; no app writes.\n",
      );
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/tests/browser/assistant/assistant-room.html?room-author&theme=${theme}`);
      await expect(page.getByRole("button", { name: /Assistant wrote.*Kickoff/ })).toBeVisible();
      await page.screenshot({
        path: join(dir, `author-${theme}-${width}.png`),
        animations: "disabled",
      });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`Account grant retirement pending ${theme} ${width}`, async ({ page }) => {
      const dir = "temp/verification/assistant-social-account";
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/assistant/assistant-room.html?account-grants&account-pending&theme=${theme}`,
      );
      await expect(page.getByRole("heading", { name: "Who can use this account" })).toBeVisible();
      await expect(
        page.getByText(
          "Assistant access is paused while voice retirement is pending. Reconnect the original device and save again to retry.",
        ),
      ).toBeVisible();
      await expect(page.getByRole("checkbox", { name: "Can read" })).not.toBeChecked();
      await page.screenshot({
        path: join(dir, `account-pending-${theme}-${width}.png`),
        animations: "disabled",
      });
    });
  }
