import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const output = "temp/verification/2026-11-04-global-assistant-room";
const globalMessage = "Nightly follow-up across projects";
const projectMessage = "Keep an eye on recovery and prepare the release notes.";

async function capture(page: Page, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: join(output, `${name}.png`), animations: "disabled" });
}

for (const theme of ["light", "dark"])
  for (const width of [1280, 800])
    test(`global Room preserves explicit targets ${theme} ${width}`, async ({ page }) => {
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/tests/browser/assistant/assistant-room.html?global-room&theme=${theme}`);
      await page.waitForLoadState("networkidle");
      const room = page.getByRole("main");
      const threads = room.getByRole("complementary", { name: "Conversations" });
      const draft = room.getByPlaceholder("Message Arif", { exact: true });
      await expect(room.getByText(globalMessage, { exact: true })).toBeVisible();
      await expect(room.getByText(projectMessage, { exact: true })).toHaveCount(0);
      await draft.fill("Global unsent management draft");
      await capture(page, `room-global-${theme}-${width}`);
      await room.getByText("Recorded actions", { exact: false }).click();
      await expect(room.getByText("servers.list", { exact: false })).toBeVisible();
      await expect(room.getByText("Outcome unknown", { exact: false })).toBeVisible();
      await capture(page, `room-actions-${theme}-${width}`);
      await room.getByText("Recorded actions", { exact: false }).click();

      await threads.getByRole("button", { name: /^Upstream/ }).click();
      await expect(room.getByText(projectMessage, { exact: true })).toBeVisible();
      await expect(room.getByText(globalMessage, { exact: true })).toHaveCount(0);
      await expect(draft).toHaveValue("");
      await draft.fill("Explicit project unsent draft");
      await capture(page, `room-project-${theme}-${width}`);
      await threads.getByRole("button", { name: /^Global/ }).click();
      await expect(room.getByText(globalMessage, { exact: true })).toBeVisible();
      await expect(draft).toHaveValue("Global unsent management draft");
      await threads.getByRole("button", { name: /^Upstream/ }).click();
      await expect(draft).toHaveValue("Explicit project unsent draft");
      const requests = await page.evaluate(() => (window as any).__globalRoomRequests);
      expect(
        requests.filter((request: any) =>
          /sessions\.(create|send)|threads.send/.test(request.input?.op ?? request.method),
        ),
      ).toEqual([]);

      await page.goto(
        `/tests/browser/assistant/assistant-room.html?global-room&no-projects&theme=${theme}`,
      );
      await page.waitForLoadState("networkidle");
      await expect(room.getByText(globalMessage, { exact: true })).toBeVisible();
      await expect(threads.getByRole("button", { name: /^Upstream/ })).toHaveCount(0);
      await expect(
        room.getByRole("button", { name: "Open conversation", exact: true }),
      ).toBeEnabled();
      await room.getByRole("button", { name: "Open conversation", exact: true }).click();
      await expect(room.getByText(globalMessage, { exact: true })).toBeVisible();
      await capture(page, `room-no-projects-${theme}-${width}`);
      const evidence = await page.evaluate(() => ({
        requests: (window as any).__globalRoomRequests,
        native: (window as any).__globalRoomNativeRequests,
      }));
      expect(
        evidence.requests.find((request: any) => request.input?.op === "threads.open").input,
      ).toEqual({ op: "threads.open" });
      expect(
        evidence.native.some(
          (request: any) =>
            request.command === "control_assistant_source_v2" &&
            request.input.threadId === "thread-global" &&
            request.input.environmentId === "fixture-local-host" &&
            request.input.active &&
            request.input.role === "interactive",
        ),
      ).toBe(true);
      for (const registration of evidence.native.filter(
        (request: any) => request.command === "control_assistant_source_v2",
      ))
        expect(registration.input).toEqual({
          threadId: "thread-global",
          environmentId: "fixture-local-host",
          active: expect.any(Boolean),
          sequence: expect.any(Number),
          role: "interactive",
        });
      expect(
        evidence.requests.some(
          (request: any) => request.input?.sessionId || request.input?.projectId,
        ),
      ).toBe(false);
    });
