import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const evidence = path.resolve("temp/verification/2026-11-04-last-sessions-workspace");
const titleEvidence = path.resolve("temp/verification/2026-11-04-session-titles");
for (const light of [true, false])
  for (const width of [800, 1280])
    test(`sessions no match visual ${light ? "light" : "dark"} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/sessions/session-row-layout.html?${light ? "light" : "dark"}`,
      );
      await page.getByRole("button", { name: "Search conversations", exact: true }).click();
      await page
        .getByPlaceholder("Search conversations...")
        .fill("no matching fixture conversation");
      await expect(page.getByText("No matching sessions", { exact: true })).toBeVisible();
      await page.screenshot({
        path: `temp/verification/sessions-callers/no-match-${light ? "light" : "dark"}-${width}.png`,
      });
    });
for (const light of [false, true]) {
  for (const width of [1280, 800]) {
    test(`virtual folder headers do not overlap sessions at ${width} ${light ? "light" : "dark"}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/sessions/session-row-layout.html?virtual-folders&${light ? "light" : "dark"}`,
      );
      const list = page.locator("[data-session-list]").last();
      await expect(list.locator("[data-pinned-sessions]")).toBeVisible();
      await expect
        .poll(async () =>
          list.evaluate((element) => {
            const rows = Array.from(element.children).map((row) => row.getBoundingClientRect());
            return rows.every((row, index) => index === 0 || row.top >= rows[index - 1].bottom - 1);
          }),
        )
        .toBe(true);
      for (const selector of ["[data-session-folder]", "[data-pinned-sessions]"]) {
        await expect(list.locator(selector).first()).toHaveCSS("position", "absolute");
      }
      const output = path.resolve("temp/verification/2026-11-06-sidebar-overlap");
      await mkdir(output, { recursive: true });
      await page.screenshot({
        path: path.join(output, `${light ? "light" : "dark"}-${width}.png`),
      });
    });
  }
}
test("sidebar glass retains selection and focus without main glass", async ({ page }) => {
  // The GitHub prompt group no longer lives in this sidebar (the footer owns feedback; the
  // joined-action glass and focus are covered by update-footer.spec.ts).
  // Reduced motion removes the pane's background transition, so computed colors are final
  // instead of the transition's start value on a slow runner.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/sessions/session-row-layout.html", {
    waitUntil: "domcontentloaded",
  });
  const row = page.locator('[data-session-card="row-multi"]');
  const sidebar = page.getByRole("complementary").first();
  await expect(row).toBeVisible();
  const alpha = (color: string) =>
    page.evaluate((value) => {
      const probe = document.createElement("canvas").getContext("2d")!;
      probe.fillStyle = value;
      probe.clearRect(0, 0, 1, 1);
      probe.fillRect(0, 0, 1, 1);
      return probe.getImageData(0, 0, 1, 1).data[3] / 255;
    }, color);
  const normal = await sidebar.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(await alpha(normal)).toBe(1);
  // The default sidebar opacity (1) makes glass visually opaque; use a translucent setting so
  // the sidebar's own glass fill is observable on every platform.
  await page.evaluate(() => {
    document.documentElement.classList.remove("glass-body", "theme-light");
    document.documentElement.classList.add("has-native-glass");
    document.documentElement.style.setProperty("--sidebar-opacity", "0.6");
  });
  const glass = await sidebar.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(await alpha(glass)).toBeCloseTo(0.6, 1);
  const selected = await row.evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(selected).not.toBe("none");
  const main = page.getByRole("main");
  expect(await main.evaluate((element) => getComputedStyle(element).backgroundColor)).toMatch(
    /^(rgba\(0, 0, 0, 0\)|transparent)$/,
  );
  await row.getByRole("button").first().focus();
  await expect(row.getByRole("button").first()).toBeFocused();
  await page.emulateMedia({ forcedColors: "active" });
  await expect(row).toHaveCSS("outline-style", "solid");
});
test("selected and Pinned-section cards keep their project mark at rest", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/sessions/session-row-layout.html?virtual-folders", {
    waitUntil: "domcontentloaded",
  });
  const mark = (id: string) =>
    page.locator(`[data-session-card="${id}"] [data-session-project-mark]`);
  const pinned = page.locator('[data-session-card="virtual-5"]');
  await expect(pinned).toBeVisible();
  await page.mouse.move(5, 5);
  await expect(mark("virtual-5")).toHaveCSS("visibility", "visible");
  await pinned.locator("[data-session-select]").click();
  await expect(pinned).toHaveAttribute("data-selected", "true");
  await page.mouse.move(5, 5);
  await expect(mark("virtual-5")).toHaveCSS("visibility", "visible");
  await pinned.hover();
  await expect(mark("virtual-5")).toHaveCSS("visibility", "hidden");
  await expect(pinned.getByRole("button", { name: "Unpin", exact: true })).toHaveCSS(
    "opacity",
    "1",
  );
});
for (const density of ["compact", "detailed"]) {
  for (const light of [false, true]) {
    test(`inline title rename density ${density} in ${light ? "light" : "dark"}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: 800, height: 800 });
      await page.goto(
        `/tests/browser/sessions/session-row-layout.html?density=${density}&${light ? "light" : "dark"}`,
        { waitUntil: "domcontentloaded" },
      );
      const row = page.locator('[data-session-card="row-working"]');
      const select = row.locator("[data-session-select]");
      await select.focus();
      await select.press("F2");
      const input = row.getByRole("textbox", { name: "Name", exact: true });
      await expect(input).toBeFocused();
      await page.mouse.move(760, 760);
      expect(await row.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
        true,
      );
      await mkdir(titleEvidence, { recursive: true });
      await page.screenshot({
        path: path.join(titleEvidence, `${light ? "light" : "dark"}-800-${density}-rename.png`),
      });
      await input.fill("Keep original title");
      await input.press("Escape");
      await expect(row).toContainText("Arif: 7/24 Sesli Asistan ve İş Takibi");
    });
  }
}
for (const light of [false, true]) {
  for (const width of [1280, 800]) {
    test(`title rename and regenerate at ${width} in ${light ? "light" : "dark"}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 800 });
      await page.goto(
        `/tests/browser/sessions/session-row-layout.html?${light ? "light" : "dark"}`,
        {
          waitUntil: "domcontentloaded",
        },
      );
      const row = page.locator('[data-session-card="row-working"]');
      await expect(row).toBeVisible({ timeout: 90_000 });
      await expect(row).toHaveCSS("display", "flex");
      await expect(row).toHaveCSS("flex-direction", "column");
      await expect(row).toHaveCSS("align-items", "stretch");
      await row.click({ button: "right" });
      const menu = page.getByRole("menu");
      const rename = menu.getByRole("menuitem", { name: "Rename", exact: false });
      const regenerate = menu.getByRole("menuitem", { name: "Regenerate title", exact: true });
      await expect(regenerate).toBeVisible();
      const renameBox = await rename.boundingBox();
      const regenerateBox = await regenerate.boundingBox();
      expect(regenerateBox!.y).toBeGreaterThanOrEqual(renameBox!.y + renameBox!.height);
      await mkdir(titleEvidence, { recursive: true });
      await page.screenshot({
        path: path.join(titleEvidence, `${light ? "light" : "dark"}-${width}-menu.png`),
      });
      await rename.click();
      const input = row.getByRole("textbox", { name: "Name", exact: true });
      await expect(input).toBeFocused();
      await page.mouse.move(width - 20, 760);
      await expect(row.locator("[data-session-row-project]")).toContainText("bycoda");
      await expect(row.locator("[data-session-row-project]")).toContainText("Working");
      await expect(row.locator("[data-session-row-branch]")).toContainText("feature/voice");
      expect(
        await input.evaluate(
          (element: HTMLInputElement) =>
            element.selectionStart === 0 && element.selectionEnd === element.value.length,
        ),
      ).toBe(true);
      expect(await row.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
        true,
      );
      await page.screenshot({
        path: path.join(titleEvidence, `${light ? "light" : "dark"}-${width}-rename.png`),
      });
      await input.fill("An edited title");
      await input.press("Enter");
      await expect(row).toContainText("An edited title");
      await row.click({ button: "right" });
      await page.getByRole("menuitem", { name: "Regenerate title", exact: true }).click();
      await expect(row).toContainText("Restore Draft Editing in Recovered Sessions");
      await expect(page.getByRole("status", { name: "Selected session", exact: true })).toHaveText(
        "",
      );
    });
  }
}
for (const light of [false, true]) {
  for (const width of [1280, 800]) {
    test(`session identity, pin and providers at ${width} in ${light ? "light" : "dark"}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/tests/browser/sessions/session-row-layout.html${light ? "?light" : ""}`, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      const row = page.locator('[data-session-card="row-multi"]');
      await expect(row).toBeVisible({ timeout: 90_000 });
      const project = row.locator("[data-session-row-project]");
      const title = row.locator("[data-session-select]");
      const branch = row.locator("[data-session-row-branch]");
      const providers = row.locator("[data-session-row-model]");
      await expect(project).toContainText("bycoda");
      await expect(row).not.toHaveAttribute("data-ground");
      await expect(title).toContainText("Design System Clarity Review");
      await expect(branch).toContainText("main");
      const [projectBox, titleBox, branchBox, providerBox] = await Promise.all([
        project.boundingBox(),
        title.boundingBox(),
        branch.boundingBox(),
        providers.boundingBox(),
      ]);
      expect(projectBox!.y + projectBox!.height).toBeLessThanOrEqual(titleBox!.y + 1);
      expect(titleBox!.y + titleBox!.height).toBeLessThanOrEqual(branchBox!.y + 1);
      expect(providerBox!.x).toBeGreaterThan(branchBox!.x + branchBox!.width);
      const activeProvider = row.locator('[data-session-provider][data-provider-active="true"]');
      await expect(row.locator("[data-session-provider]")).toHaveCount(2);
      await expect(row.locator('[data-session-provider="codex"]')).toHaveAttribute(
        "data-provider-active",
        "false",
      );
      await expect(activeProvider).toHaveCount(1);
      await expect(activeProvider).toHaveAttribute("data-session-provider", "claude");
      const pin = row.getByRole("button", { name: "Pin", exact: true });
      await pin.click();
      await expect(page.getByRole("status", { name: "Pin operations" })).toHaveText("1");
      await expect(page.getByRole("status", { name: "Selected session" })).toHaveText("");
      await expect(row.getByRole("button", { name: "Unpin", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await title.focus();
      const detail = page
        .locator('[role="tooltip"]')
        .filter({ hasText: "Design System Clarity Review" });
      await expect(detail).toBeVisible();
      await expect(detail).toContainText("bycoda");
      await expect(detail).toContainText("main");
      await expect(detail).toContainText("Codex");
      expect(await row.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      expect(
        await page
          .locator('[data-session-card="row-long"]')
          .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      ).toBe(true);
      await mkdir(evidence, { recursive: true });
      await page.screenshot({
        path: path.join(evidence, `${light ? "light" : "dark"}-${width}-detail.png`),
      });
      await page.keyboard.press("Escape");
      await title.evaluate((node) => (node as HTMLElement).blur());
      await page.mouse.move(width - 20, 760);
      await expect(detail).not.toBeVisible();
      await page.screenshot({
        path: path.join(evidence, `${light ? "light" : "dark"}-${width}-rows.png`),
      });
      await row.hover();
      await expect(detail).toBeVisible();
      await page.setViewportSize({ width: width - 1, height: 800 });
      await expect(detail).not.toBeVisible();
    });
  }
}

for (const density of ["compact", "standard", "detailed"]) {
  test(`${density} shows interrupted warning`, async ({ page }) => {
    await page.goto(`/tests/browser/sessions/session-row-layout.html?density=${density}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator('[data-session-card="row-multi"]')).toContainText("Interrupted");
  });
}

test("global and recent lists show interrupted warning", async ({ page }) => {
  await page.goto("/tests/browser/sessions/session-row-layout.html?global", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator('[data-session-card="row-multi"]')).toContainText("Interrupted");
  await page.goto("/tests/browser/sessions/session-row-layout.html?recent-row", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("button", { name: /Design System Clarity Review.*Interrupted/i }),
  ).toBeVisible();
});

for (const density of ["compact", "detailed"]) {
  test(`${density} keeps row titles and provider identity within the sidebar`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 800, height: 800 });
    await page.goto(`/tests/browser/sessions/session-row-layout.html?density=${density}`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    const row = page.locator('[data-session-card="row-long"]');
    await expect(row).toBeVisible({ timeout: 90_000 });
    await expect(row.locator("[data-session-select]")).toContainText(
      "A deliberately very long conversation title",
    );
    await expect(row.locator("[data-session-provider]")).toHaveCount(1);
    expect(await row.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: path.join(evidence, `dark-800-${density}.png`) });
  });
}

for (const light of [false, true]) {
  for (const width of [1280, 800]) {
    test(`Last Sessions keeps global list and targets selected checkout at ${width} ${light ? "light" : "dark"}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 800 });
      await page.goto(
        `/tests/browser/sessions/session-row-layout.html?global&${light ? "light" : "dark"}`,
        {
          waitUntil: "domcontentloaded",
        },
      );
      const demo = page.locator('[data-session-card="row-demo"]');
      await expect(demo).toBeVisible();
      await expect(demo).toHaveAttribute("data-ground");
      await expect(page.locator('[data-session-card="row-old"]')).toHaveCount(0);
      const main = page.locator('[data-session-card="row-multi"]');
      await expect(main).toBeVisible();
      await expect(main).toHaveAttribute("data-ground");
      await demo.locator("[data-session-select]").click();
      await expect(page.getByRole("status", { name: "Selected Git checkout" })).toHaveText(
        "/fixture/demo-repo-worktree",
      );
      await expect(page.getByRole("status", { name: "Last Sessions mode" })).toHaveText("true");
      await expect(main).toBeVisible();
      await main.locator("[data-session-select]").focus();
      const detail = page
        .locator('[role="tooltip"]')
        .filter({ hasText: "Design System Clarity Review" });
      await expect(detail).toBeVisible();
      await mkdir(evidence, { recursive: true });
      await page.screenshot({
        path: path.join(evidence, `${light ? "light" : "dark"}-${width}-global-detail.png`),
      });
      await page.keyboard.press("Escape");
      await main.locator("[data-session-select]").evaluate((node) => (node as HTMLElement).blur());
      await page.mouse.move(width - 10, 750);
      const tabs = page.locator('aside [role="tablist"][aria-label="Workspace"]');
      await tabs.getByRole("tab", { name: /^Changes(,|$)/ }).click();
      await expect
        .poll(() =>
          page.evaluate(() =>
            (
              window as unknown as { __fixtureGitCalls: { command: string; cwd: string }[] }
            ).__fixtureGitCalls.some(
              (call) =>
                call.command === "git_diff_index" && call.cwd === "/fixture/demo-repo-worktree",
            ),
          ),
        )
        .toBe(true);
      await expect(page.getByText("No uncommitted changes", { exact: true })).toBeVisible();
      await expect(page.getByText("This view could not be displayed", { exact: true })).toHaveCount(
        0,
      );
      await page.screenshot({
        path: path.join(evidence, `${light ? "light" : "dark"}-${width}-global-changes.png`),
      });
      await tabs.getByRole("tab", { name: /^Sessions(,|$)/ }).click();
      await expect(demo).toBeVisible();
      await main.locator("[data-session-select]").click();
      await expect(page.getByRole("status", { name: "Selected Git checkout" })).toHaveText(
        "/fixture/bycoda",
      );
      await expect(page.getByRole("status", { name: "Last Sessions mode" })).toHaveText("true");
      await expect(demo).toBeVisible();
      await page.mouse.move(width - 10, 750);
      await page.screenshot({
        path: path.join(evidence, `${light ? "light" : "dark"}-${width}-global-list.png`),
      });
    });
  }
}

test("compact Last Sessions button opens workspace", async ({ page }) => {
  await page.goto("/tests/browser/sessions/session-row-layout.html", {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("button", { name: "Last sessions", exact: true }).click();
  await expect(page.locator('[data-session-card="row-demo"]')).toBeVisible();
  await expect(page.getByRole("status", { name: "Last Sessions mode" })).toHaveText("true");
});

for (const light of [false, true]) {
  test(`global empty/loading/error states preserve truthful rows in ${light ? "light" : "dark"}`, async ({
    page,
  }) => {
    for (const width of [1280, 800]) {
      await page.setViewportSize({ width, height: 800 });
      for (const state of ["empty", "loading", "error"]) {
        await page.goto(
          `/tests/browser/sessions/session-row-layout.html?global&${state}&${light ? "light" : "dark"}`,
          { waitUntil: "domcontentloaded" },
        );
        if (state === "empty")
          await expect(
            page.getByText("No sessions in the last 7 days", { exact: true }),
          ).toBeVisible();
        if (state === "loading")
          await expect(page.getByText("Loading conversations…", { exact: true })).toBeVisible();
        if (state === "error") {
          await expect(page.getByRole("alert")).toContainText("Couldn’t load sessions");
          await expect(page.locator('[data-session-card="row-demo"]')).toBeVisible();
          await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
        }
        await page.screenshot({
          path: path.join(evidence, `${light ? "light" : "dark"}-${width}-global-${state}.png`),
        });
      }
    }
  });
}

for (const light of [false, true]) {
  for (const width of [1280, 800]) {
    test(`expanded rail Last Sessions opens and project choice exits ${width} ${light ? "light" : "dark"}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/sessions/session-row-layout.html?wide&${light ? "light" : "dark"}`,
        {
          waitUntil: "domcontentloaded",
        },
      );
      const lastSessions = page
        .getByRole("button", { name: "Last sessions", exact: true })
        .filter({ hasText: /^Last sessions$/ });
      await lastSessions.click();
      await expect(lastSessions).toHaveAttribute("aria-current", "page");
      await expect(
        page.getByRole("button", { name: "Last sessions", exact: true, expanded: true }),
      ).toBeVisible();
      await expect(page.locator('[data-session-card="row-demo"]')).toBeVisible();
      await expect(page.getByRole("status", { name: "Last Sessions mode" })).toHaveText("true");
      await page.screenshot({
        path: path.join(evidence, `${light ? "light" : "dark"}-${width}-wide-navigation.png`),
      });
      const project = page.locator('[data-project-path="/fixture/bycoda"] button').first();
      await project.click();
      await expect(page.getByRole("status", { name: "Last Sessions mode" })).toHaveText("false");
      await expect(page.locator('[data-session-card="row-demo"]')).toHaveCount(0);
      await expect(page.locator('[data-session-card="row-multi"]')).not.toHaveAttribute(
        "data-ground",
      );
    });
  }
}

for (const light of [false, true]) {
  for (const width of [1280, 800]) {
    test(`recent row exposes no pin and preserves title and age at ${width} ${light ? "light" : "dark"}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/sessions/session-row-layout.html?recent-row&${light ? "light" : "dark"}&${width === 800 ? "narrow" : "normal"}`,
        { waitUntil: "domcontentloaded" },
      );
      const row = page.getByRole("listitem").first();
      const open = row.locator("button").first();
      const age = open.locator(".tabular-nums").last();
      await open.hover();
      await expect(row.getByRole("button", { name: /Pin session|Unpin session/ })).toHaveCount(0);
      await expect(age).toBeVisible();
      expect(await row.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await open.focus();
      await page.keyboard.press("Shift+F10");
      await expect(page.getByRole("menuitem", { name: /^(Pin|Unpin)$/ })).toHaveCount(0);
      await page.keyboard.press("Escape");
      const recentEvidence = path.resolve("temp/verification/2026-11-11-last-sessions");
      await mkdir(recentEvidence, { recursive: true });
      await page.screenshot({
        path: path.join(recentEvidence, `${light ? "light" : "dark"}-${width}-recent.png`),
      });
      await open.click();
      await expect(page.getByRole("status", { name: "Pin operations" })).toHaveText("0");
    });
  }
}

