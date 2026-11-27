import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

// Browser fixture for the native nested sandbox contract; this does not establish native WebView acceptance.
function offlineBackground(source: string) {
  const guard = readFileSync(
    new URL("../../../src-tauri/src/html_preview/background_guard.js", import.meta.url),
    "utf8",
  );
  const inner = `<!doctype html><meta http-equiv="Content-Security-Policy" content="frame-src 'none'"><script>${guard}</script>${source}`;
  const escaped = inner
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src 'none'; connect-src 'none'; frame-src about:; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;overflow:hidden}</style><iframe title="Background" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${escaped}"></iframe>`;
}

for (const theme of ["dark", "light"])
  for (const width of [1280, 800]) {
    test(`custom backgrounds retain choices and render scoped controls: ${theme} ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.addInitScript(() => {
        localStorage.setItem("bycoda.chatBackgroundPath", "/fixture/scene.html");
        localStorage.setItem("bycoda.decorativeMotion.v1", "1");
        localStorage.setItem(
          "bycoda.chatBackgroundHistory.v1",
          JSON.stringify({ global: ["/fixture/scene.html", "/fixture/video.mp4"] }),
        );
        localStorage.setItem(
          "bycoda:project-chat-backgrounds",
          JSON.stringify({
            "/fixture/project": {
              path: "/fixture/scene.html",
              emptyOpacity: 0.3,
              sessionOpacity: 0.2,
              scope: "all",
              effect: "none",
            },
          }),
        );
      });
      await page.route("http://background-preview.test/**", async (route) => {
        const token = new URL(route.request().url()).pathname.split("/")[1];
        const source = await page
          .evaluate((id) => (window as any).__backgroundScenes?.[id] ?? "", token)
          .catch(() => null);
        if (source === null) {
          await route.abort();
          return;
        }
        await route.fulfill({ contentType: "text/html", body: offlineBackground(source) });
      });
      const base = `/tests/browser/settings/settings.html?backgroundProbe&theme=${theme}&lang=en`;
      await page.goto(`${base}&section=appearance`);
      await page.getByRole("tab", { name: "Background", exact: true }).click();
      await page
        .getByRole("listitem")
        .filter({ has: page.getByText("Chat background", { exact: true }) })
        .getByRole("button")
        .first()
        .click();
      const group = page.locator('[data-setting-id="chat-background"]');
      await expect(group).toBeVisible();
      await expect(
        group.getByRole("button", { name: "Choose background", exact: true }).last(),
      ).toBeVisible();
      await expect(group.locator("iframe")).toHaveCount(1);
      await group.screenshot({
        path: `temp/verification/custom-backgrounds/appearance-${theme}-${width}.png`,
      });
      await group.getByRole("button", { name: "Remove", exact: true }).click();
      await expect(group.locator("iframe")).toHaveCount(0);
      await group.getByRole("button", { name: /^Backgrounds:/ }).click();
      await page.getByRole("option").filter({ hasText: "Live scene" }).click();
      await expect(group.locator("iframe")).toHaveCount(1);
      await page.goto(`${base}&backgroundProject`);
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.locator("iframe")).toHaveCount(1);
      await page.screenshot({
        path: `temp/verification/custom-backgrounds/project-${theme}-${width}.png`,
      });
      await page.goto(`${base}&backgroundChat`);
      await expect(page.locator("iframe")).toHaveCount(1);
      await page.screenshot({
        path: `temp/verification/custom-backgrounds/chat-${theme}-${width}.png`,
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(page.locator("iframe")).toHaveCount(0);
      const video = await page.evaluate(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 180;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#28534f";
        context.fillRect(0, 0, 320, 180);
        const stream = canvas.captureStream(10);
        const chunks: Blob[] = [];
        const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
        recorder.ondataavailable = (event) => chunks.push(event.data);
        const stopped = new Promise<void>((resolve) => {
          recorder.onstop = () => resolve();
        });
        recorder.start();
        await new Promise((resolve) => setTimeout(resolve, 150));
        recorder.stop();
        await stopped;
        stream.getTracks().forEach((track) => track.stop());
        return [...new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer())];
      });
      await page.route("http://background-asset.test/**", (route) =>
        route.fulfill({ contentType: "video/webm", body: Buffer.from(video) }),
      );
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.goto(`${base}&backgroundChat&backgroundVideo`);
      await expect(page.locator("video")).toHaveJSProperty("readyState", 4);
      await expect(page.locator("video")).toHaveJSProperty("muted", true);
      await expect(page.locator("video")).toHaveJSProperty("loop", true);
      await page.screenshot({
        path: `temp/verification/custom-backgrounds/video-${theme}-${width}.png`,
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(page.locator("video")).toHaveCount(0);
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`design creation previews saves and reapplies: ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.route("http://background-preview.test/**", async (route) => {
        const token = new URL(route.request().url()).pathname.split("/")[1];
        const source = await page.evaluate(
          (id) => (window as any).__backgroundScenes?.[id] ?? "",
          token,
        );
        await route.fulfill({ contentType: "text/html", body: offlineBackground(source) });
      });
      await page.goto(
        `/tests/browser/settings/settings.html?backgroundProbe&section=appearance&theme=${theme}&lang=en`,
      );
      const output = `temp/verification/appearance-create`;
      await expect(page.getByRole("button", { name: /Composer 2\.5/ }).first()).toBeVisible();
      await page.screenshot({ path: `${output}/generator-${theme}-${width}.png` });
      await page.getByRole("tab", { name: "Background", exact: true }).click();
      await page
        .getByRole("listitem")
        .filter({ has: page.getByText("Live", { exact: true }) })
        .getByRole("button")
        .first()
        .click();
      await page.getByRole("button", { name: "Create scene", exact: true }).click();
      const studio = page.getByRole("dialog", { name: "Create a design" });
      await expect(studio.getByLabel("Describe the result")).toBeVisible();
      await studio.getByRole("button", { name: "Try mountain lake", exact: true }).click();
      await expect(studio.locator("iframe")).toHaveCount(1);
      await expect(studio.getByText("Unsaved draft", { exact: true })).toBeVisible();
      expect(
        await page.evaluate(() => localStorage.getItem("bycoda.chatBackgroundPath")),
      ).toBeNull();
      await studio.getByLabel("Design name", { exact: true }).fill("My dusk lake");
      await studio.getByRole("button", { name: "Save", exact: true }).click();
      await expect(studio.getByText("Saved", { exact: true })).toBeVisible();
      await page.screenshot({ path: `${output}/studio-saved-${theme}-${width}.png` });
      await studio.getByRole("button", { name: "Apply", exact: true }).first().click();
      await expect(studio.getByText("Current", { exact: true })).toBeVisible();
      const active = await page.evaluate(() => localStorage.getItem("bycoda.chatBackgroundPath"));
      expect(active).toContain("asset-");
      await studio.getByRole("button", { name: "Edit source", exact: true }).click();
      await studio.getByLabel("HTML, CSS and JavaScript").fill("<b>Changed draft</b>");
      await expect(
        studio.getByRole("button", { name: "Save changes", exact: true }),
      ).toBeDisabled();
      await expect(
        studio.getByRole("button", { name: "Apply", exact: true }).first(),
      ).toBeDisabled();
      await studio.getByRole("button", { name: "Discard source changes", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(studio).toHaveCount(0);
      await page.screenshot({ path: `${output}/background-${theme}-${width}.png` });
      await page.getByRole("tab", { name: "Motion", exact: true }).click();
      await page.screenshot({ path: `${output}/motion-${theme}-${width}.png` });
      await page.getByRole("button", { name: "Create motion preset", exact: true }).click();
      await expect(studio.getByLabel("Describe the result")).toHaveValue(/mountain lake/);
      await expect(studio.getByText("Current", { exact: true })).toBeVisible();
      await studio.getByRole("button", { name: "Open", exact: true }).click();
      await expect(studio.getByLabel("Design name", { exact: true })).toHaveValue("My dusk lake");
      await page.screenshot({ path: `${output}/studio-current-${theme}-${width}.png` });
      expect(await studio.evaluate((node) => node.scrollWidth <= node.clientWidth + 2)).toBe(true);
      await page.keyboard.press("Escape");
      await page.goto(
        `/tests/browser/settings/settings.html?backgroundProbe&backgroundProject&theme=${theme}&lang=en`,
      );
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.frameLocator("iframe").frameLocator("iframe").locator(".orb").waitFor();
      await page.screenshot({ path: `${output}/project-${theme}-${width}.png` });
    });
  }

for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`background naming stays coherent in library global and project history: ${theme} ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.addInitScript(() => {
        if (localStorage.getItem("backgroundNamingSeed")) return;
        const id = "a".repeat(24),
          path = `/fixture/asset-${"a".repeat(64)}.html`;
        localStorage.setItem("bycoda.chatBackgroundPath", path);
        localStorage.setItem("bycoda.decorativeMotion.v1", "1");
        localStorage.setItem(
          "bycoda.savedThemes.v1",
          JSON.stringify([
            {
              id: "original",
              name: "Original lake",
              imageId: id,
              look: {},
              createdAt: 1,
              updatedAt: 1,
              creation: { kind: "scene", prompt: "Generated lake" },
            },
          ]),
        );
        localStorage.setItem(
          "bycoda.chatBackgroundHistory.v1",
          JSON.stringify({ global: [path], "/fixture/project": [path] }),
        );
        localStorage.setItem(
          "bycoda:project-chat-backgrounds",
          JSON.stringify({
            "/fixture/project": {
              path,
              scope: "all",
              effect: "none",
              emptyOpacity: 0.3,
              sessionOpacity: 0.2,
            },
          }),
        );
        localStorage.setItem("backgroundNamingSeed", "1");
      });
      await page.route("http://background-preview.test/**", async (route) => {
        const token = new URL(route.request().url()).pathname.split("/")[1];
        const source = await page.evaluate(
          (id) => (window as any).__backgroundScenes?.[id] ?? "",
          token,
        );
        await route.fulfill({ contentType: "text/html", body: offlineBackground(source) });
      });
      const base = `/tests/browser/settings/settings.html?backgroundProbe&backgroundNaming&theme=${theme}&lang=en`;
      await page.goto(`${base}&section=appearance`);
      await page.getByRole("tab", { name: "Background", exact: true }).click();
      await page
        .getByRole("listitem")
        .filter({ has: page.getByText("Chat background", { exact: true }) })
        .getByRole("button")
        .first()
        .click();
      const group = page.locator('[data-setting-id="chat-background"]');
      const library = group.getByRole("list", { name: "Library", exact: true });
      await expect(
        library.getByRole("button", { name: "Original lake · Live scene", exact: true }),
      ).toBeVisible();
      const before = await page.evaluate(() => localStorage.getItem("bycoda.chatBackgroundPath"));
      await library.getByRole("button", { name: "Rename: Original lake", exact: true }).click();
      let dialog = page.getByRole("dialog", { name: "Rename", exact: true });
      await dialog.getByLabel("Design name", { exact: true }).fill("Night lake");
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        library.getByRole("button", { name: "Night lake · Live scene", exact: true }),
      ).toBeVisible();
      await expect(group.getByRole("button", { name: /^Backgrounds:/ })).toContainText(
        "Night lake",
      );
      const video = library
        .getByRole("listitem")
        .filter({ has: page.getByRole("button", { name: "Video", exact: true }) });
      await video.getByRole("button", { name: "Save background", exact: true }).click();
      dialog = page.getByRole("dialog", { name: "Save background", exact: true });
      await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      await dialog.getByLabel("Design name", { exact: true }).fill("Quiet video");
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        library.getByRole("button", { name: "Quiet video · Video", exact: true }),
      ).toBeVisible();
      await library.getByRole("button", { name: "Rename: Night lake", exact: true }).click();
      dialog = page.getByRole("dialog", { name: "Rename", exact: true });
      await dialog.getByLabel("Design name", { exact: true }).fill("Moon lake");
      await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        (window as any).__restoreNameStorage = () => (Storage.prototype.setItem = original);
        Storage.prototype.setItem = function (key, value) {
          if (key === "bycoda.savedThemes.v1") throw new Error("fixture quota");
          return original.call(this, key, value);
        };
      });
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect(dialog.getByLabel("Design name", { exact: true })).toHaveValue("Moon lake");
      await expect(dialog).toContainText("Could not save the theme.");
      await expect(
        library.getByRole("button", { name: "Night lake · Live scene", exact: true }),
      ).toBeVisible();
      await page.evaluate(() => (window as any).__restoreNameStorage());
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      expect(await page.evaluate(() => localStorage.getItem("bycoda.chatBackgroundPath"))).toBe(
        before,
      );
      await expect(group.getByRole("button", { name: /^Backgrounds:/ })).not.toContainText(
        "asset-",
      );
      await group.screenshot({
        path: `temp/verification/background-names/library-${theme}-${width}.png`,
      });
      await page.goto(`${base}&backgroundProject`);
      const project = page.getByRole("dialog", { name: "Chat background", exact: true });
      await expect(project.getByRole("button", { name: /^Backgrounds:/ })).toContainText(
        "Moon lake",
      );
      const projectBefore = await page.evaluate(() =>
        localStorage.getItem("bycoda:project-chat-backgrounds"),
      );
      await project.getByRole("button", { name: "Rename: Moon lake", exact: true }).click();
      dialog = page.getByRole("dialog", { name: "Rename", exact: true });
      await dialog.getByLabel("Design name", { exact: true }).fill("Project lake");
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      expect(
        await page.evaluate(() => localStorage.getItem("bycoda:project-chat-backgrounds")),
      ).toBe(projectBefore);
      expect(await page.evaluate(() => localStorage.getItem("bycoda.chatBackgroundPath"))).toBe(
        before,
      );
      await expect(project.getByRole("button", { name: /^Backgrounds:/ })).toContainText(
        "Project lake",
      );
      await project.screenshot({
        path: `temp/verification/background-names/project-${theme}-${width}.png`,
      });
    });
  }

test("custom background sandbox denies network, self navigation, bridge and parent DOM", async ({
  page,
}) => {
  const attempted: string[] = [];
  const observations: string[] = [];
  page.on("console", (message) => observations.push(message.text()));
  await page.route("https://background-escape.test/**", async (route) => {
    attempted.push(route.request().url());
    await route.abort();
  });
  const payload = `<script>document.addEventListener('DOMContentLoaded',()=>{let denied=0;for(const run of [()=>parent.document.body,()=>localStorage.getItem('token'),()=>top.__TAURI_INTERNALS__.invoke('x')]){try{run()}catch{denied++}}let fresh='blocked';try{const frame=document.createElement('iframe');document.body.append(frame);if(frame.contentWindow.RTCPeerConnection)fresh='escaped'}catch{}console.log('background-security:'+denied+':'+typeof RTCPeerConnection+':'+fresh);fetch('https://background-escape.test/fetch').catch(()=>{});try{new WebSocket('wss://background-escape.test/socket')}catch{};setTimeout(()=>{console.log('background-navigation-attempted');location.href='https://background-escape.test/navigate'},50)});</script><img src='https://background-escape.test/image'>`;
  await page.route("http://background-preview.test/security", (route) =>
    route.fulfill({ contentType: "text/html", body: offlineBackground(payload) }),
  );
  await page.setContent(
    '<iframe title="Scene" sandbox="allow-scripts" src="http://background-preview.test/security"></iframe>',
  );
  await expect(
    page.frameLocator('iframe[title="Scene"]').frameLocator("iframe").locator("body"),
  ).toBeAttached();
  await expect
    .poll(() => observations.includes("background-security:3:undefined:blocked"))
    .toBe(true);
  await expect.poll(() => observations.includes("background-navigation-attempted")).toBe(true);
  expect(
    page.frames().some((frame) => frame.url().startsWith("https://background-escape.test")),
  ).toBe(false);
  expect(attempted).toEqual([]);
});

for (const theme of ["dark", "light"])
  for (const width of [1280, 800, 390]) {
    test(`browser profiles and viewport presets ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(
        `/tests/browser/settings/settings.html?section=tools&theme=${theme}&lang=en&browserProfiles`,
      );
      const grant = page.getByRole("switch", { name: "Allow agents to use Work" });
      await expect(grant).not.toBeChecked();
      await grant.click();
      await expect(grant).toBeChecked();
      const profile = page
        .locator('[data-setting-id="browser-default-profile"]')
        .getByRole("button");
      await profile.click();
      await page.getByRole("option", { name: "Work", exact: true }).click();
      await expect(profile).toContainText("Work");
      const development = page.getByRole("button", { name: /^Development browser profile:/ });
      await expect(development).toContainText("Isolated");
      await development.focus();
      await development.press("Enter");
      await page.getByRole("option", { name: "Work", exact: true }).click();
      await expect(development).toContainText("Work");
      await profile.click();
      await page.getByRole("option", { name: "Isolated", exact: true }).click();
      await expect(profile).toContainText("Isolated");
      await expect(development).toContainText("Work");
      const viewport = page.getByRole("button", { name: /^Default viewport:/ });
      await viewport.click();
      for (const label of ["1K (1024 × 576)", "2K (2560 × 1440)", "4K (3840 × 2160)"])
        await expect(page.getByRole("option", { name: label, exact: true })).toBeVisible();
      await page.getByRole("option", { name: "4K (3840 × 2160)", exact: true }).click();
      await expect(viewport).toContainText("4K (3840 × 2160)");
      const directory = "temp/verification/browser-profiles";
      mkdirSync(directory, { recursive: true });
      await page.screenshot({ path: `${directory}/profile-routing-${theme}-${width}.png` });
    });
  }

