import { expect, test } from "@playwright/test";
import { get } from "node:http";

const captures = "temp/verification/2026-10-29-session-references";

for (const theme of ["light", "dark"])
  for (const width of [1280, 800]) {
    test(`${theme} ${width}: references, details, Notes and recovery`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(() => localStorage.setItem("bycoda.language", "en"));
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      // This machine's Chromium loopback route can stall while direct Node HTTP
      // succeeds. Preserve the actual Vite responses and renderer; only transport
      // between this browser and this fixture is proxied through direct Node fetch.
      if (process.env.BYCODA_REFERENCE_HTTP_SHIM === "1")
        await page.route("http://127.0.0.1:14679/**", async (route) => {
          const response = await new Promise<{
            status: number;
            headers: Record<string, string>;
            body: Buffer;
          }>((resolve, reject) => {
            const request = get(route.request().url(), { agent: false }, (incoming) => {
              const chunks: Buffer[] = [];
              incoming.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
              incoming.on("end", () =>
                resolve({
                  status: incoming.statusCode ?? 500,
                  headers: Object.fromEntries(
                    Object.entries(incoming.headers)
                      .filter(([name]) => !["content-length", "transfer-encoding"].includes(name))
                      .map(([name, value]) => [
                        name,
                        Array.isArray(value) ? value.join(", ") : (value ?? ""),
                      ]),
                  ),
                  body: Buffer.concat(chunks),
                }),
              );
            });
            request.setTimeout(45000, () =>
              request.destroy(new Error(`Fixture HTTP timeout: ${route.request().url()}`)),
            );
            request.on("error", reject);
          });
          await route.fulfill(response);
        });
      await page.goto(`/tests/browser/session-references.html?theme=${theme}`);
      await page.waitForLoadState("networkidle");
      const transcript = page.getByRole("region", { name: "Conversation references" });
      const link = transcript.getByRole("link", { name: "Earlier investigation", exact: true });
      await expect(link).toBeVisible();
      await page.screenshot({
        path: `${captures}/${theme}-${width}-references.png`,
        fullPage: true,
      });
      await link.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("[data-opened]")).toHaveText("Focused: stable-session · turn-2");
      const details = transcript
        .getByRole("button", { name: "Session details", exact: true })
        .first();
      await details.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Session details", exact: true });
      await expect(dialog).toContainText("Current renamed title");
      await expect(link).toHaveText("Earlier investigation");
      await expect(dialog.getByRole("button", { name: "Open beside", exact: true })).toBeEnabled();
      const box = await dialog.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `${captures}/${theme}-${width}-details.png`, fullPage: true });
      await dialog.getByRole("button", { name: "Open beside", exact: true }).click();
      await expect(page.locator("[data-opened]")).toHaveText("Beside: stable-session · turn-2");
      const notes = page.getByRole("region", { name: "Notes references" });
      await notes.getByRole("link", { name: "Related conversation", exact: true }).click();
      await expect(page.locator("[data-note-editing]")).toHaveText("Reading");
      await expect(notes.locator(".cm-editor")).toHaveCount(0);
      await notes.getByRole("button", { name: "Session details", exact: true }).click();
      await expect(dialog).toContainText("Current renamed title");
      await page.screenshot({ path: `${captures}/${theme}-${width}-notes.png`, fullPage: true });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await page.getByRole("checkbox", { name: "Unavailable target" }).check();
      await link.click();
      await expect(transcript).toContainText("This local session is unavailable.");
      await page.screenshot({ path: `${captures}/${theme}-${width}-error.png`, fullPage: true });
      await page.getByRole("checkbox", { name: "Unavailable target" }).uncheck();
      await link.click();
      await expect(page.locator("[data-opened]")).toHaveText("Focused: stable-session · turn-2");
      await page.getByText("Reference copy target", { exact: true }).click({ button: "right" });
      const copyLink = page.getByRole("menuitem", { name: "Copy session link", exact: true });
      await expect(copyLink).toBeVisible();
      await expect(
        page.getByRole("menuitem", { name: "Copy Markdown reference", exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: `${captures}/${theme}-${width}-copy-menu.png`,
        fullPage: true,
      });
      await copyLink.click();
      await expect(page.getByRole("menu")).toContainText("Copied");
      await page.screenshot({ path: `${captures}/${theme}-${width}-copied.png`, fullPage: true });
      expect(errors).toEqual([]);
    });
  }
