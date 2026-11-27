import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PANE_MATRIX, expectLayoutContracts, openPane } from "../support/uiLayoutAssertions";

const evidence = path.resolve("temp/verification/2026-11-04-last-sessions-workspace");
const titleEvidence = path.resolve("temp/verification/2026-11-04-session-titles");
for (const [theme, width] of ["dark", "light"].flatMap((theme) =>
  [1280, 800].map((width) => [theme, width] as const),
)) {
  test(`remote project and session markers in ${theme} at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(
      `/tests/browser/sessions/session-row-layout.html?remote-header&legacy-remote-label&global&wide&project-tooltip&${theme}`,
    );
    const project = page.locator(
      '[data-project-path="remote://fixture-office/fixture/bycoda"] [data-project-primary]',
    );
    await expect(project.locator("[data-truncate]").first()).toHaveText("bycoda");
    await expect(project.locator("svg.lucide-server")).toBeVisible();
    const session = page.locator('[data-session-card="row-multi"]');
    await expect(session.locator("[data-session-row-project] [data-truncate]")).toHaveText(
      "bycoda",
    );
    const marker = session.getByRole("img", { name: "On another machine" });
    await expect(marker).toBeVisible();
    await expect(marker.locator("svg.lucide-server")).toBeVisible();
    await expect(
      marker.locator("+ [data-tooltip-wrap] [data-session-provider=codex]"),
    ).toBeVisible();
    const directory = path.resolve("temp/verification/project-row-tooltip");
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "README.md"),
      "# Project and session detail tooltips\n\nIsolated Chromium fixture at 1280 and 800 px, in light and dark.\n",
    );
    await page.screenshot({ path: path.join(directory, `${theme}-${width}-rows.png`) });
    await project.hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip.getByText("bycoda", { exact: true })).toBeVisible();
    await expect(tooltip.getByText("Office Mac", { exact: true })).toBeVisible();
    await expect(tooltip.getByText("/fixture/bycoda", { exact: true })).toBeVisible();
    await expect(tooltip.getByText("Not connected", { exact: true })).toBeVisible();
    await expect(tooltip.getByText("Working", { exact: true })).toBeVisible();
    await expect(tooltip.locator("svg.lucide-server")).toBeVisible();
    await expect(project).toHaveAttribute("aria-describedby", (await tooltip.getAttribute("id"))!);
    await page.screenshot({ path: path.join(directory, `${theme}-${width}-project.png`) });
    await project.focus();
    await page.keyboard.press("Escape");
    await expect(tooltip).toHaveCount(0);

    await session.hover();
    // The detail card puts the last-activity age beside the status instead of labelling it.
    await expect(tooltip).toContainText(/StatusInterrupted\s*2m/);
    await page.screenshot({ path: path.join(directory, `${theme}-${width}-session.png`) });

    await page.locator('[data-project-path="/fixture/demo-repo"] [data-project-primary]').hover();
    await expect(tooltip.getByText("/fixture/demo-repo", { exact: true })).toBeVisible();
  });
}

for (const theme of ["dark", "light"]) {
  test(`compact projects menu shows a row detail in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto(
      `/tests/browser/sessions/session-row-layout.html?remote-header&legacy-remote-label&project-tooltip&${theme}`,
    );
    await page.getByRole("button", { name: "Projects and groups", exact: true }).click();
    const project = page
      .locator("[data-project-navigation-flyout]")
      .locator(
        '[data-project-path="remote://fixture-office/fixture/bycoda"] [data-project-primary]',
      );
    await expect(project).toBeVisible();
    const tooltip = page.getByRole("tooltip").filter({ hasText: "/fixture/bycoda" });
    await expect(tooltip).toHaveCount(0);
    await project.hover();
    await expect(tooltip.getByText("Office Mac", { exact: true })).toBeVisible();
    await expect(tooltip.getByText("Working", { exact: true })).toBeVisible();
    const directory = path.resolve("temp/verification/project-row-tooltip");
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, `${theme}-800-projects-menu.png`) });
  });

  test(`managed session mark in ${theme}`, async ({ page }) => {
    const directory = path.resolve("temp/verification/managed-session-mark");
    await mkdir(directory, { recursive: true });
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const surface of ["project", "global", "recent-row"]) {
      await page.goto(
        `/tests/browser/sessions/session-row-layout.html?managed&${theme}&${surface}`,
        { waitUntil: "domcontentloaded" },
      );
      const row =
        surface === "recent-row"
          ? page.getByRole("button", { name: /Sesli Asistan/ })
          : page.locator('[data-session-card="row-working"]');
      const mark = row.locator("[data-assistant-managed]");
      await expect(mark).toBeVisible();
      const label = (await mark.getAttribute("aria-label")) ?? "";
      expect(label).toMatch(/^(Managed session|Managed by .+)$/);
      await expect(mark.locator('[aria-hidden="true"]')).toHaveCSS("mask-image", /^url\(/);
      await row.screenshot({ path: path.join(directory, `${theme}-${surface}.png`) });
      await mark.hover();
      await expect(page.getByRole("tooltip", { name: label, exact: true })).toBeVisible();
    }
  });
}