for (const theme of ["dark", "light"])
  for (const width of [1280, 800]) {
    test(`transcript view appearance controls ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/settings/settings.html?section=appearance&theme=${theme}&lang=en`,
      );
      await page.getByRole("button", { name: "Search settings", exact: true }).click();
      const search = page.getByRole("combobox", { name: "Search settings", exact: true });
      await search.fill("Surface opacity");
      await expect(page.getByRole("option").first()).toContainText("Surface opacity");
      await search.press("Enter");
      const user = page.getByRole("slider", { name: "Your message opacity" });
      const reply = page.getByRole("slider", { name: "Surface opacity" });
      const preview = page.locator("[data-transcript-preview]");
      const neutral = page
        .locator('[data-setting-id="chat-message-color"]')
        .getByRole("radio", { name: "Neutral", exact: true });
      await expect(user).toHaveAttribute("aria-valuenow", "42");
      await expect(reply).toHaveAttribute("aria-valuenow", "90");
      await preview.scrollIntoViewIfNeeded();
      if (process.env.CHAT_MESSAGE_APPEARANCE_CAPTURE) {
        const directory = "temp/verification/chat-message-appearance";
        mkdirSync(directory, { recursive: true });
        await page.screenshot({ path: `${directory}/settings-${theme}-${width}.png` });
      }
      await user.press("End");
      await reply.press("Home");
      await neutral.click();
      await expect(page.locator("html")).toHaveAttribute("data-chat-message-color", "neutral");
      await expect(preview).toHaveAttribute("data-chat-message-color", "neutral");
      await expect(preview).toHaveAttribute("data-transcript-surface", "reply");
      await expect(reply).toHaveAttribute("aria-valuenow", "0");
      await expect(user).toHaveAttribute("aria-valuenow", "100");
      await page.reload();
      await page
        .locator(".appearance-settings")
        .getByRole("tab", { name: "Chat", exact: true })
        .click();
      await expect(user).toHaveAttribute("aria-valuenow", "100");
      await expect(reply).toHaveAttribute("aria-valuenow", "0");
      await expect(neutral).toBeChecked();
      await page
        .locator('[data-setting-id="user-message-opacity"]')
        .getByRole("button", { name: "Restore default" })
        .click();
      await expect(user).toHaveAttribute("aria-valuenow", "42");
      await expect(reply).toHaveAttribute("aria-valuenow", "0");
    });
  }

