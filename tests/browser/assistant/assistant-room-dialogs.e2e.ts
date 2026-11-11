import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`Room nested dialogs retain canceled work ${theme} ${width}`, async ({ page }) => {
      const output = "temp/verification/2026-11-04-room-history";
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/assistant/assistant-room.html?theme=${theme}&redesign`);
      const capture = async (slug: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          animations: "disabled",
          path: join(output, `${theme}-${width}-${slug}.png`),
        });
      };
      await page.getByRole("tab", { name: /^Jobs/ }).click();
      await page.getByRole("button", { name: "Job actions", exact: true }).first().click();
      await capture("job-actions");
      await page.getByRole("menuitem", { name: "Priority", exact: true }).click();
      const priority = page.getByRole("dialog", { name: "Job priority", exact: true });
      await expect(priority).toContainText("Improve session recovery");
      await capture("priority");
      await priority.getByRole("button", { name: "Close", exact: true }).last().click();
      const openReplan = async () => {
        await page.getByRole("button", { name: "Job actions", exact: true }).first().click();
        await page.getByRole("menuitem", { name: "Replan", exact: true }).click();
      };
      await openReplan();
      const replan = page.getByRole("dialog", { name: "Replan job", exact: true });
      const feedback = replan.getByRole("textbox", { name: "Replan feedback", exact: true });
      await feedback.fill("Keep the existing draft and review cancellation first.");
      await capture("replan");
      await replan.getByRole("button", { name: "Close", exact: true }).last().click();
      await openReplan();
      await expect(feedback).toHaveValue("Keep the existing draft and review cancellation first.");
      await replan.getByRole("button", { name: "Close", exact: true }).last().click();

      await page.getByRole("tab", { name: "Conversations", exact: true }).click();
      await page.getByRole("button", { name: "Conversation actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Clear conversation...", exact: true }).click();
      const clear = page.getByRole("dialog", { name: "Clear this conversation?", exact: true });
      await expect(clear).toContainText("saved summary");
      await capture("conversation-clear");
      await clear.getByRole("button", { name: "Cancel", exact: true }).click();

      await page.getByRole("button", { name: "More options", exact: true }).click();
      await page.getByRole("menuitem", { name: "Recently deleted", exact: true }).click();
      const trash = page.getByRole("dialog", { name: "Recently deleted", exact: true });
      await trash.getByRole("button", { name: "Delete permanently", exact: true }).first().click();
      const purge = page.getByRole("dialog", { name: "Delete permanently?", exact: true });
      await expect(purge).toContainText("This record cannot be restored.");
      await capture("trash-purge");
      await purge.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(trash).toContainText("An earlier research request");
    });
