import { expect, test } from "@playwright/test";

const captureRoot = "temp/verification/2026-11-04-question-attachments";
const fixturePath =
  process.env.BYCODA_QUESTION_ATTACHMENTS_PATH ?? "/tests/browser/chat/question-flow.html";
const imageBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=";

for (const theme of ["light", "dark"] as const) {
  for (const width of [1280, 800]) {
    test(`question accepts mixed files and retains them at ${width}px in ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`${fixturePath}?attachments=1&theme=${theme}`);
      const form = page.locator("[data-question-form]");
      const answer = form.getByRole("textbox", { name: "Type your answer" });
      await answer.fill("Use attached report and screenshot.");

      // Exercise actual DOM drop and file readers; only the native disk bridge is a fixture.
      await form.evaluate((node) => {
        const data = new DataTransfer();
        data.items.add(
          new File(["%PDF-1.4 fixture report"], "report.pdf", { type: "application/pdf" }),
        );
        node
          .querySelector("form")!
          .dispatchEvent(
            new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }),
          );
      });
      await expect(
        form.getByRole("button", { name: "Remove report.pdf", exact: true }),
      ).toBeVisible();

      await answer.evaluate((node, base64) => {
        const bytes = Uint8Array.from(atob(base64), (value) => value.charCodeAt(0));
        const data = new DataTransfer();
        data.items.add(new File([bytes], "screen.png", { type: "image/png" }));
        node.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
        );
      }, imageBase64);
      await expect(
        form.getByRole("button", { name: "Remove screen.png", exact: true }),
      ).toBeVisible();
      await expect(answer).toHaveValue("Use attached report and screenshot.");

      await form.getByRole("button", { name: "Attach files", exact: true }).click();
      await expect(
        form.getByRole("button", { name: "Remove picked.txt", exact: true }),
      ).toBeVisible();
      await form.getByRole("button", { name: "Remove picked.txt", exact: true }).click();
      await expect(
        form.getByRole("button", { name: "Remove picked.txt", exact: true }),
      ).toHaveCount(0);

      await page.getByRole("button", { name: "Hide question", exact: true }).click();
      await page.getByRole("button", { name: "Show question", exact: true }).click();
      await expect(
        form.getByRole("button", { name: "Remove report.pdf", exact: true }),
      ).toBeVisible();
      await expect(
        form.getByRole("button", { name: "Remove screen.png", exact: true }),
      ).toBeVisible();
      await expect(answer).toHaveValue("Use attached report and screenshot.");
      await expect(form).toHaveJSProperty(
        "scrollWidth",
        await form.evaluate((node) => node.clientWidth),
      );
      await page.screenshot({
        path: `${captureRoot}/mixed-files-${theme}-${width}.png`,
        fullPage: true,
      });

      await form.getByRole("button", { name: "Send answer", exact: true }).click();
      await expect(page.getByLabel("Send count", { exact: true })).toHaveText("1");
      const reply = JSON.parse(
        (await page.getByLabel("Question reply", { exact: true }).textContent()) ?? "null",
      );
      expect(reply.kind).toBe("answered");
      expect(reply.custom.scope).toBe("Use attached report and screenshot.");
      expect(
        reply.attachments.scope.map((file: { name: string; path: string }) => ({
          name: file.name,
          path: file.path,
        })),
      ).toEqual([
        { name: "report.pdf", path: "C:/fixture-attachments/report.pdf" },
        { name: "screen.png", path: "C:/fixture-attachments/screen.png" },
      ]);
      expect(
        reply.attachments.scope.every(
          (file: object) => !Object.hasOwn(file, "data") && !Object.hasOwn(file, "previewUrl"),
        ),
      ).toBe(true);
      await form
        .locator("form")
        .evaluate((node) =>
          node.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
        );
      await expect(page.getByLabel("Send count", { exact: true })).toHaveText("1");
    });
  }
}