for (const theme of ["dark", "light"])
  for (const width of [1280, 800]) {
    test(`appearance image review and replacement: ${theme} ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?section=appearance&theme=${theme}&lang=en&appearanceImageReview`,
      );
      await page.getByRole("button", { name: "Generate with AI", exact: true }).click();
      const card = page
        .locator(".theme-suggestion-card")
        .filter({ has: page.getByRole("button", { name: "Apply Meadow" }) });
      const activeImage = () =>
        page.evaluate(() => localStorage.getItem("bycoda.chatBackgroundLibraryId.v1"));
      await card.getByRole("button", { name: "Generate image" }).click();
      await card.getByRole("button", { name: "Preview Meadow" }).click();
      const preview = page.getByRole("dialog", { name: "Image preview: Meadow" });
      await expect(preview.getByRole("img")).toBeVisible();
      expect(await activeImage()).toBeNull();
      await page.screenshot({
        path: info.outputPath(`appearance-image-preview-${theme}-${width}.png`),
        animations: "disabled",
      });
      await preview.getByRole("button", { name: "Change image" }).click();
      await expect(preview).toHaveCount(0);
      await page.getByRole("button", { name: "Recent activity", exact: true }).click();
      await expect(page.getByRole("button", { name: "Preview Meadow" })).toHaveCount(2);
      expect(await activeImage()).toBeNull();
      await page.screenshot({
        path: info.outputPath(`appearance-image-cards-${theme}-${width}.png`),
        animations: "disabled",
      });
      await card.getByRole("button", { name: "Use image" }).click();
      await expect.poll(activeImage).toBe("/fixture/image-2.png");
      await expect(card.getByRole("button", { name: "In use" })).toBeVisible();
    });
  }

