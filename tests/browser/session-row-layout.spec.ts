import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const evidence = path.resolve("temp/verification/2026-11-04-last-sessions-workspace");
const titleEvidence = path.resolve("temp/verification/2026-11-04-session-titles");
test("sidebar glass retains selection and grouped action focus without main glass", async ({ page }) => {
  await page.goto("/tests/browser/session-row-layout.html", { waitUntil: "domcontentloaded" });
  const row = page.locator('[data-session-card="row-multi"]');
  const group = page.locator("[data-github-star-prompt]");
  await expect(row).toBeVisible();
  await expect(group).toBeVisible();
  const normal = await group.evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.evaluate(() => {
    document.documentElement.classList.remove("glass-body", "theme-light");
    document.documentElement.classList.add("has-native-glass");
  });
  const glass = await group.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(glass).not.toBe(normal);
  const selected = await row.evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(selected).not.toBe("none");
  const dismiss = group.getByRole("button", { name: "Dismiss GitHub repository prompt" });
  await dismiss.focus();
  await expect(dismiss).toBeFocused();
  await page.emulateMedia({ forcedColors: "active" });
  await expect(row).toHaveCSS("outline-style", "solid");
});
for (const density of ["compact", "detailed"]) {
  for (const light of [false, true]) {
    test(`inline title rename density ${density} in ${light ? "light" : "dark"}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: 800, height: 800 });
      await page.goto(
        `/tests/browser/session-row-layout.html?density=${density}&${light ? "light" : "dark"}`,
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
      await page.goto(`/tests/browser/session-row-layout.html?${light ? "light" : "dark"}`, {
        waitUntil: "domcontentloaded",
      });
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
      await page.goto(`/tests/browser/session-row-layout.html${light ? "?light" : ""}`, {
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
      await expect(title).toContainText("T3 Code Design System Clarity");
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
        .filter({ hasText: "T3 Code Design System Clarity" });
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
    await page.goto(`/tests/browser/session-row-layout.html?density=${density}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator('[data-session-card="row-multi"]')).toContainText("Interrupted");
  });
}

test("global and recent lists show interrupted warning", async ({ page }) => {
  await page.goto("/tests/browser/session-row-layout.html?global", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator('[data-session-card="row-multi"]')).toContainText("Interrupted");
  await page.goto("/tests/browser/session-row-layout.html?recent-row", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("button", { name: /T3 Code Design System Clarity.*Interrupted/i }),
  ).toBeVisible();
});

for (const density of ["compact", "detailed"]) {
  test(`${density} keeps row titles and provider identity within the sidebar`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 800, height: 800 });
    await page.goto(`/tests/browser/session-row-layout.html?density=${density}`, {
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
      await page.goto(`/tests/browser/session-row-layout.html?global&${light ? "light" : "dark"}`, {
        waitUntil: "domcontentloaded",
      });
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
        .filter({ hasText: "T3 Code Design System Clarity" });
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
  await page.goto("/tests/browser/session-row-layout.html", { waitUntil: "domcontentloaded" });
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
          `/tests/browser/session-row-layout.html?global&${state}&${light ? "light" : "dark"}`,
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
      await page.goto(`/tests/browser/session-row-layout.html?wide&${light ? "light" : "dark"}`, {
        waitUntil: "domcontentloaded",
      });
      await page.getByRole("button", { name: "Last sessions", exact: true }).click();
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
    test(`recent row pin never covers title or age at ${width} ${light ? "light" : "dark"}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/session-row-layout.html?recent-row&${light ? "light" : "dark"}&${width === 800 ? "narrow" : "normal"}`,
        { waitUntil: "domcontentloaded" },
      );
      const row = page.getByRole("listitem").first();
      const open = row.locator("button").first();
      const pin = row.getByRole("button", { name: "Pin session", exact: true });
      const age = open.locator(".tabular-nums").last();
      await open.hover();
      await expect(pin).toBeVisible();
      await expect(age).toBeVisible();
      const checkGeometry = async () => {
        const [openBox, ageBox, pinBox] = await Promise.all([
          open.boundingBox(),
          age.boundingBox(),
          pin.boundingBox(),
        ]);
        expect(openBox!.x + openBox!.width).toBeLessThanOrEqual(pinBox!.x);
        expect(ageBox!.x + ageBox!.width).toBeLessThanOrEqual(pinBox!.x);
        expect(await row.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      };
      await checkGeometry();
      await pin.focus();
      await expect(pin).toBeFocused();
      await checkGeometry();
      const pinEvidence = path.resolve("temp/verification/2026-11-04-recent-session-pin");
      await mkdir(pinEvidence, { recursive: true });
      await page.screenshot({
        path: path.join(pinEvidence, `${light ? "light" : "dark"}-${width}-pin-focus.png`),
      });
      await pin.click();
      await expect(page.getByRole("status", { name: "Pin operations" })).toHaveText("1");
      await expect(page.getByRole("status", { name: "Selected session" })).toHaveText("");
      const unpin = row.getByRole("button", { name: "Unpin session", exact: true });
      await expect(unpin).toBeVisible();
      const [ageBox, unpinBox] = await Promise.all([age.boundingBox(), unpin.boundingBox()]);
      expect(ageBox!.x + ageBox!.width).toBeLessThanOrEqual(unpinBox!.x);
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
        `/tests/browser/session-row-layout.html?global&${width === 1280 ? "wide" : "compact"}&${light ? "light" : "dark"}`,
        { waitUntil: "domcontentloaded" },
      );
      const create = page.getByRole("button", { name: "New session", exact: true });
      await create.click();
      const dialog = page.getByRole("dialog", { name: "Choose a project for the new session" });
      const search = dialog.getByRole("combobox", { name: "Search projects" });
      await expect(search).toBeFocused();
      await expect(dialog.getByRole("option")).toHaveCount(2);
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
  await page.goto("/tests/browser/session-row-layout.html?global", {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await page.getByRole("option", { name: /^bycoda / }).click();
  await expect(page.getByRole("status", { name: "Created sessions" })).toHaveText("1");
  await expect(page.getByRole("status", { name: "Created project" })).toHaveText("/fixture/bycoda");
  await page.goto("/tests/browser/session-row-layout.html", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Created sessions" })).toHaveText("1");
});

test("new session retains selector and error when selected project becomes unavailable", async ({
  page,
}) => {
  await page.goto("/tests/browser/session-row-layout.html?global&create-error", {
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
          `/tests/browser/session-row-layout.html?density=${density}&${light ? "light" : "dark"}`,
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
      await page.goto(`/tests/browser/session-row-layout.html?${light ? "light" : "dark"}`, {
        waitUntil: "networkidle",
      });
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
        `/tests/browser/session-row-layout.html?two-rows&${light ? "light" : "dark"}`,
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
