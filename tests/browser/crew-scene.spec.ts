import { test, expect } from "@playwright/test";

test("young portraits render every identity and expression in seated and working poses", async ({
  page,
}, testInfo) => {
  // The shared Vite fixture server can spend a minute compiling its cold graph on Windows.
  test.setTimeout(120_000);
  // This matrix exercises the painter alone; skip the unrelated React/CSS fixture graph.
  await page.route("**/tests/browser/crew-scene.tsx", (route) =>
    route.fulfill({ contentType: "text/javascript", body: "export {};" }),
  );
  await page.goto("/tests/browser/crew-scene.html");
  await page.addStyleTag({
    content:
      "body { background: oklch(0.14 0 none); margin: 0; } canvas { display: block; inline-size: 100%; }",
  });
  for (const stage of [0, 1, 2]) {
    for (const stand of [0, 1]) {
      const result = await page.evaluate(
        async ({ stage, stand }) => {
          const modulePath = "/src/features/sessions/ui/crewCodeArt.ts";
          const { createCodeArtPainter } = await import(/* @vite-ignore */ modulePath);
          const canvas = document.createElement("canvas");
          canvas.setAttribute("aria-label", "Portrait review");
          document.body.replaceChildren(canvas);
          const paint = createCodeArtPainter(canvas, { renderer: "canvas" });
          const states = Array.from({ length: 12 }, (_, id) => ({
            stand,
            talk: id === 6 ? 0.8 : 0,
            working: stand === 1,
            role: id === 2 ? "lead" : id === 3 ? "advisor" : "subagent",
            age: { stage, growth: 1 },
            arrival: 1,
            laugh: id === 7 ? 1 : 0,
            blink: id === 8 ? 1 : 0,
            emphasis: id === 9 ? 1 : 0,
            thought: id === 10 ? 1 : 0,
            smoking: id === 11 && stand === 0,
            smokeLift: 0.8,
          }));
          paint(
            states.map((_, id) => (id === 5 && !stand ? "sip" : "idle")),
            states,
            1280,
            1600,
          );
          const c = canvas.getContext("2d")!;
          const pixels = c.getImageData(0, 0, canvas.width, canvas.height).data;
          const { crewLayout } = await import(
            /* @vite-ignore */ "/src/features/sessions/ui/crewLayout.ts"
          );
          const counts = crewLayout(12, 1280).map(
            (seat: { x: number; y: number; scale: number }) => {
              let count = 0;
              // Inspect each head/body column, excluding the sign and floor.
              for (
                let y = Math.round((seat.y + 70 - 155 * seat.scale) * 3);
                y < (seat.y + 60) * 3;
                y++
              )
                for (
                  let x = Math.round((seat.x - 15 * seat.scale) * 3);
                  x < (seat.x + 15 * seat.scale) * 3;
                  x++
                )
                  if (pixels[(y * canvas.width + x) * 4 + 3] > 24) count++;
              return count;
            },
          );
          // Capture the usual six-seat view at a readable portrait size.
          paint(
            states.slice(0, 6).map((_, id) => (id === 5 && !stand ? "sip" : "idle")),
            states.slice(0, 6),
            1280,
            1600,
          );
          return counts;
        },
        { stage, stand },
      );
      expect(result).toHaveLength(12);
      expect(result.every((count: number) => count > 80)).toBe(true);
      await page.locator('canvas[aria-label="Portrait review"]').screenshot({
        path: testInfo.outputPath(`portraits-${stage}-${stand}.png`),
      });
    }
  }
});

test("crew ages only used seats and keeps assigned names above each member", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("bycoda.language", "en");
  });
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.goto("/tests/browser/crew-scene.html");
  const labels = page.locator(".crew-scene__label");
  const expectLabelsAboveHeads = async () => {
    await expect
      .poll(() =>
        page.locator(".crew-scene__stage").evaluate((stage) => {
          const canvas = stage.querySelector("canvas")!;
          const pixels = canvas
            .getContext("2d")!
            .getImageData(0, 0, canvas.width, canvas.height).data;
          const bounds = canvas.getBoundingClientRect();
          const scale = canvas.width / bounds.width;
          return [...stage.querySelectorAll(".crew-scene__label")].every((label) => {
            const box = label.getBoundingClientRect();
            const center = ((box.left + box.right) / 2 - bounds.left) * scale;
            const radius = (20 / 760) * canvas.width;
            // Ignore the hanging sign; find the first painted head/headwear glyph in this seat.
            for (let y = Math.ceil((76 / 390) * canvas.height); y < canvas.height; y++) {
              for (
                let x = Math.max(0, Math.floor(center - radius));
                x < Math.min(canvas.width, center + radius);
                x++
              ) {
                if (pixels[(y * canvas.width + x) * 4 + 3] > 24)
                  return box.bottom <= bounds.top + y / scale;
              }
            }
            return false;
          });
        }),
      )
      .toBe(true);
  };
  await expect(labels).toHaveCount(6);
  await expect(page.locator('.crew-scene__label[data-age="3"]')).toHaveCount(6);
  await expectLabelsAboveHeads();
  await page.screenshot({ path: testInfo.outputPath("empty.png") });
  await page.getByRole("button", { name: "Start session", exact: true }).click();
  await expect(page.locator('.crew-scene__label[data-age="0"]')).toHaveCount(6);
  await expectLabelsAboveHeads();
  await page.screenshot({ path: testInfo.outputPath("first-message.png") });
  await page.getByRole("button", { name: "Use helpers", exact: true }).click();
  await expect(labels.filter({ hasText: /^Designer$/ })).toHaveAttribute("data-age", "3");
  await expect(page.locator('.crew-scene__label[data-role="lead"]')).toHaveAttribute(
    "data-age",
    "2",
  );
  await expect(page.locator('.crew-scene__label[data-role="advisor"]')).toHaveAttribute(
    "data-age",
    "0",
  );
  await expect(page.locator('.crew-scene__label[data-age="0"]')).toHaveCount(4);
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(labels.filter({ hasText: /^Designer$/ })).toHaveAttribute("data-working", "false");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(labels.filter({ hasText: /^UX Designer$/ })).toHaveCount(1);
  await expectLabelsAboveHeads();
  await page.screenshot({ path: testInfo.outputPath("named-used-crew.png") });

  await page
    .getByLabel("Name", { exact: true })
    .fill("Designer with a very long assigned agent name for checking crowded labels");
  await page.getByLabel("Helpers", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Use helpers", exact: true }).click();
  await expect(labels).toHaveCount(12);
  for (const width of [1100, 420]) {
    await page.setViewportSize({ width, height: 700 });
    await expect
      .poll(() =>
        labels.evaluateAll((elements) => {
          const boxes = elements.map((element) => element.getBoundingClientRect());
          return (
            boxes.every((box) => box.left >= 0 && box.right <= innerWidth && box.top >= 0) &&
            boxes.every((box, index) =>
              boxes.every(
                (other, otherIndex) =>
                  index === otherIndex ||
                  box.right <= other.left + 1 ||
                  other.right <= box.left + 1 ||
                  box.bottom <= other.top + 1 ||
                  other.bottom <= box.top + 1,
              ),
            )
          );
        }),
      )
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`crowd-${width}.png`) });
  }
  await page.getByRole("button", { name: "Growth off", exact: true }).click();
  await expect(page.locator('.crew-scene__label[data-age="3"]')).toHaveCount(12);
  await page.getByRole("button", { name: "Toggle background", exact: true }).click();
  await expect(page.locator(".crew-scene--background")).toHaveAttribute("aria-hidden", "true");
  await page.screenshot({ path: testInfo.outputPath("background.png") });
});