for (const theme of ["dark", "light"])
  for (const width of [1280, 800]) {
    test(`appearance generation tracks concurrent drawings: ${theme} ${width}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?section=appearance&theme=${theme}&lang=en&appearanceGeneration`,
      );
      const launcher = page.getByRole("button", { name: "Generate with AI", exact: true });
      const dialog = page.getByRole("dialog", { name: "Generate with AI", exact: true });
      const colorScheme = page.getByText("Color scheme", { exact: true });
      const schemeY = (await colorScheme.boundingBox())?.y;
      expect(schemeY).toBeDefined();
      await expect(page.getByRole("textbox", { name: "Describe a theme" })).toHaveCount(0);
      await launcher.click();
      await expect(dialog.getByRole("textbox", { name: "Describe a theme" })).toBeFocused();
      await page.getByRole("button", { name: "Apply Meadow" }).click();
      await page
        .getByRole("textbox", { name: "Describe a theme" })
        .fill("Midnight blue with mountain silhouettes");
      const generate = page.getByRole("button", { name: "Generate themes", exact: true });
      await expect(generate).toBeEnabled();
      await generate.click();
      await page.getByRole("button", { name: "Apply Alpine" }).click();
      const activity = dialog.getByRole("group", { name: "Generation", exact: true });
      await expect(activity.getByRole("button", { name: "Cancel Meadow" })).toBeVisible();
      await expect(activity.getByRole("button", { name: "Cancel Alpine" })).toBeVisible();
      await activity.getByRole("button", { name: "Cancel Meadow" }).click();
      await expect(activity.getByText("Cancelled", { exact: true })).toBeVisible();
      await expect(activity.getByRole("button", { name: "Cancel Alpine" })).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`appearance-ai-dialog-${theme}-${width}.png`),
        animations: "disabled",
      });
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(launcher).toHaveAttribute("aria-description", "1 running");
      expect((await colorScheme.boundingBox())!.y).toBeCloseTo(schemeY!, 0);
      await openAppearanceTab(page, "Background");
      await expect(launcher).toHaveAttribute("aria-description", "1 running");
      await openAppearanceTab(page, "Theme");
      await page.screenshot({
        path: info.outputPath(`appearance-ai-minimized-${theme}-${width}.png`),
        animations: "disabled",
      });
      await launcher.click();
      await expect(dialog.getByRole("textbox", { name: "Describe a theme" })).toHaveValue(
        "Midnight blue with mountain silhouettes",
      );
      await expect(activity.getByRole("button", { name: "Cancel Alpine" })).toBeVisible();
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(launcher).toHaveAttribute("aria-description", "1 running");
      await page.evaluate(() =>
        window.dispatchEvent(new Event("fixture-complete-appearance-drawings")),
      );
      await expect(launcher).toHaveAttribute("aria-description", "Ready");
      // The tab strip scrolls when the launcher and tabs outgrow the toolbar (wider Linux fonts at
      // 800px): the last tab must stay reachable, not necessarily visible without scrolling.
      const motionTab = page.getByRole("tab", { name: "Motion", exact: true });
      await motionTab.scrollIntoViewIfNeeded();
      // Fractional layout can leave a subpixel at the scroll container's edge.
      await expect(motionTab).toBeInViewport({ ratio: 0.99 });
      await motionTab.click({ trial: true });
      await page.screenshot({
        path: info.outputPath(`appearance-ai-closed-${theme}-${width}.png`),
        animations: "disabled",
      });
      await launcher.click();
      await expect(dialog.getByRole("button", { name: "Preview Alpine" })).toBeVisible();
    });
  }

/** Appearance is tabbed; every tab stays mounted but only the selected one is visible. */
async function openAppearanceTab(page: Page, name: string) {
  await page.getByRole("tab", { name, exact: true }).click();
}

/** Background layers are rows whose editors stay hidden until the row is opened. */
async function openBackgroundLayer(page: Page, layer: "Color" | "Glass") {
  await openAppearanceTab(page, "Background");
  const disclosure = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("switch", { name: layer, exact: true }) })
    .getByRole("button")
    .first();
  if ((await disclosure.getAttribute("aria-expanded")) !== "true") await disclosure.click();
}

for (const theme of ["dark", "light"])
  for (const width of [1280, 800]) {
    test(`workspace gradients retain custom designs and synchronize windows: ${theme} ${width}`, async ({
      page,
      context,
      browserName,
    }) => {
      const key = "bycoda.workspaceBackground.v1";
      const url = `/tests/browser/settings/settings.html?section=appearance&theme=${theme}&lang=en`;
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(url);
      const group = page.locator('[data-setting-id="workspace-background"]');
      // The Color layer's editor stays closed until its row is opened.
      const openColorLayer = async () => {
        await openBackgroundLayer(page, "Color");
        await expect(group).toBeVisible();
      };
      await openColorLayer();
      const stored = () =>
        page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), key);
      const previousGlass = await page.evaluate(() =>
        ["bycoda.bodyGlass", "bycoda.windowGlass"].map((key) => localStorage.getItem(key)),
      );
      await group.getByRole("button", { name: "Ocean", exact: true }).click();
      await expect.poll(stored).toMatchObject({ enabled: true });
      const type = group.getByRole("radiogroup", { name: "Gradient type", exact: true });
      await type.getByRole("radio", { name: "Linear", exact: true }).click();
      const dial = group.getByRole("slider", { name: "Gradient angle", exact: true });
      const initial = (await stored()).angle;
      await dial.press("ArrowRight");
      // Edits are applied on the next animation frame.
      await expect.poll(async () => (await stored()).angle).not.toBe(initial);
      const angle = (await stored()).angle;
      await type.getByRole("radio", { name: "Radial", exact: true }).click();
      await expect(dial).toHaveCount(0);
      expect((await stored()).angle).toBe(angle);
      await type.getByRole("radio", { name: "Linear", exact: true }).click();
      await group.getByRole("button", { name: "Color 1", exact: true }).click();
      await page.getByRole("textbox", { name: "Hex color", exact: true }).fill("#2244aa");
      await expect.poll(async () => (await stored()).colors[0]).toBe("#2244aa");
      await page.keyboard.press("Escape");
      const design = await stored();
      const toggle = page.getByRole("switch", { name: "Color", exact: true });
      await toggle.click();
      await expect(page.locator("html")).not.toHaveClass(/has-workspace-background/);
      expect((await stored()).colors).toEqual(design.colors);
      await toggle.click();
      await page.reload();
      await expect(page.locator("html")).toHaveClass(/has-workspace-background/);
      expect(await stored()).toEqual(design);
      expect(
        await page.evaluate(() =>
          ["bycoda.bodyGlass", "bycoda.windowGlass"].map((key) => localStorage.getItem(key)),
        ),
      ).toEqual(previousGlass);
      const sibling = await context.newPage();
      try {
        await sibling.goto(url);
        await expect(sibling.locator("html")).toHaveClass(/has-workspace-background/);
        await openColorLayer();
        const before = (await stored()).angle;
        await dial.press("ArrowRight");
        // Edits are applied on the next animation frame.
        await expect.poll(async () => (await stored()).angle).not.toBe(before);
        const changed = await stored();
        await expect
          .poll(() =>
            sibling.evaluate(() => getComputedStyle(document.documentElement).backgroundImage),
          )
          .toContain(`${changed.angle}deg`);
        if (browserName === "chromium") {
          const cdp = await context.newCDPSession(page);
          try {
            await cdp.send("Emulation.setEmulatedMedia", {
              features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
            });
            await expect
              .poll(() =>
                page.evaluate(() => getComputedStyle(document.documentElement).backgroundImage),
              )
              .toBe("none");
            await expect(
              group.getByText(
                "Your accessibility settings hide workspace backgrounds. Your design is still saved.",
                { exact: true },
              ),
            ).toBeVisible();
            expect((await stored()).enabled).toBe(true);
          } finally {
            await cdp.send("Emulation.setEmulatedMedia", { features: [] });
            await cdp.detach();
          }
        }
      } finally {
        await sibling.close();
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    });
  }

