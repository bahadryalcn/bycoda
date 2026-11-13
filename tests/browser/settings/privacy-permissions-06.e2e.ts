import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
const directory = "temp/verification/settings-ux-20261113/implementation-06";
for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`privacy and permissions ${theme} ${width}`, async ({ page }) => {
      mkdirSync(directory, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme as "light" | "dark", reducedMotion: "reduce" });
      for (const surface of [
        "privacy",
        "protected",
        "failed-save",
        "corrupt",
        "permissions",
        "guide",
        "helper",
        "password",
        "password-set",
        "password-prompt",
        "file-error",
        "gate",
      ]) {
        await page.goto(
          `/tests/browser/settings/privacy-permissions-06.html?surface=${surface}&theme=${theme}`,
        );
        await expect(page.locator("body")).not.toBeEmpty();
        if (surface === "privacy") {
          await expect(page.locator(".privacy-group-row")).toBeVisible();
          await expect(page.locator(".privacy-group-row")).toHaveCSS("display", "grid");
        }
        if (surface === "protected") {
          await expect(page.getByText("Password is set", { exact: true })).toBeVisible();
          await expect(page.getByText("Group names are concealed", { exact: true })).toBeVisible();
          await expect(page.getByText("Example personal", { exact: true })).toHaveCount(0);
        }
        if (theme === "light") await expect(page.locator("html")).toHaveClass(/theme-light/);
        if (surface.startsWith("password")) {
          await expect(page.getByRole("dialog")).toBeVisible();
          if (surface === "password-prompt")
            await page.getByRole("button", { name: "Unlock", exact: true }).click();
          else {
            if (surface === "password")
              await page.getByLabel("Current password", { exact: true }).fill("synthetic-current");
            await page.getByLabel("New password", { exact: true }).fill("x");
            await page.getByLabel("Confirm new password", { exact: true }).fill("x");
            await page
              .getByRole("button", {
                name: surface === "password" ? "Change password" : "Set password",
                exact: true,
              })
              .click();
          }
          await expect(page.getByRole("alert")).toBeVisible();
        }
        if (surface === "file-error")
          await expect(
            page.getByText("Could not read file access status. Retry to check current access.", {
              exact: true,
            }),
          ).toBeVisible();
        if (surface === "permissions")
          await expect(
            page.getByRole("button", { name: "Review access…", exact: true }).first(),
          ).toBeVisible();
        if (surface === "guide")
          await expect(page.getByText("Not allowed", { exact: true })).toBeVisible();
        if (surface === "corrupt" || surface === "gate")
          await expect(
            page.getByText("Privacy settings are unavailable.", { exact: false }).first(),
          ).toBeVisible();
        if (surface === "failed-save")
          await expect(
            page.getByText("Applied in this window, but not saved.", { exact: false }).first(),
          ).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path: `${directory}/${surface}-${theme}-${width}.png`,
          fullPage: true,
        });
      }
      for (const state of ["pending", "restricted", "unavailable"]) {
        await page.goto(
          `/tests/browser/settings/privacy-permissions-06.html?surface=guide&theme=${theme}&state=${state}`,
        );
        await expect(page.locator("body")).not.toBeEmpty();
        await expect(
          page.getByText(
            state === "pending"
              ? "Checking permission status…"
              : state === "restricted"
                ? "Access is restricted by system policy. Contact your administrator."
                : "Permission status is unavailable. Check again from the desktop app.",
            { exact: true },
          ),
        ).toBeVisible();
        await page.screenshot({
          path: `${directory}/guide-${state}-${theme}-${width}.png`,
          fullPage: true,
        });
      }
    });
  }