for (const light of [false, true])
  for (const width of [1280, 800])
    test(`workspace toolbar overflow ${light ? "light" : "dark"} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/sessions/session-row-layout.html?${light ? "light" : "dark"}`,
      );
      const pane = page.locator('[data-side-pane="workspace"]');
      const header = pane.locator("[data-workspace-header]");
      await pane.evaluate((element) => element.style.setProperty("width", "400px", "important"));
      const expectedHeight = await header.evaluate(
        (element) => element.getBoundingClientRect().height,
      );
      await pane.evaluate((element) => element.style.setProperty("width", "270px", "important"));
      const directory = path.resolve("temp/verification/2026-11-17-workspace-overflow");
      await mkdir(directory, { recursive: true });
      await header.screenshot({
        path: path.join(directory, `${light ? "light" : "dark"}-${width}.png`),
      });
      expect(await header.evaluate((element) => element.getBoundingClientRect().height)).toBe(
        expectedHeight,
      );
      await header.getByRole("button", { name: "More actions", exact: true }).click();
      await expect(
        page.getByRole("menuitem", { name: "Search sessions", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("menuitemcheckbox", { name: "Select sessions", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("menuitemcheckbox", { name: "Filter sessions", exact: true }),
      ).toBeVisible();
      await page.getByRole("menu").screenshot({
        path: path.join(directory, `${light ? "light" : "dark"}-${width}-menu.png`),
      });
      await page.getByRole("menuitem", { name: "Search sessions", exact: true }).click();
      await expect(
        header.getByRole("combobox", { name: "Search sessions", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await header.getByRole("button", { name: "More actions", exact: true }).click();
      await page.getByRole("menuitemcheckbox", { name: "Select sessions", exact: true }).click();
      await expect(pane.getByRole("toolbar", { name: "Selected sessions" })).toBeVisible();
      await header.getByRole("button", { name: "More actions", exact: true }).click();
      await page.getByRole("menuitemcheckbox", { name: "Filter sessions", exact: true }).click();
      await expect(page.getByRole("menu", { name: "Filter sessions", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await header.getByRole("button", { name: "New session", exact: true }).click();
      await expect(page.getByLabel("Created sessions", { exact: true })).toHaveText("1");
      await pane.evaluate((element) => element.style.setProperty("width", "400px", "important"));
      await expect(header.getByRole("button", { name: "More actions", exact: true })).toBeHidden();
      await expect(
        header.getByRole("button", { name: "Filter sessions", exact: true }),
      ).toBeVisible();
    });
for (const light of [false, true])
  for (const width of [1280, 800])
    test(`open session search fills the header row ${light ? "light" : "dark"} ${width}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/sessions/session-row-layout.html?${light ? "light" : "dark"}`,
      );
      const pane = page.locator('[data-side-pane="workspace"]');
      const header = pane.locator("[data-workspace-header]");
      await pane.evaluate((element) => element.style.setProperty("width", "520px", "important"));
      const height = await header.evaluate((element) => element.getBoundingClientRect().height);
      await header.getByRole("button", { name: "Search sessions", exact: true }).click();
      await expect(
        header.getByRole("combobox", { name: "Search sessions", exact: true }),
      ).toBeFocused();
      const shell = header.locator("[data-expanded]");
      // The field used to stay at its three-button minimum while the row had free room.
      await expect
        .poll(() => shell.evaluate((element) => element.getBoundingClientRect().width))
        .toBeGreaterThan(180);
      expect(await header.evaluate((element) => element.getBoundingClientRect().height)).toBe(
        height,
      );
      const directory = path.resolve("temp/verification/2026-11-27-sidebar-search-width");
      await mkdir(directory, { recursive: true });
      await header.screenshot({
        path: path.join(directory, `${light ? "light" : "dark"}-${width}.png`),
      });
    });
for (const light of [false, true])
  for (const width of [1280, 800])
    for (const rail of ["compact", "wide", "hidden"])
      test(`remote project header ${light ? "light" : "dark"} ${width} ${rail}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(
          `/tests/browser/sessions/session-row-layout.html?remote-header&remote-settle&worktree-picker&wide-workspace&${light ? "light" : "dark"}${rail === "wide" ? "&wide" : rail === "hidden" ? "&no-rail" : ""}`,
        );
        const header = page.locator("[data-workspace-header]");
        await expect(header).toContainText("bycoda-cloud");
        await expect(header.getByText("Workspace", { exact: true })).toHaveCount(0);
        const machine = header.getByRole("button", {
          name: "Refresh sessions from Office Mac",
          exact: true,
        });
        await expect(machine).toBeVisible();
        await expect(machine).toBeEnabled();
        await machine.hover();
        await expect(page.getByRole("tooltip")).toContainText("Office Mac");
        await machine.click();
        await expect(machine).toBeEnabled();
        const picker = header.getByRole("button", { name: "Switch worktree" });
        await expect(picker).toContainText("All worktrees");
        await expect(
          machine.locator("xpath=following::button[@aria-label='Switch worktree'][1]"),
        ).toBeVisible();
        await picker.click();
        const worktrees = page.getByRole("dialog", { name: "Worktrees" });
        await expect(worktrees.getByRole("option", { name: "All worktrees" })).toBeVisible();
        const directory = path.resolve("temp/verification/remote-worktree-picker");
        await mkdir(directory, { recursive: true });
        await writeFile(
          path.join(directory, "README.md"),
          "# Remote worktree picker\n\nIsolated Chromium fixture with two server worktrees.\n",
        );
        await page.screenshot({
          path: path.join(directory, `${light ? "light" : "dark"}-${width}-${rail}.png`),
        });
        await worktrees.getByRole("option", { name: "main" }).click();
        await expect(picker).toContainText("main");
      });
for (const light of [true, false])
  for (const width of [800, 1280])
    test(`sessions no match visual ${light ? "light" : "dark"} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/sessions/session-row-layout.html?${light ? "light" : "dark"}`,
      );
      // The default pane is narrow, so the session tools live in "More actions".
      await page.getByRole("button", { name: "More actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Search sessions", exact: true }).click();
      await page
        .getByRole("combobox", { name: "Search sessions", exact: true })
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
          await expect(page.getByText("No sessions", { exact: true })).toBeVisible();
        if (state === "loading")
          await expect(page.getByRole("status", { name: "Loading…" })).toBeVisible();
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
        `/tests/browser/sessions/session-row-layout.html?wide&rail-header&${light ? "light" : "dark"}`,
        {
          waitUntil: "domcontentloaded",
        },
      );
      const lastSessions = page
        .getByRole("button", { name: "Last sessions", exact: true })
        .filter({ hasText: /^Last sessions$/ });
      await lastSessions.click();
      await expect(lastSessions).toHaveAttribute("aria-current", "page");
      const header = page.locator("[data-rail-section-header]").filter({ has: lastSessions });
      const toggle = header.getByRole("button", { name: "Last sessions", expanded: true });
      const count = header.getByRole("button", { name: /^Sessions shown:/ });
      const options = header.getByRole("button", { name: "Last sessions section options" });
      await expect(toggle).toBeVisible();
      await expect(count).toBeVisible();
      const headerEvidence = path.resolve("temp/verification/last-sessions-header");
      const capture = (state: string) =>
        header.screenshot({
          path: path.join(headerEvidence, `${light ? "light" : "dark"}-${width}-${state}.png`),
        });
      await count.hover();
      await capture("selected-hover");
      await expect(header).not.toHaveCSS("background-image", "none");
      for (const control of [lastSessions, toggle, count, options]) {
        await control.hover();
        await expect(control).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      }
      await lastSessions.focus();
      await page.keyboard.press("Tab");
      await expect(count).toBeFocused();
      await expect(count).toHaveCSS("outline-style", "solid");
      await expect(count).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await capture("keyboard-focus");
      await page.keyboard.press("Enter");
      await expect(count).toHaveAttribute("aria-expanded", "true");
      await expect(count).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await page.keyboard.press("Escape");
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
      // Last Sessions has no current project, so its new-session action is the project choice.
      const create = page.getByRole("button", { name: "Choose project", exact: true });
      await create.click();
      const dialog = page.getByRole("dialog", { name: "New session in" });
      const search = dialog.getByRole("combobox", { name: "Search projects" });
      await expect(search).toBeFocused();
      // Options: "No project" (default folder) plus the two fixture projects.
      await expect(dialog.getByRole("option")).toHaveCount(3);
      await expect(page.getByRole("status", { name: "Created sessions" })).toHaveText("0");
      const evidence = path.resolve("temp/verification/new-session-button");
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
      await expect(page.getByRole("status", { name: "Last Sessions mode" })).toHaveText("false");
    });
    test(`workspace New session split button at ${width} ${light ? "light" : "dark"}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/sessions/session-row-layout.html?${width === 1280 ? "wide&wide-workspace" : "compact"}&${light ? "light" : "dark"}`,
        { waitUntil: "domcontentloaded" },
      );
      const header = page.locator("[data-workspace-header]");
      const create = header.getByRole("button", { name: "New session", exact: true });
      // The split button's arrow opens the Session actions menu; Choose project is its item.
      const choose = header.getByRole("button", { name: "Session actions", exact: true });
      const chooseItem = page.getByRole("menuitem", { name: "Choose project", exact: true });
      const dialog = page.getByRole("dialog", { name: "New session in" });
      await choose.click();
      await chooseItem.click();
      await expect(dialog).toBeVisible();
      await expect(page.getByRole("menu", { name: "Session actions" })).toHaveCount(0);
      const search = dialog.getByRole("combobox", { name: "Search projects" });
      await expect(search).toBeFocused();
      const evidence = path.resolve("temp/verification/new-session-theme");
      await mkdir(evidence, { recursive: true });
      const label = `${light ? "light" : "dark"}-${width}`;
      await page.screenshot({ path: path.join(evidence, `${label}-workspace-project-picker.png`) });
      await search.press("Escape");
      await expect(choose).toBeFocused();
      const labelText = create.getByText("New session", { exact: true });
      // The label collapses into the icon at the compact width (the width-reserving ghost stays).
      const createWidth = (await create.boundingBox())!.width;
      if (width === 1280) {
        await expect(labelText).toBeVisible();
        expect(createWidth).toBeGreaterThan(80);
      } else expect(createWidth).toBeLessThan(48);
      const icon = create.locator("svg");
      await expect(icon).toBeVisible();
      await expect(icon).toHaveAttribute("stroke", "currentColor");
      await expect(icon).toHaveCSS(
        "stroke",
        await create.evaluate((button) => getComputedStyle(button).color),
      );
      const expectTrailing = async () => {
        const headerBounds = (await header.boundingBox())!;
        const disclosureBounds = (await choose.boundingBox())!;
        const endGap =
          headerBounds.x + headerBounds.width - disclosureBounds.x - disclosureBounds.width;
        expect(endGap).toBeGreaterThanOrEqual(0);
        expect(endGap).toBeLessThanOrEqual(8);
      };
      await expectTrailing();
      await expect(create).toHaveAttribute("data-button-hierarchy", "ghost");
      await expect(choose).toHaveAttribute("data-button-hierarchy", "ghost");
      await expect(create).toHaveAttribute("data-button-tone", "accent");
      await expect(choose).toHaveAttribute("data-button-tone", "accent");
      await expect(create).not.toHaveCSS("border-start-start-radius", "0px");
      await expect(choose).not.toHaveCSS("border-start-end-radius", "0px");
      await choose.blur();
      await page.mouse.move(0, 0);
      await header.screenshot({ path: path.join(evidence, `${label}-workspace-header.png`) });
      await choose.focus();
      await choose.press("Enter");
      await chooseItem.click();
      await expect(search).toBeFocused();
      await search.press("Escape");
      await expect(choose).toBeFocused();
      await create.click({ button: "right" });
      await expect(search).toBeFocused();
      await search.fill("demo");
      await search.press("Enter");
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("status", { name: "Created project" })).toHaveText(
        "/fixture/demo-repo",
      );
      await expect(page.getByRole("status", { name: "Selected Git checkout" })).toHaveText(
        "/fixture/demo-repo",
      );
      await page.getByRole("tab", { name: "Explorer", exact: true }).click();
      await expect(header.locator("[data-session-tools]")).toHaveCount(0);
      await expectTrailing();
      await page.mouse.move(0, 0);
      await header.screenshot({ path: path.join(evidence, `${label}-explorer-header.png`) });
    });
  }
}

test("new session accepts explicit current project and preserves project-local direct creation", async ({
  page,
}) => {
  await page.goto("/tests/browser/sessions/session-row-layout.html?global", {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("button", { name: "Choose project", exact: true }).click();
  await page.getByRole("option", { name: /^bycoda/ }).click();
  await expect(page.getByRole("status", { name: "Created sessions" })).toHaveText("1");
  await expect(page.getByRole("status", { name: "Created project" })).toHaveText("/fixture/bycoda");
  await expect(page.getByRole("status", { name: "Last Sessions mode" })).toHaveText("true");
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
  await page.getByRole("button", { name: "Choose project", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New session in" });
  await dialog.getByRole("option", { name: /^demo-repo/ }).click();
  await expect(dialog.getByText("Could not create session.", { exact: true })).toBeVisible();
  // The raw reason waits behind the shared Details control.
  await dialog.getByRole("button", { name: /^Details/ }).click();
  await expect(page.getByRole("dialog", { name: /^Details/ })).toContainText(
    "This project is no longer available.",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("status", { name: "Created sessions" })).toHaveText("0");
  await expect(dialog.getByRole("combobox")).toBeEnabled();
});

for (const theme of ["light", "dark"]) {
  for (const width of [1280, 800]) {
    test(`idle session time yields to row actions in ${theme} at ${width}px`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/tests/browser/sessions/session-row-layout.html?local-bulk-settle&${theme}`);
      const row = page.locator('[data-session-card="row-long"]');
      const header = row.locator("[data-session-row-project]");
      const time = header.getByText(/^(59m|1h)$/);
      const actions = header.locator("[data-session-row-actions]");
      const yieldSlot = header.locator("[data-action-yield]");
      const evidence = path.resolve("temp/verification/sidebar-row-actions");
      const name = `${theme}-${width}`;
      await mkdir(evidence, { recursive: true });
      await page.mouse.move(width - 10, 760);
      await expect(time).toBeVisible();
      const timeBox = await time.boundingBox();
      expect(timeBox).not.toBeNull();
      await row.screenshot({ path: path.join(evidence, `${name}-rest.png`) });

      await row.hover();
      await row.screenshot({ path: path.join(evidence, `${name}-hover.png`) });
      await expect(yieldSlot).toHaveCSS("opacity", "0", { timeout: 1500 });
      for (const label of [/^Settle /, /^Archive /, /^Delete /]) {
        await expect(actions.getByRole("button", { name: label })).toBeVisible();
      }
      const actionBox = (await actions.boundingBox())!;
      // The time follows the project name; the actions take the row's trailing edge while it yields.
      const rowBox = (await row.boundingBox())!;
      expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
      expect(actionBox.x + actionBox.width).toBeGreaterThan(rowBox.x + rowBox.width - 24);

      await page.mouse.move(width - 10, 760);
      await expect(yieldSlot).toHaveCSS("opacity", "1");
      await row.locator("[data-session-select]").focus();
      await expect(yieldSlot).toHaveCSS("opacity", "0");
    });
  }
}

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
      for (const id of ["status-wait-delegated", "status-wait-pr"]) {
        const status = page.locator(`[data-session-card="${id}"] [data-session-working-status]`);
        await expect(status).toHaveAttribute("data-session-waiting", "");
        await expect(status).toContainText("Waiting");
      }
      // The turn's own background commands (and subagents) still run: that is work.
      for (const id of ["status-working", "status-wait-commands"]) {
        const working = page.locator(`[data-session-card="${id}"] [data-session-working-status]`);
        await expect(working).toContainText("Working");
        await expect(working).not.toHaveAttribute("data-session-waiting", "");
      }
      await expect(
        page.locator('[data-session-card="status-wait-commands"] [data-session-working-status]'),
      ).toHaveAttribute("aria-label", /Background commands running: 2/);
      await expect(
        page.locator('[data-session-card="status-wait-pr"] [data-session-working-status]'),
      ).toHaveAttribute("aria-label", /owner\/repo#12/);
      await mkdir(statusEvidence, { recursive: true });
      await page.screenshot({
        path: path.join(statusEvidence, `${light ? "light" : "dark"}-${width}.png`),
      });
    });
  }
}