for (const theme of ["light", "dark"]) {
  for (const width of [390, 1440]) {
    test(`terminal typography settings: ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?section=appearance&theme=${theme}&lang=tr`,
      );
      await openAppearanceTab(page, "Tipografi");
      // Terminal text follows the code font until the owner picks a separate terminal font.
      const font = page
        .locator('[data-setting-id="terminal-font"]')
        .getByRole("button", { name: /^Terminal yazı tipi:/ });
      await expect(font).toContainText("Kod fontuyla aynı");
      await font.click();
      await page.getByRole("combobox", { name: /Yazı tiplerinde ara/ }).fill("JetBrains Mono");
      await page.getByRole("option", { name: /^JetBrains Mono/ }).click();
      const size = page.getByRole("spinbutton", { name: "Terminal yazı boyutu", exact: true });
      await size.fill("14");
      await size.blur();
      await expect(size).toHaveValue("14");
      await page
        .locator('[data-setting-id="terminal-font-weight"]')
        .getByRole("radio", { name: "Kalın", exact: true })
        .click();
      await page
        .locator('[data-setting-id="terminal-line-height"]')
        .getByRole("radio", { name: "1.35×", exact: true })
        .click();
      const saved = () =>
        page.evaluate(() =>
          JSON.parse(localStorage.getItem("bycoda.appearancePreferences.v1") ?? "{}"),
        );
      await expect.poll(saved).toMatchObject({
        terminalFont: "JetBrains Mono",
        terminalFontSource: "custom",
        terminalSize: 14,
        terminalWeight: 700,
        terminalLineHeight: 1.35,
        codeSize: 13,
      });
      await page.reload();
      await openAppearanceTab(page, "Tipografi");
      await expect(font).toContainText("JetBrains Mono");
      await expect(size).toHaveValue("14");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    });
  }
}
import { mkdirSync } from "node:fs";

for (const theme of ["dark", "light"]) {
  test(`code theme follows appearance and persists: ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(
      `/tests/browser/settings/settings.html?section=appearance&theme=${theme}&lang=tr`,
    );
    const row = page.locator('[data-setting-id="code-theme"]');
    await openAppearanceTab(page, "Tipografi");
    await row.scrollIntoViewIfNeeded();
    await row.getByRole("radio", { name: "Dracula", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-code-theme", "dracula");
    const keyword = page.locator(".code-sample-keyword").first();
    await expect(keyword).toHaveCSS(
      "color",
      theme === "dark" ? "rgb(255, 121, 198)" : "rgb(207, 34, 46)",
    );
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-code-theme", "dracula");
    await openAppearanceTab(page, "Tipografi");
    await expect(row.getByRole("radio", { name: "Dracula", exact: true })).toBeChecked();
    await row.scrollIntoViewIfNeeded();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    mkdirSync("temp/verification/2026-10-19-code-themes", { recursive: true });
    await row.screenshot({
      path: `temp/verification/2026-10-19-code-themes/${theme}-theme-control.png`,
    });
  });
}

for (const theme of ["light", "dark"])
  for (const width of [390, 768, 1024, 1440]) {
    test(`general settings dependencies and language choices: ${theme} ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?section=general&theme=${theme}&lang=en`,
      );
      const general = page.locator(".general-settings");
      const awake = general.getByRole("switch", {
        name: "Prevent sleep while agents work",
        exact: true,
      });
      const screen = general.getByRole("switch", { name: "Keep the screen on", exact: true });
      const duration = general
        .locator('[data-setting-id="keep-awake-duration"]')
        .getByRole("button", { name: /^Stay awake after an agent ends:/ });
      // Keeping the machine awake is on by default; turning it off disables its dependents.
      await expect(awake).toBeChecked();
      await expect(screen).toBeEnabled();
      await awake.click();
      await expect(screen).toBeDisabled();
      await expect(duration).toBeDisabled();
      await awake.focus();
      await page.keyboard.press("Space");
      await expect(screen).toBeEnabled();
      await screen.click();
      await duration.click();
      await page.getByRole("option", { name: "15 minutes", exact: true }).click();
      await awake.click();
      await expect(screen).toBeDisabled();
      await page.reload();
      await expect(screen).toBeChecked();
      await expect(screen).toBeDisabled();
      await awake.click();
      await expect(duration).toContainText("15 minutes");
      await expect(screen).toBeChecked();
      const language = general.locator(
        '[data-setting-id="git-language"] button[aria-haspopup="listbox"]',
      );
      await language.focus();
      await language.press("Enter");
      await page.getByRole("option", { name: "English", exact: true }).click();
      await expect(language).toContainText("English");
      await expect(general.locator('[data-setting-id="technical-language"]')).toContainText(
        "Follow application language",
      );
      await expect(general.getByText("Changes save automatically", { exact: true })).toHaveCount(0);
      const restoreDefaults = page.getByRole("button", { name: "Restore defaults", exact: true });
      await restoreDefaults.press("Enter");
      await expect(
        page.getByRole("dialog", { name: "Restore defaults", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(restoreDefaults).toBeFocused();
      await expect(general.locator(".general-version")).toBeVisible();
      const overflows = await general.evaluate((root) =>
        [
          ...root.querySelectorAll(
            ".settings-row, .settings-group-heading, .general-update-actions",
          ),
        ]
          .filter((node) => node.scrollWidth > node.clientWidth + 1)
          .map((node) => node.className),
      );
      expect(overflows).toEqual([]);
      mkdirSync("temp/verification/2026-10-18-general-settings", { recursive: true });
      await page.locator("[data-settings-scroller]").evaluate((node) => {
        node.scrollTop = 0;
      });
      await page.screenshot({
        path: `temp/verification/2026-10-18-general-settings/${theme}-${width}-top.png`,
      });
      await general.locator('[data-setting-id="update"]').scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `temp/verification/2026-10-18-general-settings/${theme}-${width}-bottom.png`,
      });
    });
  }

for (const theme of ["light", "dark"]) {
  for (const width of [1280, 800]) {
    test(`appearance dialog header aligns its actions: ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(
        `/tests/browser/settings/settings.html?dialog=1&section=appearance&theme=${theme}&lang=en`,
      );
      await page.getByTestId("open-settings").click();
      const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
      await dialog.getByRole("tab", { name: "Background", exact: true }).click();
      const evidence = "temp/verification/settings-header";
      mkdirSync(evidence, { recursive: true });
      await dialog.screenshot({ path: `${evidence}/appearance-${theme}-${width}.png` });

      const close = (await dialog
        .getByRole("button", { name: "Close", exact: true })
        .boundingBox())!;
      for (const name of [
        "Search settings",
        "Preview in app",
        "Reset all appearance settings",
        "Maximize",
      ]) {
        const action = await dialog.getByRole("button", { name, exact: true }).boundingBox();
        expect(action, name).not.toBeNull();
        expect(
          Math.abs(action!.y + action!.height / 2 - close.y - close.height / 2),
          name,
        ).toBeLessThanOrEqual(1);
      }
      const maximize = (await dialog
        .getByRole("button", { name: "Maximize", exact: true })
        .boundingBox())!;
      expect(close.x - maximize.x - maximize.width).toBeLessThanOrEqual(8);
      await expect(
        dialog.getByRole("button", { name: "About this page", exact: true }),
      ).toHaveCount(0);
      const reset = dialog.getByRole("button", {
        name: "Reset all appearance settings",
        exact: true,
      });
      await reset.press("Enter");
      const confirmation = page.getByRole("dialog", { name: "Restore defaults", exact: true });
      await expect(confirmation).toBeVisible();
      await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(reset).toBeFocused();
      await expect(dialog.getByRole("tab", { name: "Background", selected: true })).toBeVisible();
    });
  }
}

