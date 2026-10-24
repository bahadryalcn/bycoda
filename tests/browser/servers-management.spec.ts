import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const evidence = "temp/verification/2026-10-24-servers/browser";

test.describe("touch selection", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test("touch hold selects and release keeps the selection without opening details", async ({
    page,
  }) => {
    await page.goto("/tests/browser/servers.html?terminalWorkspace&sshFixture");
    const first = page.locator('[data-server-row="fixture-0"]');
    const bounds = await first.boundingBox();
    expect(bounds).not.toBeNull();
    const touch = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
    const client = await page.context().newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touch] });
    await page.waitForTimeout(650);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(
      page.getByRole("checkbox", { name: "Select Server 00", exact: true }),
    ).toBeChecked();
    await expect(page.getByRole("region", { name: "Server details" })).toHaveCount(0);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "SSH terminal", exact: true })).toHaveCount(0);
    await client.detach();
  });
});

test("hold selects without opening details, movement cancels, and row keys toggle selection", async ({
  page,
}) => {
  await page.goto("/tests/browser/servers.html?terminalWorkspace&sshFixture");
  const first = page.locator('[data-server-row="fixture-0"]');
  const second = page.locator('[data-server-row="fixture-1"]');
  const rows = page.getByRole("list", { name: "Servers", exact: true });
  await expect(rows.getByRole("checkbox")).toHaveCount(0);
  const position = await first.boundingBox();
  expect(position).not.toBeNull();
  const x = position!.x + position!.width / 2;
  const y = position!.y + position!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 30, y);
  await page.waitForTimeout(600);
  await expect(rows.getByRole("checkbox")).toHaveCount(0);
  // Release away from the row, as happens when scrolling or abandoning a press.
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
  await expect(page.getByRole("checkbox", { name: "Select Server 00", exact: true })).toBeChecked();
  await expect(page.getByRole("region", { name: "Server details" })).toHaveCount(0);
  await second.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("checkbox", { name: "Select Server 01", exact: true })).toBeChecked();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("checkbox", { name: "Select Server 01", exact: true }),
  ).not.toBeChecked();
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/selection-mode.png` });
  await first.click();
  await expect(rows.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "SSH terminal", exact: true })).toHaveCount(0);
  await first.focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Select", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Select Server 00", exact: true })).toBeChecked();
});

for (const theme of ["light", "dark"]) {
  for (const width of [390, 768, 1440]) {
    test(`server management ${theme} ${width}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/servers.html?terminalWorkspace&sshFixture&serverRestoreFixture&theme=${theme}`,
      );
      const rows = page.getByRole("list", { name: "Servers", exact: true });
      await expect(rows.locator("[data-server-row]")).toHaveCount(36);
      const saved = page
        .locator("details")
        .filter({ has: page.locator("summary", { hasText: "Saved SSH tabs" }) });
      await expect(saved).not.toHaveAttribute("open");
      expect(await page.getByText("Remember saved SSH tabs", { exact: true }).count()).toBe(1);
      await expect(rows.getByRole("checkbox")).toHaveCount(0);
      await page.locator('[data-server-row="fixture-0"]').click({ button: "right" });
      await page.getByRole("menuitem", { name: "Select", exact: true }).click();
      await expect(
        page.getByRole("checkbox", { name: "Select Server 00", exact: true }),
      ).toBeChecked();
      await expect(page.getByRole("region", { name: "Server details" })).toHaveCount(0);
      await page.getByRole("textbox", { name: "Search servers" }).fill("Existing SSH target");
      await page.getByRole("checkbox", { name: "Select visible servers", exact: true }).check();
      await expect(page.getByRole("status").filter({ hasText: "2 selected" })).toContainText(
        "1 hidden",
      );
      await page.getByRole("button", { name: "Delete selected", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Delete 2 servers?" });
      await expect(dialog).toContainText("Server 00");
      await expect(dialog).toContainText("Existing SSH target");
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await page.getByRole("button", { name: "Clear selection", exact: true }).click();
      await expect(rows.getByRole("checkbox")).toHaveCount(0);
      await page.getByRole("textbox", { name: "Search servers" }).fill("");
      await saved.locator("summary").click();
      await expect(saved.getByRole("button", { name: "Connect", exact: true })).toBeVisible();
      await saved.getByRole("checkbox", { name: "Select saved SSH tabs", exact: true }).check();
      await saved.getByRole("button", { name: "Remove selected", exact: true }).click();
      const remove = page.getByRole("dialog", { name: "Remove 1 saved tabs?" });
      await expect(remove).toContainText("Servers and open terminals are kept.");
      await remove.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(
        saved.getByRole("checkbox", { name: "Select saved SSH tabs", exact: true }),
      ).toBeChecked();
      await saved.locator("summary").click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await mkdir(evidence, { recursive: true });
      await page.screenshot({ path: `${evidence}/${theme}-${width}-list.png` });
      await page.getByRole("button", { name: "Card view", exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: `${evidence}/${theme}-${width}-cards.png` });
      expect(errors).toEqual([]);
    });
  }
}

test("confirmed mixed bulk removal removes only selected records", async ({ page }) => {
  await page.goto("/tests/browser/servers.html?terminalWorkspace&sshFixture");
  await page.locator('[data-server-row="fixture-0"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Select", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select Existing SSH target", exact: true }).check();
  await page.getByRole("button", { name: "Delete selected", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete selected", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("[data-server-row]")).toHaveCount(34);
  await expect(page.locator('[data-server-row="fixture-1"]')).toBeVisible();
  await expect(page.locator('[data-server-row="fixture-0"]')).toHaveCount(0);
  await expect(page.locator('[data-server-row="ssh-duplicate"]')).toHaveCount(0);
});

test("removing saved tabs keeps the server and never launches a connection", async ({ page }) => {
  await page.goto("/tests/browser/servers.html?terminalWorkspace&sshFixture&serverRestoreFixture");
  const saved = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Saved SSH tabs" }) });
  await saved.locator("summary").click();
  await saved.getByRole("checkbox", { name: "Select saved SSH tabs", exact: true }).check();
  await saved.getByRole("button", { name: "Remove selected", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Remove selected", exact: true })
    .click();
  await expect(saved).toHaveCount(0);
  await expect(page.locator('[data-server-row="ssh-duplicate"]')).toHaveCount(1);
  expect(
    await page.evaluate(() =>
      (window as any).serversFixtureCalls.filter((command: string) =>
        ["ssh_terminal_spawn", "server_ssh_remove", "remote_disconnect"].includes(command),
      ),
    ),
  ).toEqual([]);
});

test("server detail drafts survive opening and returning from a terminal", async ({ page }) => {
  await page.goto("/tests/browser/servers.html?terminalWorkspace&sshFixture");
  await page.locator('[data-server-row="ssh-duplicate"]').click();
  const details = page.getByRole("region", { name: "Server details", exact: true });
  await details.getByRole("button", { name: "Organization", exact: true }).click();
  await details.getByRole("textbox", { name: "Group", exact: true }).fill("Unfinished group");
  await details.getByRole("button", { name: "Connect via SSH", exact: true }).click();
  await expect(page.getByRole("region", { name: "SSH terminal", exact: true })).toBeVisible();
  await expect(details).toBeHidden();
  await page.getByRole("button", { name: "Servers", exact: true }).click();
  await expect(details.getByRole("textbox", { name: "Group", exact: true })).toHaveValue(
    "Unfinished group",
  );
  await page.screenshot({ path: `${evidence}/details-draft.png` });
});