const settleEvidence = path.resolve("temp/verification/2026-11-08-session-settle");
test("local Settle moves the row with the Host reply held and restores it on refusal", async ({
  page,
}) => {
  await page.goto("/tests/browser/sessions/session-row-layout.html?local-bulk-settle");
  const row = page.locator('[data-session-card="row-multi"]');
  await row.locator("[data-session-select]").hover();
  const button = row.getByRole("button", { name: /^Settle / });
  await expect(button).toBeVisible();
  await page.evaluate(() => {
    const host = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (
            command: string,
            args?: { method?: string },
            options?: unknown,
          ) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const invoke = host.invoke.bind(host);
    host.invoke = (command, args, options) => {
      if (command !== "remote_request" || args?.method !== "sessions.lifecycle.settle")
        return invoke(command, args, options);
      document.documentElement.dataset.settlePending = "true";
      return new Promise((_, reject) => {
        document.addEventListener(
          "refuse-settle-in-fixture",
          () => reject(new Error("Host refused")),
          { once: true },
        );
      });
    };
  });
  await button.click();
  await expect(page.locator("html")).toHaveAttribute("data-settle-pending", "true");
  await expect(row).toHaveCount(0);
  await expect(page.locator("[data-settled-sessions]")).toBeVisible();
  await expect(page.getByText("Saving…", { exact: true })).toHaveCount(0);
  await page.evaluate(() => document.dispatchEvent(new Event("refuse-settle-in-fixture")));
  await expect(row).toBeVisible();
  await expect(page.locator("[data-settled-sessions]")).toHaveCount(0);
});
test("bulk Settle includes all 258 selected remote conversations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(
    "/tests/browser/sessions/session-row-layout.html?remote-header&remote-settle&bulk-large",
  );
  const row = page.locator('[data-session-card="office-session"]');
  const select = row.locator("[data-session-select]");
  await select.hover();
  await expect(row.getByRole("button", { name: /^Settle / })).toBeVisible();
  await select.click({ modifiers: ["ControlOrMeta"] });
  const toolbar = page.getByRole("toolbar", { name: "Selected sessions" });
  await toolbar.getByRole("button", { name: "Select all", exact: true }).click();
  await expect(toolbar).toContainText("258 selected");
  await select.click({ button: "right" });
  await page
    .getByRole("menu", { name: "258 selected session actions" })
    .getByRole("menuitem", { name: "Settle", exact: true })
    .click();
  await expect(page.locator("[data-settled-sessions]")).toHaveAttribute(
    "data-section-collapsed",
    "",
  );
  await expect(page.locator("[data-session-card]")).toHaveCount(0);
});
for (const remote of [false, true]) {
  for (const theme of ["light", "dark"]) {
    for (const width of [1280, 800]) {
      test(`bulk Settle via menu and row on ${remote ? "remote" : "local"} Host (${theme} ${width})`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        const fixture = remote ? "remote-header&remote-settle&bulk" : "local-bulk-settle";
        const [first, second, unselected] = (
          remote
            ? ["office-session", "office-second", "office-third"]
            : ["row-multi", "row-long", "row-working"]
        ).map((id) => page.locator(`[data-session-card="${id}"]`));
        const selectFirst = first.locator("[data-session-select]");
        const settle = first.getByRole("button", { name: /^Settle / });
        const evidence = path.resolve("temp/verification/bulk-session-settle");
        const name = `${remote ? "remote" : "local"}-${theme}-${width}`;
        await mkdir(evidence, { recursive: true });
        for (const action of ["menu", "row"]) {
          await page.goto(`/tests/browser/sessions/session-row-layout.html?${fixture}&${theme}`);
          await selectFirst.hover();
          await expect(settle).toBeVisible();
          await selectFirst.click({ modifiers: ["ControlOrMeta"] });
          await second.locator("[data-session-select]").click({ modifiers: ["ControlOrMeta"] });
          await expect(page.getByRole("toolbar", { name: "Selected sessions" })).toContainText(
            "2 selected",
          );
          if (action === "menu") {
            await selectFirst.click({ button: "right" });
            const menuSettle = page
              .getByRole("menu", { name: "2 selected session actions" })
              .getByRole("menuitem", { name: "Settle", exact: true });
            await expect(menuSettle).toBeVisible();
            await page.screenshot({ path: path.join(evidence, `${name}-menu.png`) });
            await menuSettle.click();
          } else {
            await selectFirst.hover();
            await page.screenshot({ path: path.join(evidence, `${name}-row.png`) });
            await settle.click();
          }
          const shelf = page.locator("[data-settled-sessions]");
          await expect(first).toHaveCount(0);
          await expect(second).toHaveCount(0);
          await expect(unselected).toBeVisible();
          await shelf.getByRole("button").first().click();
          await expect(first).toBeVisible();
          await expect(second).toBeVisible();
          await shelf.getByRole("button").first().click();
        }
      });
    }
  }
}
for (const theme of ["light", "dark"]) {
  for (const width of [1280, 800]) {
    test(`remote project Settle and Un-settle ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/sessions/session-row-layout.html?remote-header&remote-settle&${theme}`,
      );
      const row = page.locator('[data-session-card="office-session"]');
      const open = row.locator("[data-session-select]");
      const settle = row.getByRole("button", { name: "Settle Remote project conversation" });
      const shelf = page.locator("[data-settled-sessions]");
      await expect(row).toBeVisible();
      await open.hover();
      await expect(settle).toBeVisible();
      const evidence = path.resolve("temp/verification/remote-project-settle");
      await mkdir(evidence, { recursive: true });
      await open.click({ button: "right" });
      const menu = page.getByRole("menu", { name: "Session actions" });
      await expect(menu.getByRole("menuitem", { name: "Settle", exact: true })).toBeVisible();
      await page.screenshot({ path: path.join(evidence, `${theme}-${width}-menu.png`) });
      await menu.getByRole("menuitem", { name: "Settle", exact: true }).click();
      await expect(row).toHaveCount(0);
      await expect(shelf).toContainText("Settled");
      await shelf.getByRole("button").first().click();
      await open.hover();
      const undo = row.getByRole("button", { name: "Un-settle Remote project conversation" });
      await expect(undo).toBeVisible();
      await page.screenshot({ path: path.join(evidence, `${theme}-${width}-shelf.png`) });
      await undo.click();
      await expect(shelf).toHaveCount(0);
      await expect(row).toBeVisible();
    });
  }
}

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
    test(`Last sessions grouping and sort ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/sessions/session-row-layout.html?global&${theme}${width === 1280 ? "&wide-workspace" : ""}`,
      );
      const list = page.locator("[data-session-list]");
      const rows = list.locator("[data-session-card]");
      const menu = page.getByRole("menu", { name: "Filter sessions" });
      const project = menu.getByRole("menuitemcheckbox", { name: "Group by project" });
      const state = menu.getByRole("menuitemcheckbox", { name: "Group by state" });
      const screenshot = (mode: string) =>
        page.screenshot({
          path: `temp/verification/last-sessions-organization/${theme}-${width}-${mode}.png`,
          animations: "disabled",
        });

      await expect(rows.first()).toHaveAttribute("data-session-card", "row-demo");
      if (width === 1280) {
        await page.getByRole("button", { name: "Filter sessions", exact: true }).click();
      } else {
        await page.getByRole("button", { name: "More actions", exact: true }).click();
        await page.getByRole("menuitemcheckbox", { name: "Filter sessions", exact: true }).click();
      }
      await expect(menu.getByRole("menuitemcheckbox").first()).toHaveText("Group by project");
      await project.click();
      await expect(project).toBeChecked();
      await expect(list.getByRole("heading")).toHaveText(["demo-repo", "bycoda"]);
      await screenshot("project-menu");

      await state.click();
      await expect(project).not.toBeChecked();
      await expect(state).toBeChecked();
      await expect(list.getByRole("heading")).toHaveText(["Idle", "Working", "Interrupted"]);
      await menu.getByRole("menuitem", { name: "Sort", exact: true }).click();
      await expect(page.getByRole("menuitemradio", { name: "Newest first" })).toBeChecked();
      await screenshot("state-sort");
      await page.getByRole("menuitemradio", { name: "Oldest first" }).click();
      await expect(rows.first()).toHaveAttribute("data-session-card", "row-long");
      await state.click();
      await expect(list.getByRole("heading")).toHaveCount(0);
      await expect(rows.first()).toHaveAttribute("data-session-card", "row-long");
      await expect(rows.last()).toHaveAttribute("data-session-card", "row-demo");
      await page.getByRole("heading", { name: "Last sessions", exact: true }).click();
      await expect(menu).toBeHidden();
      await rows.last().locator("[data-session-select]").click();
      await expect(page.getByRole("status", { name: "Selected session" })).toHaveText("row-demo");
    });

    test(`global Last sessions row actions ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/sessions/session-row-layout.html?global&global-settle&${theme}`,
        {
          waitUntil: "domcontentloaded",
        },
      );
      const row = page.locator('[data-session-card="row-demo"]');
      const open = row.locator("[data-session-select]");
      await expect(row).toBeVisible();
      await expect(row.getByRole("button", { name: /^Archive / })).toBeAttached();
      await expect(row.getByRole("button", { name: /^Delete / })).toBeAttached();
      await page.screenshot({
        path: `temp/verification/last-sessions-actions/${theme}-${width}-rest.png`,
        animations: "disabled",
      });
      await open.hover();
      await open.focus();
      await open.press("Shift+F10");
      const menu = page.getByRole("menu", { name: "Session actions" });
      await expect(menu.getByRole("menuitem", { name: "Delete" })).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: "Settle", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await open.click({ button: "right" });
      await expect(menu.getByRole("menuitem", { name: "Archive" })).toBeVisible();
      for (const label of [
        /^Pin$/,
        /^Rename/,
        /^Regenerate title$/,
        /^Copy$/,
        /^Link GitHub issue or PR/,
        /^Remind me$/,
        /^Select$/,
      ]) {
        await expect(menu.getByRole("menuitem", { name: label })).toBeVisible({ timeout: 3000 });
      }
      await page.screenshot({
        path: `temp/verification/last-sessions-actions/${theme}-${width}-menu.png`,
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await open.click();
      await expect(page.getByRole("status", { name: "Selected session" })).toHaveText("row-demo");
      await expect(page.getByRole("status", { name: "Pin operations" })).toHaveText("0");
      if (theme === "dark" && width === 1280) {
        const otherRow = page.locator('[data-session-card="row-multi"]');
        // Return to the other project while keeping the global list open.
        await otherRow.locator("[data-session-select]").click();
        expect(await page.getByRole("status", { name: "Selected session" }).textContent()).toBe(
          "row-multi",
        );
        const openMenu = () => open.click({ button: "right" });
        const item = (name: string | RegExp) => menu.getByRole("menuitem", { name });
        await openMenu();
        await item(/^Pin$/).click();
        await expect(page.getByRole("status", { name: "Pin operations" })).toHaveText("1");
        await openMenu();
        await expect(item(/^Unpin$/)).toBeVisible();
        await item(/^Rename/).click();
        const title = row.getByRole("textbox", { name: "Name" });
        await title.fill("Renamed from Last sessions");
        await title.press("Enter");
        await expect(row).toContainText("Renamed from Last sessions");
        await openMenu();
        await item(/^Regenerate title$/).click();
        await expect(row).toContainText("Restore Draft Editing in Recovered Sessions");
        await openMenu();
        await item(/^Copy$/).click();
        await expect(page.getByRole("menuitem", { name: "Copy session link" })).toBeVisible();
        await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
        await page.getByRole("menuitem", { name: /^Bycoda session ID$/i }).click();
        await expect
          .poll(() => page.evaluate(() => navigator.clipboard.readText()))
          .toBe("row-demo");
        await openMenu();
        await item(/^Link GitHub issue or PR/).click();
        const dialog = page.getByRole("dialog", { name: "Link GitHub issue or PR" });
        await dialog.getByRole("combobox").fill("https://github.com/example/demo/issues/42");
        await dialog.getByRole("button", { name: "Link", exact: true }).click();
        await expect(row).toContainText("#42");
        await openMenu();
        await item(/^Remind me$/).click();
        await page.getByRole("menuitem", { name: /^In 1 hour/ }).click();
        await expect(page.getByRole("status", { name: "Reminder target" })).toHaveText("row-demo");
        await openMenu();
        await item(/^Select$/).click();
        await expect(row).toHaveAttribute("data-session-selected", "true");
        await otherRow.locator("[data-session-select]").click();
        await expect(page.getByRole("toolbar", { name: "Selected sessions" })).toContainText(
          "2 selected",
        );
        await expect(page.getByRole("status", { name: "Selected session" })).toHaveText(
          "row-multi",
        );
        await page.getByRole("button", { name: "Clear", exact: true }).click();
      }
      await open.click({ button: "right" });
      await menu.getByRole("menuitem", { name: "Settle", exact: true }).click();
      await expect(row).toHaveCount(0);
    });
  }
}