test("appearance topics stay visible and support search into nested controls", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/settings/settings.html?section=appearance&theme=dark&lang=en");
  const topics = page.getByRole("tablist", { name: "Appearance", exact: true }).getByRole("tab");
  await expect(topics).toHaveCount(6);
  await page.screenshot({ path: testInfo.outputPath("appearance-overview-dark.png") });
  await openAppearanceTab(page, "Typography");
  await expect(page.locator('[data-setting-id="code-font-size"]')).toBeVisible();
  // No setting is a collapsed section; the Transcript preview's sample step row is the only disclosure.
  await expect
    .poll(() =>
      page
        .locator(".appearance-settings details, .appearance-settings summary")
        .evaluateAll(
          (nodes) => nodes.filter((node) => !node.closest("[data-transcript-preview]")).length,
        ),
    )
    .toBe(0);

  await page.getByRole("button", { name: "Search settings", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Search settings", exact: true })
    .fill("Dark-mode lightness");
  await page.getByRole("option").filter({ hasText: "Dark-mode lightness" }).click();
  await expect(page.locator('[data-setting-id="dark-lightness"]')).toBeVisible();

  // Expanded content must stay contained at intermediate and narrow widths too.
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    // Open rows outset their hover surface into the form padding, so the padded form and the
    // scroller are the boundaries that must stay free of horizontal overflow.
    expect(
      await page
        .locator(".bycoda-settings-form")
        .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true);
    expect(
      await page
        .locator("[data-settings-scroller]")
        .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath("appearance-expanded.png") });
  await page.goto("/tests/browser/settings/settings.html?section=appearance&theme=light&lang=tr");
  await expect(
    page.getByRole("tablist", { name: "Görünüm", exact: true }).getByRole("tab"),
  ).toHaveCount(6);
  await page.screenshot({ path: testInfo.outputPath("appearance-overview-light-tr.png") });
});

test("control density persists shared control targets and resets without changing fonts", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("bycoda.appearancePreferences.v1"))
      localStorage.setItem(
        "bycoda.appearancePreferences.v1",
        JSON.stringify({ interfaceFont: "Verdana", codeSize: 15 }),
      );
  });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/tests/browser/settings/settings.html?section=appearance&theme=light&lang=en");
  await openAppearanceTab(page, "Interface");
  const row = page.locator('[data-setting-id="control-density"]');
  const density = row.getByRole("radiogroup", { name: "Control density", exact: true });
  const radio = (name: string) => density.getByRole("radio", { name, exact: true });
  await expect(radio("Compact")).toBeChecked();
  await radio("Touch").click();
  await expect(page.locator("html")).toHaveAttribute("data-control-density", "touch");
  expect((await radio("Touch").boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.reload();
  await openAppearanceTab(page, "Interface");
  await expect(radio("Touch")).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-control-density", "touch");
  await row.getByRole("button", { name: "Restore default", exact: true }).click();
  await expect(radio("Compact")).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-control-density", "compact");
  expect((await radio("Compact").boundingBox())!.height).toBeLessThan(44);
  expect(
    await page
      .locator("html")
      .evaluate((node) => (node as HTMLElement).style.getPropertyValue("--font-sans")),
  ).toBe('"Verdana", sans-serif');
});

test("elastic appearance adjustments retain bounds, persistence and light-mode gates", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Blur is adjustable on macOS only; present a Mac platform so the slider's bounds are exercised.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
  });
  await page.goto("/tests/browser/settings/settings.html?section=appearance&theme=dark&lang=en");
  await page.getByRole("radio", { name: /^Olive/ }).click();
  await openBackgroundLayer(page, "Glass");
  // Glass is off by default off Linux; the sliders only act while it is on.
  const glass = page.getByRole("switch", { name: "Glass", exact: true });
  if (!(await glass.isChecked())) await glass.click();
  const opacity = page
    .locator('[data-setting-id="sidebar-opacity"]')
    .getByRole("slider", { name: "Sidebar opacity", exact: true });
  await opacity.press("Home");
  await opacity.press("End");
  await expect(opacity).toHaveAttribute("aria-valuenow", "100");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("bycoda.sidebarOpacity")))
    .toBe("1");
  await opacity.press("ArrowLeft");
  await expect(opacity).toHaveAttribute("aria-valuetext", "99%");
  await page.screenshot({
    path: "temp/verification/2026-10-16-ui-system/W5a-SETTINGS-elastic-custom-dark.png",
  });
  await page.reload();
  await openBackgroundLayer(page, "Glass");
  await expect(opacity).toHaveAttribute("aria-valuenow", "99");
  const blur = page
    .locator('[data-setting-id="blur"]')
    .getByRole("slider", { name: "Blur radius", exact: true });
  await blur.press("Home");
  await expect(blur).toHaveAttribute(
    "aria-valuenow",
    (await blur.getAttribute("aria-valuemin")) ?? "",
  );
  await page.goto("/tests/browser/settings/settings.html?section=appearance&theme=light&lang=en");
  await openBackgroundLayer(page, "Glass");
  await expect(opacity).toHaveAttribute("aria-disabled", "true");
  await expect(blur).toHaveAttribute("aria-disabled", "true");
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

const sections = [
  "general",
  "appearance",
  "notifications",
  "keybindings",
  "workspace",
  "terminal",
  "chat",
  "providers",
  "usage",
  "mcp",
  "skills",
  "inbox",
  "worktrees",
  "groupLock",
  "archive",
  "connections",
  "policies",
];

