import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const dir = "temp/verification/settings-collection-finish";
for (const theme of ["light", "dark"])
  for (const width of [800, 1280])
    test(`collection layouts ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(() => {
        localStorage.setItem(
          "bycoda.archivedProjects",
          JSON.stringify([{ path: "/fixture/archived-project-with-a-long-name", archivedAt: 1 }]),
        );
        localStorage.setItem(
          "bycoda.notificationProjects.v2",
          JSON.stringify([
            {
              id: "repository:github.com/team/project",
              name: "team/project",
              detail: "github.com",
              kind: "repository",
              paths: [],
            },
          ]),
        );
        localStorage.setItem(
          "bycoda.projectGroups",
          JSON.stringify([
            { id: "work", name: "Work projects", collapsed: false, lockable: true },
            { id: "personal", name: "Personal projects", collapsed: false, lockable: true },
          ]),
        );
        localStorage.setItem("bycoda.groupLock.hiddenGroups.v1", JSON.stringify(["personal"]));
      });
      mkdirSync(dir, { recursive: true });
      const results: Record<string, number> = {};
      for (const section of ["notifications", "groupLock", "worktrees", "archive"]) {
        await page.goto(
          `/tests/browser/settings/settings.html?section=${section}&theme=${theme}&lang=en&connections=1`,
        );
        await page.locator("[data-settings-scroller]").waitFor();
        const collections = page.locator(".settings-collection:visible");
        await page.waitForTimeout(400);
        results[section] = await collections.count();
        expect(results[section]).toBe(section === "groupLock" ? 2 : 1);
        for (let i = 0; i < results[section]; i++) {
          const collection = collections.nth(i);
          await collection.scrollIntoViewIfNeeded();
          await expect(collection).toBeVisible();
          if (section === "groupLock") {
            await expect(collection).toHaveCSS("border-top-width", "0px");
            await expect(collection).toHaveCSS("border-top-left-radius", "7px");
          }
          await collection.screenshot({ path: `${dir}/${section}-${i}-${theme}-${width}.png` });
        }
      }
      await page.goto(
        `/tests/browser/settings/settings.html?collectionScope=1&theme=${theme}&lang=en`,
      );
      const scope = page.locator(".settings-collection");
      await expect(scope).toBeVisible();
      await scope.screenshot({ path: `${dir}/inbox-scope-${theme}-${width}.png` });
      await page.goto(
        `/tests/browser/settings/settings.html?collectionWorktrees=1&theme=${theme}&lang=en`,
      );
      const worktreeRows = page.locator(".settings-collection");
      await expect(worktreeRows.getByRole("listitem")).toHaveCount(2);
      await worktreeRows.screenshot({ path: `${dir}/worktree-rows-${theme}-${width}.png` });
      await page.goto(
        `/tests/browser/settings/settings.html?collectionMessaging=1&theme=${theme}&lang=en`,
      );
      const messaging = page.locator(".settings-collection");
      await expect(messaging.getByText("Work email")).toBeVisible();
      await messaging.screenshot({ path: `${dir}/messaging-${theme}-${width}.png` });
      await page.goto(
        `/tests/browser/settings/settings.html?section=integrations&collectionMessaging=1&theme=${theme}&lang=en`,
      );
      await page.getByRole("tab", { name: "Email", exact: true }).click();
      await expect(page.getByText("Work email")).toBeVisible();
      await page
        .getByRole("tabpanel", { name: "Email" })
        .filter({ hasText: "Work email" })
        .screenshot({ path: `${dir}/email-context-${theme}-${width}.png` });
      await page.getByRole("tab", { name: "Slack", exact: true }).click();
      await expect(page.getByText("Work Slack")).toBeVisible();
      await page
        .getByRole("tabpanel", { name: "Slack" })
        .screenshot({ path: `${dir}/slack-context-${theme}-${width}.png` });
      await page.goto(
        `/tests/browser/settings/settings.html?section=integrations&collectionLinear=1&theme=${theme}&lang=en`,
      );
      await page.getByRole("tab", { name: "Linear", exact: true }).click();
      await expect(page.getByText("Engineering", { exact: true })).toBeVisible();
      await page
        .getByRole("tabpanel", { name: "Linear" })
        .screenshot({ path: `${dir}/linear-context-${theme}-${width}.png` });
      await page.goto(
        `/tests/browser/settings/settings.html?section=integrations&collectionJira=1&theme=${theme}&lang=en`,
      );
      await page.getByRole("tab", { name: "Jira", exact: true }).click();
      await expect(page.getByText("Engineering board", { exact: true })).toBeVisible();
      const jira = page.getByRole("tabpanel", { name: "Jira" });
      await expect(jira.locator(".settings-collection")).toHaveCount(2);
      for (let i = 0; i < 2; i++)
        await jira
          .locator(".settings-collection")
          .nth(i)
          .screenshot({ path: `${dir}/jira-${i}-${theme}-${width}.png` });
      writeFileSync(`${dir}/counts-${theme}-${width}.json`, JSON.stringify(results, null, 2));
    });