// Runtime layout contracts for the sidebar session and project rows inside a real 320 px pane
// (the sidebar becomes the pane), in both themes at both window sizes. Destination identity stays:
// the row that lives on another machine keeps naming it at the narrow width.
for (const { theme, width } of PANE_MATRIX)
  test(`sidebar rows keep their layout contracts in a 320px pane ${theme} ${width}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(
      `/tests/browser/sessions/session-row-layout.html?remote-header&legacy-remote-label&global&wide&${theme}`,
    );
    const pane = '[role="complementary"], aside';
    await expect(page.locator('[data-session-card="row-multi"]')).toBeVisible();
    await openPane(page, { theme, width, pane });
    await expectLayoutContracts(page, {
      surface: "sidebar project and session rows (320px pane)",
      root: pane,
      // The Sessions, Explorer and Changes tabs form one segmented control.
      joined: '[role="tablist"]',
      allow: {
        overflow: [
          {
            selector: "[data-sidebar-scroll], [data-session-list-scroll]",
            reason: "The row list is the sidebar's own vertical scroller.",
          },
        ],
        gap: [
          {
            selector: '[aria-label="More actions"], [aria-label="Choose project"]',
            reason: "The header's icon actions sit flush: each hit area carries its own padding.",
          },
        ],
      },
    });
    await expect(
      page
        .locator('[data-session-card="row-multi"]')
        .getByRole("img", { name: "On another machine" }),
      "the remote session still names its destination at 320px",
    ).toBeVisible();
  });