for (const light of [false, true]) {
  for (const width of [1280, 800]) {
    test(`Last Sessions new session asks for project at ${width} ${light ? "light" : "dark"}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/sessions/session-row-layout.html?global&${width === 1280 ? "wide" : "compact"}&${light ? "light" : "dark"}`,
        { waitUntil: "domcontentloaded" },
      );
      const create = page.getByRole("button", { name: "New session", exact: true });
      await create.click();
      const dialog = page.getByRole("dialog", { name: "Choose a project for the new session" });
      const search = dialog.getByRole("combobox", { name: "Search projects" });
      await expect(search).toBeFocused();
      // Options: "No project" (default folder) plus the two fixture projects.
      await expect(dialog.getByRole("option")).toHaveCount(3);
      await expect(page.getByRole("status", { name: "Created sessions" })).toHaveText("0");
      const evidence = path.resolve("temp/verification/2026-11-04-new-session-project");
      await mkdir(evidence, { recursive: true });
      await page.screenshot({
        path: path.join(evidence, `${light ? "light" : "dark"}-${width}-project-picker.png`),
      });
      await search.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(create).toBeFocused();
      await expect(page.getByRole("status", { name: "Created sessions" })).toHaveText("0");
      await create.click();
      await search.fill("no-such-project");
      await expect(dialog.getByRole("option")).toHaveCount(0);
      await search.press("Enter");
      await expect(page.getByRole("status", { name: "Created sessions" })).toHaveText("0");
      await search.fill("demo");
      await expect(dialog.getByRole("option")).toHaveCount(1);
      await search.press("Enter");
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("status", { name: "Created sessions" })).toHaveText("1");
      await expect(page.getByRole("status", { name: "Created project" })).toHaveText(
        "/fixture/demo-repo",
      );
      await expect(page.getByRole("status", { name: "Last Sessions mode" })).toHaveText("true");
    });
  }
}

