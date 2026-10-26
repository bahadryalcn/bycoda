import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("reviews exact revisions, opens commit diff, merges and retains a readable conversation after removal", async ({
  page,
}) => {
  await page.goto("/tests/browser/workspace-actions.html");
  await page.getByRole("button", { name: "Review changes", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Review changes", exact: true });
  await expect(dialog).toContainText("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  await expect(dialog).toContainText("target-status-fingerprint");
  await dialog.getByRole("button", { name: "bbbbbbbbbbbb", exact: true }).click();
  await expect(dialog).toContainText("export const mode");
  await dialog.getByRole("button", { name: "Merge into main", exact: true }).click();
  await expect(dialog).toContainText("Merged into main.");
  await dialog.getByRole("contentinfo").getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Delete directory", exact: true }).click();
  const removal = page.getByRole("dialog", { name: "Delete worktree directory" });
  await expect(removal).toContainText("conversation, branch and recovery history are retained");
  await removal.getByRole("button", { name: "Delete directory", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Assistant", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByRole("button", { name: "Review changes", exact: true })).toBeVisible();
  const writes = await page.evaluate(
    () =>
      (
        window as unknown as {
          workspaceCalls: { method: string; params: Record<string, unknown> }[];
        }
      ).workspaceCalls,
  );
  expect(writes.filter((call) => call.method === "workspaces.delivery.merge")).toHaveLength(1);
  expect(writes.find((call) => call.method === "workspaces.delivery.merge")?.params.planToken).toBe(
    "sha-bound-review",
  );
});

test("explicitly approves pushing a branch and creating one PR from the same dialog", async ({
  page,
}) => {
  await page.goto("/tests/browser/workspace-actions.html");
  await page.getByRole("button", { name: "Review changes", exact: true }).click();
  await page.getByRole("button", { name: "Create PR", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create PR", exact: true });
  await dialog.getByRole("textbox", { name: "Repository", exact: true }).fill("fixture/repo");
  await dialog.getByRole("textbox", { name: "Title", exact: true }).fill("Workspace delivery");
  await dialog.getByRole("button", { name: "Review publication", exact: true }).click();
  await dialog.getByRole("button", { name: "Push branch and create PR", exact: true }).click();
  await expect(dialog).toContainText("Pull request created.");
  await expect(dialog.getByRole("link", { name: "#42" })).toBeVisible();
});

test("overlapping target paths block merge", async ({ page }) => {
  await page.goto("/tests/browser/workspace-actions.html?overlap");
  await page.getByRole("button", { name: "Review changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Merge into main", exact: true })).toBeDisabled();
  await expect(page.getByRole("dialog")).toContainText("Overlapping target changes");
});

for (const theme of ["light", "dark"] as const)
  for (const width of [1280, 800]) {
    test(`workspace actions ${theme} ${width}`, async ({ page }) => {
      await mkdir("temp/verification/i2a", { recursive: true });
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/workspace-actions.html?theme=${theme}`);
      await expect(page.getByRole("button", { name: "Review changes", exact: true })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/i2a/session-actions-${theme}-${width}.png`,
        fullPage: true,
      });
      await page.getByRole("button", { name: "Workspace actions", exact: true }).click();
      await expect(
        page.getByRole("menuitem", { name: "Mark finished", exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: `temp/verification/i2a/session-overflow-${theme}-${width}.png`,
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Review changes", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog", { name: "Review changes", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Create PR", exact: true }).focus();
      await page.screenshot({
        path: `temp/verification/i2a/session-review-${theme}-${width}.png`,
        fullPage: true,
      });
      await page.getByRole("button", { name: "Create PR", exact: true }).click();
      await page.getByRole("textbox", { name: "Repository", exact: true }).fill("fixture/repo");
      await page.getByRole("textbox", { name: "Title", exact: true }).fill("Workspace delivery");
      await page.getByRole("button", { name: "Review publication", exact: true }).click();
      await page.screenshot({
        path: `temp/verification/i2a/session-publication-${theme}-${width}.png`,
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Workspace actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Delete worktree directory", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Delete worktree directory" })).toContainText(
        "Dependency links",
      );
      await page.screenshot({
        path: `temp/verification/i2a/session-removal-${theme}-${width}.png`,
        fullPage: true,
      });
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Delete directory", exact: true })
        .click();
      await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/i2a/session-resume-${theme}-${width}.png`,
        fullPage: true,
      });
    });
  }