for (const theme of ["light", "dark"])
  for (const width of [390, 768, 800, 1024, 1280, 1440]) {
    test(`keybindings recording and filters: ${theme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/settings/settings.html?section=keybindings&theme=${theme}&lang=en`,
      );
      const search = page.getByRole("searchbox", { name: "Filter keybindings", exact: true });
      const geometry = await page
        .locator('[data-settings-section="keybindings"]')
        .evaluate((form) => {
          const style = getComputedStyle(form);
          return {
            available:
              form.clientWidth -
              parseFloat(style.paddingInlineStart) -
              parseFloat(style.paddingInlineEnd),
            content: form.querySelector(".settings-group")!.getBoundingClientRect().width,
          };
        });
      expect(geometry.content).toBeGreaterThan(geometry.available * 0.98);
      await search.fill("Open Inbox");
      const recorder = page.getByRole("button", {
        name: "Change App: Open Inbox shortcut",
        exact: true,
      });
      await expect(recorder).toBeVisible();
      await recorder.click();
      await page.keyboard.press("Control+Alt+q");
      await expect(recorder).toContainText("Q");
      await expect(page.getByText("Modified", { exact: true })).toBeVisible();
      await expect(page.getByText(/^Default:/)).toBeVisible();
      const feedback = page
        .locator(".settings-row")
        .filter({ has: recorder })
        .getByRole("status")
        .filter({ hasText: "Saved" });
      // Saved confirmation is a quiet status with no redundant details disclosure.
      await expect(feedback).toHaveText("Saved");
      await expect(feedback.getByRole("button")).toHaveCount(0);
      await page.reload();
      await search.fill("Open Inbox");
      await expect(recorder).toContainText("Q");
      await recorder.click();
      await page.keyboard.press("Escape");
      await expect(recorder).toContainText("Q");
      await recorder.click();
      await page.keyboard.press("Control+k");
      const conflict = page.getByRole("alert");
      await expect(conflict).toContainText("Could not save shortcut");
      // The conflicting owner is the cause, which opens from the alert's Details action.
      await conflict.getByRole("button", { name: "Details" }).click();
      await expect(page.getByText(/Already used by/).first()).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(recorder).toContainText("Q");
      const recorderBounds = (await recorder.boundingBox())!;
      const resetBounds = (await page
        .getByRole("button", {
          name: "Reset App: Open Inbox shortcut",
          exact: true,
        })
        .boundingBox())!;
      // Conflict feedback must not collapse the recorder beneath its reset
      // action and leave pointer activation waiting behind another control.
      expect(recorderBounds.width).toBeGreaterThan(40);
      expect(recorderBounds.x + recorderBounds.width).toBeLessThanOrEqual(resetBounds.x + 1);
      if ([390, 800, 1280].includes(width)) {
        const conflictCaptures =
          "temp/verification/2026-11-01-release-performance/keybindings-conflict";
        mkdirSync(conflictCaptures, { recursive: true });
        await page.screenshot({ path: `${conflictCaptures}/${theme}-${width}.png` });
      }
      await recorder.click();
      await page.keyboard.press("Delete");
      await expect(recorder).toContainText("Disabled");
      await page.getByRole("button", { name: "Filters", exact: true }).click();
      const filters = page.getByRole("dialog", { name: "Filters", exact: true });
      await filters.getByRole("button", { name: "Status: All bindings", exact: true }).click();
      await page.getByRole("option", { name: "Disabled", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(recorder).toBeVisible();
      await page
        .getByRole("button", { name: "Reset App: Open Inbox shortcut", exact: true })
        .click();
      await expect(page.getByText("No matching bindings")).toBeVisible();
      await page.getByRole("button", { name: "Reset filters", exact: true }).click();
      await expect(recorder).toBeVisible();
      await expect(recorder).toContainText("I");
      // Filters reset independently of the search text, so clear it before searching by category.
      await search.clear();
      await page.getByRole("button", { name: "Filters", exact: true }).click();
      await filters.getByRole("button", { name: "Category: All categories", exact: true }).click();
      await page.getByRole("option", { name: "Pane", exact: true }).click();
      await filters.getByRole("button", { name: "Status: All bindings", exact: true }).click();
      await page.getByRole("option", { name: "Unassigned", exact: true }).click();
      await page.keyboard.press("Escape");
      const layoutRecorder = page.getByRole("button", {
        name: "Change Pane: Arrange Grid shortcut",
        exact: true,
      });
      await expect(layoutRecorder).toContainText("Unassigned");
      const firstRow = page.locator(".settings-row").first();
      expect((await firstRow.boundingBox())!.height).toBeLessThan(120);
      await expect(firstRow).not.toContainText("When: Always");
      await page.getByRole("heading", { name: "Shortcuts", exact: true }).scrollIntoViewIfNeeded();
      await layoutRecorder.click();
      await page.keyboard.press("Control+Alt+g");
      await expect(layoutRecorder).toHaveCount(0);
      await page.getByRole("button", { name: "Filters", exact: true }).click();
      await filters.getByRole("button", { name: "Reset filters", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(layoutRecorder).toContainText("G");
      await page
        .getByRole("button", { name: "Reset Pane: Arrange Grid shortcut", exact: true })
        .click();
      await expect(layoutRecorder).toContainText("Unassigned");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `temp/verification/2026-10-15-keybindings/${theme}-${width}.png`,
      });
      // The recording rules are no longer explained by an inline help popover.
      await expect(page.getByRole("button", { name: "Shortcut help", exact: true })).toHaveCount(0);
    });
  }
const languages = ["en", "tr", "de", "fr", "es", "pt", "zh-CN", "ja"];
const captures = "temp/verification/settings-integrated/screens";

test("shared appearance controls preserve palette persistence and provide color recovery", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [390, 1440])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `/tests/browser/settings/settings.html?section=appearance&theme=${theme}&lang=en`,
      );
      const studio = page.getByRole("region", { name: "Theme and colors", exact: true });
      // The 9 workspace-preview galleries were replaced by named palette chips and a segmented scheme.
      await expect(studio.locator(".appearance-workspace-preview")).toHaveCount(0);
      await expect(
        studio.getByRole("radiogroup", { name: "Color scheme", exact: true }).getByRole("radio"),
      ).toHaveCount(3);
      await expect(studio.locator("details, summary")).toHaveCount(0);
      const olive = studio.getByRole("radio", { name: /^Olive/ });
      const palettes = studio.getByRole("radiogroup", { name: "Theme palettes", exact: true });
      await expect(palettes.getByRole("radio")).toHaveCount(6);
      for (const name of ["bycoda", "Olive", "Tide", "Kiln", "Dusk", "Ink"]) {
        const palette = palettes.getByRole("radio", { name: new RegExp(`^${name}`) });
        await palette.scrollIntoViewIfNeeded();
        await expect(palette).toBeInViewport();
      }
      await olive.click();
      await expect(olive).toBeChecked();
      await page.reload();
      await expect(olive).toBeChecked();
      await studio.getByRole("button", { name: "Reset colors", exact: true }).click();
      await expect(studio.getByRole("radio", { name: /^bycoda/ })).toBeChecked();
      await studio
        .getByRole("radiogroup", { name: "Color scheme", exact: true })
        .getByRole("radio", { name: theme === "light" ? "Light" : "Dark", exact: true })
        .click();
      await expect(page.locator("html")).toHaveClass(
        theme === "light" ? /theme-light/ : /^(?!.*theme-light)/,
      );
      await studio
        .getByRole("radiogroup", { name: "Color scheme", exact: true })
        .evaluate((node) => {
          const scroller = node.closest<HTMLElement>("[data-settings-scroller]")!;
          scroller.scrollTop +=
            node.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
          window.scrollTo(0, 0);
        });
      await page.screenshot({
        path: testInfo.outputPath(`appearance-${width}-${theme}.png`),
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
});