test("new session accepts explicit current project and preserves project-local direct creation", async ({
  page,
}) => {
  await page.goto("/tests/browser/sessions/session-row-layout.html?global", {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await page.getByRole("option", { name: /^bycoda / }).click();
  await expect(page.getByRole("status", { name: "Created sessions" })).toHaveText("1");
  await expect(page.getByRole("status", { name: "Created project" })).toHaveText("/fixture/bycoda");
  await page.goto("/tests/browser/sessions/session-row-layout.html", {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Created sessions" })).toHaveText("1");
});

test("new session retains selector and error when selected project becomes unavailable", async ({
  page,
}) => {
  await page.goto("/tests/browser/sessions/session-row-layout.html?global&create-error", {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("button", { name: "New session", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Choose a project for the new session" });
  await dialog.getByRole("option", { name: /demo-repo / }).click();
  await expect(
    dialog.getByText("This project is no longer available.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status", { name: "Created sessions" })).toHaveText("0");
  await expect(dialog.getByRole("combobox")).toBeEnabled();
});

for (const density of ["standard", "detailed"]) {
  for (const light of [false, true]) {
    for (const width of [1280, 800]) {
      test(`session row space ${density} at ${width} in ${light ? "light" : "dark"}`, async ({
        page,
      }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.setViewportSize({ width, height: 800 });
        await page.goto(
          `/tests/browser/sessions/session-row-layout.html?density=${density}&${light ? "light" : "dark"}`,
          { waitUntil: "domcontentloaded" },
        );
        const row = page.locator('[data-session-card="row-working"]');
        const header = row.locator("[data-session-row-project]");
        const title = row.locator("[data-session-select]");
        const branch = row.locator("[data-session-row-branch]");
        const providers = row.locator("[data-session-row-model]");
        const archive = header.getByRole("button", { name: /^Archive / });
        const remove = header.getByRole("button", { name: /^Delete / });
        await expect(row).toBeVisible();
        await expect(header.locator("[data-session-row-actions]")).toHaveCount(1);
        await expect(archive).toHaveCount(1);
        await expect(remove).toHaveCount(1);
        await expect(branch.locator("svg")).toHaveCount(0);
        await expect(branch).toContainText("feature/voice");
        await expect(header).toContainText("Working");
        const projectSlot = header.locator("[data-session-project-slot]");
        const projectMark = projectSlot.locator("[data-session-project-mark]");
        const pin = projectSlot.getByRole("button", { name: "Pin", exact: true });
        await expect(pin).toHaveCount(1);
        await expect(header.getByRole("button", { name: "Pin", exact: true })).toHaveCount(1);
        const icon = providers.locator("svg, img").first();
        await expect(icon).toHaveCSS("width", "16px");
        await expect(icon).toHaveCSS("height", "16px");

        await page.mouse.move(width - 20, 760);
        await expect(projectMark).toHaveCSS("visibility", "visible");
        const resting = await Promise.all([
          title.boundingBox(),
          branch.boundingBox(),
          providers.boundingBox(),
        ]);
        const spaceEvidence = path.resolve("temp/verification/2026-11-04-session-row-space");
        await mkdir(spaceEvidence, { recursive: true });
        await writeFile(
          path.join(spaceEvidence, "README.md"),
          "# Session row space verification\n\nIsolated session-row-layout browser fixture. Captures cover standard/detailed density, light/dark themes, and 1280/800 viewports. Resting and hover captures exercise header actions and stable title/footer geometry. No live provider, native installation, or remote acceptance is established. Reuse by running session-row-layout.spec.ts with the session row space test filter.\n",
        );
        const captureName = `${light ? "light" : "dark"}-${width}-${density}`;
        await row.screenshot({ path: path.join(spaceEvidence, `${captureName}-rest.png`) });

        const checkStableContent = async () => {
          const current = await Promise.all([
            title.boundingBox(),
            branch.boundingBox(),
            providers.boundingBox(),
          ]);
          for (let index = 0; index < current.length; index += 1) {
            expect(current[index]).not.toBeNull();
            expect(resting[index]).not.toBeNull();
            for (const dimension of ["x", "y", "width", "height"] as const) {
              expect(current[index]![dimension]).toBeCloseTo(resting[index]![dimension], 1);
            }
          }
          const [headerBox, archiveBox, deleteBox, titleBox] = await Promise.all([
            header.boundingBox(),
            archive.boundingBox(),
            remove.boundingBox(),
            title.boundingBox(),
          ]);
          expect(archiveBox!.y).toBeGreaterThanOrEqual(headerBox!.y);
          expect(deleteBox!.y + deleteBox!.height).toBeLessThanOrEqual(titleBox!.y + 1);
          expect(archiveBox!.x + archiveBox!.width).toBeLessThanOrEqual(deleteBox!.x + 1);
          await expect(header).toContainText("Working");
          for (const candidate of [row, page.locator('[data-session-card="row-long"]')]) {
            expect(
              await candidate.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
            ).toBe(true);
          }
        };
        await row.hover();
        await expect(projectMark).toHaveCSS("visibility", "hidden");
        await expect(pin).toHaveCSS("opacity", "1");
        const [slotBox, pinBox] = await Promise.all([projectSlot.boundingBox(), pin.boundingBox()]);
        expect(pinBox!.x).toBeCloseTo(slotBox!.x, 1);
        expect(pinBox!.width).toBeCloseTo(slotBox!.width, 1);
        await expect(archive).toHaveCSS("opacity", "1");
        await expect(remove).toHaveCSS("opacity", "1");
        await checkStableContent();
        await row.screenshot({ path: path.join(spaceEvidence, `${captureName}-hover.png`) });
        await page.mouse.move(width - 20, 760);
        await archive.focus();
        await expect(archive).toBeFocused();
        await expect(remove).toHaveCSS("opacity", "1");
        await checkStableContent();
      });
    }
  }
}

for (const light of [false, true]) {
  for (const width of [1280, 800]) {
    test(`status words collapse on interaction at ${width} in ${light ? "light" : "dark"}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 800 });
      await page.goto(
        `/tests/browser/sessions/session-row-layout.html?${light ? "light" : "dark"}`,
        {
          waitUntil: "networkidle",
        },
      );
      const row = page.locator('[data-session-card="row-multi"]');
      const label = row.locator(".session-row-status-label");
      const header = row.locator("[data-session-row-project]");
      await page.mouse.move(width - 20, 760);
      await expect(label).toHaveText("Interrupted");
      const resting = await label.boundingBox();
      expect(resting!.width).toBeGreaterThan(30);
      const output = path.resolve("temp/verification/2026-11-04-session-status-icons");
      await mkdir(output, { recursive: true });
      await writeFile(
        path.join(output, "README.md"),
        "Current-source fixture: status words collapse on hover/focus, retain accessible text and restore on exit. Light/dark, 1280/800. No installed/native acceptance.",
      );
      await row.screenshot({
        path: path.join(output, `${light ? "light" : "dark"}-${width}-rest.png`),
      });
      await row.hover();
      await expect(label).toHaveCSS("clip-path", "inset(50%)");
      expect((await label.boundingBox())!.width).toBe(1);
      await expect(header.locator("svg").last()).toBeVisible();
      await expect(header).toContainText("Interrupted");
      await row.screenshot({
        path: path.join(output, `${light ? "light" : "dark"}-${width}-hover.png`),
      });
      await page.mouse.move(width - 20, 760);
      await expect(label).toHaveCSS("clip-path", "none");
      await row.getByRole("button", { name: /^Archive / }).focus();
      await expect(label).toHaveCSS("clip-path", "inset(50%)");
      await row.getByRole("button", { name: /^Archive / }).evaluate((element) => element.blur());
      await expect(label).toHaveCSS("clip-path", "none");
    });
  }
}

for (const light of [false, true]) {
  for (const width of [1280, 800]) {
    test(`two session rows remain unobscured at ${width} in ${light ? "light" : "dark"}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 800 });
      await page.goto(
        `/tests/browser/sessions/session-row-layout.html?two-rows&${light ? "light" : "dark"}`,
        { waitUntil: "networkidle" },
      );
      const rows = page.locator("[data-session-card]");
      await expect(rows).toHaveCount(2);
      const scroller = page.locator(".sidebar-session-scroll");
      expect(
        await scroller.evaluate((element) => element.scrollHeight <= element.clientHeight),
      ).toBe(true);
      const last = rows.last();
      await expect(last.locator("[data-session-row-branch]")).toBeVisible();
      await expect(last.locator("[data-session-row-model]")).toBeVisible();
      expect(
        await scroller.evaluate((element) => getComputedStyle(element, "::after").content),
      ).toBe("none");
      const output = path.resolve("temp/verification/2026-11-04-session-list-last-row");
      await mkdir(output, { recursive: true });
      await writeFile(
        path.join(output, "README.md"),
        "Current-source two-row sidebar fixture. Verifies no overflow and no trailing layer obscures the final branch/provider row. Light/dark at 1280/800. No native installation acceptance.",
      );
      await page.mouse.move(width - 20, 760);
      await scroller.screenshot({
        path: path.join(output, `${light ? "light" : "dark"}-${width}.png`),
      });
    });
  }
}

const statusEvidence = path.resolve("temp/verification/waiting-status");
for (const light of [false, true]) {
  for (const width of [1280, 800]) {
    test(`waiting rows show Waiting, working rows show Working at ${width} ${light ? "light" : "dark"}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 700 });
      await page.goto(
        `/tests/browser/sessions/session-row-layout.html?statuses&${light ? "light" : "dark"}`,
      );
      for (const id of ["status-wait-commands", "status-wait-delegated", "status-wait-pr"]) {
        const status = page.locator(`[data-session-card="${id}"] [data-session-working-status]`);
        await expect(status).toHaveAttribute("data-session-waiting", "");
        await expect(status).toContainText("Waiting");
      }
      const working = page.locator(
        '[data-session-card="status-working"] [data-session-working-status]',
      );
      await expect(working).toContainText("Working");
      await expect(working).not.toHaveAttribute("data-session-waiting", "");
      await expect(
        page.locator('[data-session-card="status-wait-pr"] [data-session-working-status]'),
      ).toHaveAttribute("title", /owner\/repo#12/);
      await mkdir(statusEvidence, { recursive: true });
      await page.screenshot({
        path: path.join(statusEvidence, `${light ? "light" : "dark"}-${width}.png`),
      });
    });
  }
}

const settleEvidence = path.resolve("temp/verification/2026-11-08-session-settle");
for (const light of [false, true]) {
  for (const width of [1280, 800]) {
    test(`settled sessions file on a collapsed Settled group at ${width} ${light ? "light" : "dark"}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 700 });
      await page.goto(
        `/tests/browser/sessions/session-row-layout.html?settled&${light ? "light" : "dark"}`,
      );
      const shelf = page.locator("[data-settled-sessions]");
      await expect(shelf).toContainText("Settled");
      await expect(shelf).toHaveAttribute("data-section-collapsed", "");
      await expect(page.locator('[data-session-card="row-long"]')).toHaveCount(0);
      await expect(page.locator('[data-session-card="row-working"]')).toBeVisible();
      await mkdir(settleEvidence, { recursive: true });
      const name = `${light ? "light" : "dark"}-${width}`;
      await page.screenshot({ path: path.join(settleEvidence, `${name}-collapsed.png`) });
      await shelf.getByRole("button").first().click();
      await expect(shelf).not.toHaveAttribute("data-section-collapsed", "");
      await expect(page.locator('[data-session-card="row-long"]')).toBeVisible();
      await page.screenshot({ path: path.join(settleEvidence, `${name}-open.png`) });
    });
  }
}

for (const theme of ["light", "dark"]) {
  for (const width of [1280, 800]) {
    test(`global Last sessions navigation only ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/sessions/session-row-layout.html?global&${theme}`, {
        waitUntil: "domcontentloaded",
      });
      const row = page.locator('[data-session-card="row-demo"]');
      const open = row.locator("[data-session-select]");
      await expect(row).toBeVisible();
      await expect(row.getByRole("button")).toHaveCount(1);
      await page.screenshot({
        path: `temp/verification/2026-11-11-sidebar/last-sessions-${theme}-${width}-rest.png`,
        animations: "disabled",
      });
      await open.hover();
      await expect(row.getByRole("button")).toHaveCount(1);
      await open.focus();
      await open.press("Shift+F10");
      await expect(page.getByRole("menu")).toHaveCount(0);
      await open.click({ button: "right" });
      await expect(page.getByRole("menu")).toHaveCount(0);
      await page.screenshot({
        path: `temp/verification/2026-11-11-sidebar/last-sessions-${theme}-${width}-hover.png`,
        animations: "disabled",
      });
      await open.click();
      await expect(page.getByRole("status", { name: "Selected session" })).toHaveText("row-demo");
      await expect(page.getByRole("status", { name: "Pin operations" })).toHaveText("0");
    });
  }
}
