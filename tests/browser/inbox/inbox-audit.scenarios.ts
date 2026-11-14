import { expect, test } from "@playwright/test";

const providers = ["github", "jira", "gitlab", "azuredevops", "linear"];

test.describe("Inbox audit", () => {
  test("pending provider keeps loading while another provider has items", async ({ page }) => {
    await page.goto("/tests/browser/inbox/jira-board.html?inbox&pendingProvider=gitlab");
    await expect
      .poll(async () =>
        page.evaluate(() =>
          (window as unknown as { jiraFixtureCalls: { command: string }[] }).jiraFixtureCalls.some(
            ({ command }) => command === "gitlab_list_todos",
          ),
        ),
      )
      .toBe(true);
    await expect(page.getByText("No items to show.", { exact: true })).toHaveCount(0);
    await expect(
      page.getByText("No loaded items match these filters.", { exact: true }),
    ).toHaveCount(0);
    await page.evaluate(() =>
      (window as unknown as { inboxFixtureFinishPending: () => void }).inboxFixtureFinishPending(),
    );
    await expect(
      page.getByText("No loaded items match these filters.", { exact: true }),
    ).toBeVisible();
  });

  for (const provider of ["gitlab", "azuredevops"]) {
    test(`${provider} empty account-wide attention needs no project`, async ({ page }) => {
      await page.goto(`/tests/browser/inbox/jira-board.html?inbox&accountEmpty=${provider}`);
      await expect(
        page.getByText("No loaded items match these filters.", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText(/Add a project to/)).toHaveCount(0);
      const filters = page.getByRole("button", { name: /Filter/ }).first();
      await expect(filters).toHaveAttribute("aria-haspopup", "dialog");
      await filters.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(filters).toBeFocused();
    });
  }

  for (const theme of ["light", "dark"])
    for (const width of [800, 1280]) {
      test(`scope and connection menu ${theme} ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(
          "/tests/browser/inbox/jira-board.html?auditProvider=github&auditScreen=scope",
        );
        await page.evaluate(
          (light) => document.documentElement.classList.toggle("theme-light", light),
          theme === "light",
        );
        await page.getByRole("checkbox", { name: /Merchant portal/ }).check();
        expect(
          await page.evaluate(() =>
            (
              window as unknown as { inboxAuditSelectedIds: () => string[] }
            ).inboxAuditSelectedIds(),
          ),
        ).toEqual(["one", "unavailable-project", "two"]);
        await page.getByRole("textbox", { name: "Search projects" }).fill("Payment");
        await page.getByRole("button", { name: "Clear shown selection" }).click();
        expect(
          await page.evaluate(() =>
            (
              window as unknown as { inboxAuditSelectedIds: () => string[] }
            ).inboxAuditSelectedIds(),
          ),
        ).toEqual(["unavailable-project", "two"]);
        await page.getByRole("textbox", { name: "Search projects" }).fill("");
        await page.screenshot({
          path: `temp/verification/inbox-complete-audit/scope-${theme}-${width}.png`,
          fullPage: true,
        });
        await page.getByRole("button", { name: "Connect an inbox source", exact: true }).click();
        await expect(
          page.getByRole("menuitem", { name: "Connect GitLab", exact: true }),
        ).toBeVisible();
        await page.screenshot({
          path: `temp/verification/inbox-complete-audit/connections-${theme}-${width}.png`,
          fullPage: true,
        });
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toHaveCount(0);
      });

      test(`attachment retry and keyboard ${theme} ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(
          "/tests/browser/inbox/jira-board.html?auditProvider=github&auditScreen=media",
        );
        await page.evaluate(
          (light) => document.documentElement.classList.toggle("theme-light", light),
          theme === "light",
        );
        await page.getByRole("button", { name: "Audit image", exact: true }).click();
        await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
        await page.screenshot({
          path: `temp/verification/inbox-complete-audit/media-error-${theme}-${width}.png`,
          fullPage: true,
        });
        await page.getByRole("button", { name: "Retry", exact: true }).click();
        await expect(
          page.getByRole("img", { name: "Audit image", exact: true }).last(),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await page.getByRole("button", { name: "Audit file", exact: true }).click();
        await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Open in browser", exact: true }),
        ).toBeVisible();
        await page.screenshot({
          path: `temp/verification/inbox-complete-audit/media-file-${theme}-${width}.png`,
          fullPage: true,
        });
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await page.getByRole("button", { name: "Audit PDF", exact: true }).click();
        const pdfDialog = page.getByRole("dialog", { name: "Audit PDF", exact: true });
        await expect(pdfDialog).toBeVisible();
        await expect(pdfDialog.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
        await expect(pdfDialog.getByText("Couldn’t read this PDF", { exact: true })).toBeVisible();
        await page.screenshot({
          path: `temp/verification/inbox-complete-audit/media-pdf-${theme}-${width}.png`,
          fullPage: true,
        });
      });

      for (const provider of providers) {
        test(`${provider} issue and comment ${theme} ${width}`, async ({ page }) => {
          await page.setViewportSize({ width, height: 800 });
          await page.goto(`/tests/browser/inbox/jira-board.html?auditProvider=${provider}`);
          await page.evaluate(
            (light) => document.documentElement.classList.toggle("theme-light", light),
            theme === "light",
          );
          await expect(
            page.getByRole("heading", { name: /Keep payment form drafts/ }),
          ).toBeVisible();
          await page.screenshot({
            path: `temp/verification/inbox-complete-audit/${provider}-issue-summary-${theme}-${width}.png`,
            fullPage: true,
          });
          const form = page.locator("form");
          const source = form.getByRole("textbox", { name: "Comment", exact: true });
          await source.fill(
            "**Preserve this draft**\n\n- Verify preview\n- Keep the original text",
          );
          const preview = form.getByRole("region", { name: "Preview", exact: true });
          await expect(preview.getByText("Preserve this draft", { exact: true })).toBeVisible();
          await expect(preview.locator("li")).toHaveCount(2);
          await form.scrollIntoViewIfNeeded();
          await page.screenshot({
            path: `temp/verification/inbox-complete-audit/${provider}-issue-split-${theme}-${width}.png`,
            fullPage: true,
          });
          await form.getByRole("tab", { name: "Preview", exact: true }).click();
          await expect(source).toBeHidden();
          if (provider === "github")
            await page.screenshot({
              path: `temp/verification/inbox-complete-audit/github-issue-preview-${theme}-${width}.png`,
              fullPage: true,
            });
          await form.getByRole("tab", { name: "Source", exact: true }).click();
          await expect(source).toBeVisible();
          if (provider === "github")
            await page.screenshot({
              path: `temp/verification/inbox-complete-audit/github-issue-source-${theme}-${width}.png`,
              fullPage: true,
            });
          if (provider === "jira") await expect(source).toContainText("**Preserve this draft**");
          else
            await expect(source).toHaveValue(
              "**Preserve this draft**\n\n- Verify preview\n- Keep the original text",
            );
          const writes = await page.evaluate(() =>
            (
              window as unknown as { jiraFixtureCalls: { command: string }[] }
            ).jiraFixtureCalls.filter(({ command }) => /(?:_comment|_pr_action)$/.test(command)),
          );
          expect(writes).toEqual([]);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
        });
      }

      for (const provider of ["github", "gitlab", "azuredevops"]) {
        test(`${provider} pull request tabs ${theme} ${width}`, async ({ page }) => {
          await page.setViewportSize({ width, height: 800 });
          await page.goto(
            `/tests/browser/inbox/jira-board.html?auditProvider=${provider}&auditKind=pr`,
          );
          await page.evaluate(
            (light) => document.documentElement.classList.toggle("theme-light", light),
            theme === "light",
          );
          await expect(
            page.getByRole("heading", { name: /Keep payment form drafts/ }),
          ).toBeVisible();
          for (const tab of ["Summary", "Code", "Checks"]) {
            await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
            if (tab === "Code") await expect(page.locator("[data-inbox-code]")).toBeVisible();
            if (tab === "Checks")
              await expect(page.getByText("Unit tests", { exact: true })).toBeVisible();
            await page.screenshot({
              path: `temp/verification/inbox-complete-audit/${provider}-pr-${tab.toLowerCase()}-${theme}-${width}.png`,
              fullPage: true,
            });
            expect(
              await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            ).toBe(true);
          }
        });
      }
    }

  for (const state of ["empty", "error", "loading"]) {
    test(`issue ${state} state`, async ({ page }) => {
      await page.goto(
        `/tests/browser/inbox/jira-board.html?auditProvider=github&auditState=${state}`,
      );
      await expect(page.getByRole("heading", { name: /Keep payment form drafts/ })).toBeVisible();
      if (state === "error")
        await expect(
          page
            .getByText("Offline fixture: access temporarily unavailable", { exact: true })
            .first(),
        ).toBeVisible();
      if (state === "empty")
        await expect(page.getByText("No description", { exact: true })).toBeVisible();
      if (state === "loading") await expect(page.getByRole("status")).toContainText("Loading");
      await page.screenshot({
        path: `temp/verification/inbox-complete-audit/github-issue-${state}.png`,
        fullPage: true,
      });
    });
  }

  test("Turkish connection labels use the real catalog and provider word order", async ({
    page,
  }) => {
    await page.goto(
      "/tests/browser/inbox/jira-board.html?auditProvider=github&auditScreen=scope&lang=tr",
    );
    await page.getByRole("button", { name: "Connect an inbox source", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "GitLab bağla", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Jira bağla", exact: true })).toBeVisible();
    await page.screenshot({
      path: "temp/verification/inbox-complete-audit/connections-tr.png",
      fullPage: true,
    });
  });
});