test("category keyboard navigation retains focus and search opens an advanced control", async ({
  page,
}) => {
  await page.goto("/tests/browser/settings/settings.html");
  const tabs = page
    .getByRole("tablist", { name: "Settings categories", exact: true })
    .getByRole("tab");
  await expect(tabs.first()).toBeVisible();
  await tabs.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(tabs.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tabs.first()).toBeFocused();
  await page.getByRole("button", { name: "Search settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Search settings", exact: true }).fill("Saturation");
  await expect(page.getByRole("option").first()).toContainText("Saturation");
  await page.getByRole("combobox", { name: "Search settings", exact: true }).press("Enter");
  const target = page.locator('[data-setting-id="saturation"]');
  await expect(target).toBeVisible();
  await expect(target.getByRole("slider")).toBeFocused();
  await expect(target.locator("xpath=ancestor::details")).toHaveCount(0);
  await page.getByRole("button", { name: "Search settings", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Search settings", exact: true });
  await search.fill("Codex · Add existing account");
  await expect(page.getByRole("option").first()).toContainText("Codex");
  await search.press("Enter");
  const terminalProfiles = page.getByRole("dialog", {
    name: "Accounts on this computer",
    exact: true,
  });
  await expect(terminalProfiles).toBeVisible();
  await expect(
    page.locator('[data-setting-id="terminal-account-profiles-codex"] button').first(),
  ).toBeFocused();
  await expect(page.locator(".provider-cli-option[aria-current=true]")).toContainText("Codex");
  await page.keyboard.press("Escape");
  await expect(terminalProfiles).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add existing account", exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("button", { name: "Search settings", exact: true })).toBeVisible();
});

test("automatic settings preserve values and dependent controls after reopening and reload", async ({
  page,
}) => {
  await page.goto("/tests/browser/settings/settings.html");
  const toggle = page.locator('[data-setting-id="keep-awake"] [role="switch"]');
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "Back to workspace" }).click();
  await page.getByRole("button", { name: "Reopen settings" }).click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await page.getByRole("tab", { name: "Notifications", exact: true }).click();
  const summary = page.getByRole("switch", { name: "Daily summary", exact: true });
  await expect(summary).toBeDisabled();
  await page.getByRole("switch", { name: "Desktop notifications", exact: true }).click();
  await expect(summary).toBeEnabled();
});

test("explicit template validation, save status and persistence preserve the last saved value", async ({
  page,
}) => {
  await page.goto("/tests/browser/settings/settings.html?section=chat");
  await page.getByRole("button", { name: "Add template", exact: true }).click();
  await page.getByRole("button", { name: "Save templates", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("textbox", { name: "Template name", exact: true }).fill("Review code");
  await page
    .getByRole("textbox", { name: "Template text", exact: true })
    .fill("Find bugs and explain their impact.");
  await page.getByRole("button", { name: "Save templates", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeDisabled();
  await page.getByRole("textbox", { name: "Template text", exact: true }).fill("Unsaved revision");
  await page.getByRole("button", { name: "Back to workspace" }).click();
  await page.getByRole("button", { name: "Reopen settings" }).click();
  // The unsaved draft survives closing and reopening Settings and stays visibly unsaved;
  // discarding it restores the last saved value.
  await expect(page.getByRole("textbox", { name: "Template text", exact: true })).toHaveValue(
    "Unsaved revision",
  );
  await expect(page.getByRole("button", { name: "Save templates", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Discard changes and reload", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Template text", exact: true })).toHaveValue(
    "Find bugs and explain their impact.",
  );
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Template name", exact: true })).toHaveValue(
    "Review code",
  );
});

// Every locale/theme/size uses the same real 17-category screen. Screenshots
// support manual review; geometry assertions catch disappearing/overflowing fields.
for (const lang of languages)
  for (const theme of ["light", "dark"])
    for (const width of [390, 1440]) {
      test(`all categories and advanced fields: ${lang} ${theme} ${width}`, async ({ page }) => {
        test.setTimeout(180_000);
        mkdirSync(captures, { recursive: true });
        await page.setViewportSize({ width, height: 900 });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        for (const section of sections) {
          await page.goto(
            `/tests/browser/settings/settings.html?lang=${lang}&theme=${theme}&section=${section}`,
          );
          await expect(page.locator(".bycoda-settings-panel")).toBeVisible();
          const categoryPicker = page.locator(".bycoda-settings-category-picker");
          await expect(
            (await categoryPicker.isVisible())
              ? categoryPicker.getByRole("button")
              : page.locator(".bycoda-settings-categories").getByRole("tab", { selected: true }),
          ).toBeVisible();
          await expect(page.locator(".bycoda-settings-panel")).toBeVisible();
          await page.waitForTimeout(100);
          const overflow = await page.locator(".bycoda-settings-panel").evaluate((panel) => {
            const bounds = panel.getBoundingClientRect();
            return [
              ...panel.querySelectorAll<HTMLElement>(
                "input,textarea,[role=switch],[role=slider],[aria-haspopup=listbox]",
              ),
            ]
              .filter((node) => node.getClientRects().length > 0)
              .filter((node) => {
                const rect = node.getBoundingClientRect();
                return (
                  rect.width < 1 || rect.left < bounds.left - 2 || rect.right > bounds.right + 2
                );
              })
              .map((node) => node.getAttribute("aria-label") ?? node.tagName);
          });
          expect(overflow, `${section} controls remain inside the panel`).toEqual([]);
          const squeezedDescriptions = await page
            .locator(".bycoda-settings-panel")
            .evaluate((panel) =>
              [
                ...panel.querySelectorAll<HTMLElement>(
                  ".settings-group-title .settings-description",
                ),
              ]
                .filter(
                  (node) =>
                    !node.closest(".sr-only") &&
                    node.getClientRects().length > 0 &&
                    node.getBoundingClientRect().width < 150,
                )
                .map((node) => node.textContent),
            );
          expect(
            squeezedDescriptions,
            `${section} group descriptions retain readable width`,
          ).toEqual([]);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          const scroller = page.locator("[data-settings-scroller]");
          if (await scroller.count()) {
            const dimensions = await scroller.evaluate((node) => ({
              height: node.clientHeight,
              total: node.scrollHeight,
            }));
            for (
              let top = 0, frame = 0;
              top < dimensions.total;
              top += Math.max(1, dimensions.height - 80), frame++
            ) {
              await scroller.evaluate((node, top) => {
                node.scrollTop = top;
              }, top);
              await page.screenshot({
                path: `${captures}/${lang}-${theme}-${width}-${section}-${frame}.png`,
              });
            }
          } else
            await page.screenshot({
              path: `${captures}/${lang}-${theme}-${width}-${section}-0.png`,
            });
        }
        // Direct sub-screens are opened and cancelled, never saved to native state.
        for (const section of ["mcp", "worktrees", "groupLock"] as const) {
          await page.goto(
            `/tests/browser/settings/settings.html?lang=${lang}&theme=${theme}&section=${section}`,
          );
          const main = page.locator("main");
          await expect(main).toHaveAttribute("data-fixture-labels", /mcp/);
          const labels = JSON.parse((await main.getAttribute("data-fixture-labels"))!) as Record<
            string,
            string
          >;
          const trigger = page.getByRole("button", {
            name: labels[section === "groupLock" ? "password" : section],
            exact: true,
          });
          await trigger.click();
          const dialog = page.getByRole("dialog");
          await expect(dialog).toBeVisible();
          expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 2)).toBe(
            true,
          );
          await page.screenshot({
            path: `${captures}/${lang}-${theme}-${width}-${section}-dialog.png`,
          });
          await page.keyboard.press("Escape");
          await expect(dialog).toHaveCount(0);
          await expect(trigger).toBeFocused();
        }
        expect(errors).toEqual([]);
      });
    }
