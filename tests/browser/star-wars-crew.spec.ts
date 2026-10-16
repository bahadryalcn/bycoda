import { test, expect, type Page } from "@playwright/test";
import type { MotionFrameOptions } from "./crew-scene";

const characters = [
  "darth-vader",
  "leia",
  "obi-wan",
  "yoda",
  "luke",
  "chewbacca",
  "r2-d2",
] as const;

test("initial crew title clears all character labels in hero and background panes", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("bycoda.language", "en");
    localStorage.setItem("bycoda.crewTheme", "star-wars");
  });
  await page.goto("/tests/browser/crew-scene.html");
  const scene = page.locator(".crew-scene");
  await expect(scene).toHaveAttribute("data-art-status", "ready");
  await expect(scene.locator(".crew-scene__label")).toHaveCount(6);
  for (const variant of ["hero", "background"]) {
    if (variant === "background") {
      await page.getByRole("button", { name: "Toggle background", exact: true }).click();
    }
    for (const width of [320, 420, 800, 1200]) {
      await page.setViewportSize({ width, height: 950 });
      await expect.poll(() => scene.evaluate((element) => {
        const title = element.querySelector(".crew-scene__theme-title")!.getBoundingClientRect();
        return [...element.querySelectorAll(".crew-scene__label")].every((label) =>
          label.getBoundingClientRect().top >= title.bottom + 4,
        );
      })).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await scene.screenshot({ path: testInfo.outputPath(`initial-${variant}-${width}.png`) });
    }
  }
});

/** Compare actual production pixels, keeping large image buffers inside the browser. */
async function sampleMotionFrames(page: Page, frames: MotionFrameOptions[]) {
  return page.evaluate(async (options) => {
    const canvas = document.getElementById("star-wars-motion") as HTMLCanvasElement;
    let baseline: Uint8ClampedArray | undefined;
    const results = [];
    for (const option of options) {
      const { regions } = await window.renderStarWarsFrame!(option);
      const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      baseline ??= pixels;
      const difference = (top: number, bottom: number) => {
        let count = 0;
        for (let y = top; y < bottom; y++) {
          for (let x = 8; x < canvas.width - 8; x++) {
            const offset = (y * canvas.width + x) * 4;
            let delta = 0;
            for (let channel = 0; channel < 4; channel++) {
              delta += Math.abs(pixels[offset + channel] - baseline![offset + channel]);
            }
            if (delta > 10) count++;
          }
        }
        return count;
      };
      let fingerprint = 2166136261;
      let visible = 0;
      let greenBlade = 0;
      let bladeLeft = canvas.width,
        bladeTop = canvas.height,
        bladeRight = -1,
        bladeBottom = -1;
      let solidBottom = 0;
      for (let offset = 0; offset < pixels.length; offset++) {
        fingerprint = Math.imul(fingerprint ^ pixels[offset], 16777619);
        if (offset % 4 === 3 && pixels[offset] > 20) visible++;
        if (offset % 4 === 0 && pixels[offset + 3] > 180) {
          const red = pixels[offset],
            green = pixels[offset + 1],
            blue = pixels[offset + 2];
          const y = Math.floor(offset / 4 / canvas.width);
          if (green > 200 && green - red > 60 && green - blue > 40) {
            greenBlade++;
            const x = (offset / 4) % canvas.width;
            bladeLeft = Math.min(bladeLeft, x);
            bladeRight = Math.max(bladeRight, x);
            bladeTop = Math.min(bladeTop, y);
            bladeBottom = Math.max(bladeBottom, y);
          }
          if (y < regions.lower[1] && red + green + blue > 170)
            solidBottom = Math.max(solidBottom, y);
        }
      }
      results.push({
        fingerprint: fingerprint >>> 0,
        visible,
        greenBlade,
        greenBladeExtent: greenBlade
          ? Math.max(bladeRight - bladeLeft + 1, bladeBottom - bladeTop + 1)
          : 0,
        solidBottom,
        head: difference(...regions.head),
        action: difference(...regions.action),
        lower: difference(...regions.lower),
      });
    }
    return results;
  }, frames);
}

test("all seven production rigs articulate their heads and character-specific actions", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/crew-scene.html?motion=1");
  await expect(page.locator("#star-wars-motion")).toBeVisible();
  for (const character of characters) {
    const timeline = await sampleMotionFrames(
      page,
      [1200, 3000, 7200, 10800].map((time) => ({ character, time })),
    );
    expect(
      timeline.every(({ visible }) => visible > 4000),
      `${character} artwork is present`,
    ).toBe(true);
    expect(
      new Set(timeline.map(({ fingerprint }) => fingerprint)).size,
      `${character} timeline`,
    ).toBeGreaterThan(2);
    expect(
      timeline.some(({ head }) => head > 20),
      `${character} moving head`,
    ).toBe(true);
    if (character !== "r2-d2") {
      expect(
        timeline.some(({ action }) => action > 40),
        `${character} moving arm/staff/weapon`,
      ).toBe(true);
    }
    // Stabilize the rigid body transform so head/arm changes cannot pass merely
    // because the entire character translates or rotates (including R2-D2).
    const gestures = await sampleMotionFrames(page, [
      {
        character,
        time: 3000,
        stabilizeBody: true,
        state: {
          stand: character === "r2-d2" ? 0 : 1,
          turn: -1,
          nod: 0,
          talk: 0,
          gesture: 0,
          blink: 0,
          thought: 0,
          emphasis: 0,
        },
      },
      {
        character,
        time: 3000,
        stabilizeBody: true,
        state: {
          stand: 1,
          turn: 1,
          nod: 1,
          talk: 1,
          gesture: 1,
          blink: 1,
          thought: 1,
          emphasis: 0,
        },
      },
    ]);
    expect(
      gestures[1].head,
      `${character} head articulation without body movement`,
    ).toBeGreaterThan(20);
    if (character !== "r2-d2") {
      expect(
        gestures[1].action,
        `${character} arm articulation without body movement`,
      ).toBeGreaterThan(40);
    }
    await page
      .locator("#star-wars-motion")
      .screenshot({ path: testInfo.outputPath(`${character}-gesture.png`) });
  }
});

test("Yoda visibly changes from his cane to a green blade and a Jedi leap", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/crew-scene.html?motion=1");
  await expect(page.locator("#star-wars-motion")).toBeVisible();
  // The advisor occupies seat 3, whose performance clock is staggered by 5199ms.
  const [cane, jedi, settled] = await sampleMotionFrames(
    page,
    [801, 9401, 12_601].map((time) => ({
      character: "yoda",
      time,
      charge: 1,
    })),
  );
  expect(cane.greenBlade).toBeLessThan(10);
  expect(jedi.greenBlade).toBeGreaterThan(50);
  expect(
    jedi.greenBladeExtent,
    "Yoda's luminous blade remains visible beyond a small hilt stub",
  ).toBeGreaterThanOrEqual(75);
  expect(settled.greenBlade).toBeLessThan(10);
  expect(
    cane.solidBottom - jedi.solidBottom,
    "Yoda's feet and robe rise clear of the docking ring",
  ).toBeGreaterThan(25);
  const charged = await sampleMotionFrames(
    page,
    [0, 0.5, 1].map((charge) => ({ character: "yoda", time: 9401, charge })),
  );
  expect(charged[1].head).toBe(0);
  expect(charged[2].head).toBeGreaterThan(40);
  await page
    .locator("#star-wars-motion")
    .screenshot({ path: testInfo.outputPath("yoda-jedi-leap.png") });
});

test("blasters visibly recoil through their weapon rigs while the body is stabilized", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/crew-scene.html?motion=1");
  await expect(page.locator("#star-wars-motion")).toBeVisible();
  for (const [character, firingTime] of [
    ["leia", 817],
    ["chewbacca", 5935],
  ] as const) {
    const frames = await sampleMotionFrames(
      page,
      [firingTime - 1, firingTime].map((time) => ({
        character,
        time,
        stabilizeBody: true,
      })),
    );
    expect(
      frames[1].action,
      `${character} arm and gun move independently during recoil`,
    ).toBeGreaterThan(80);
    await page
      .locator("#star-wars-motion")
      .screenshot({ path: testInfo.outputPath(`${character}-recoil.png`) });
  }
});

test("disabled motion freezes every rig and color fill stays aligned while moving", async ({
  page,
}) => {
  await page.goto("/tests/browser/crew-scene.html?motion=1");
  await expect(page.locator("#star-wars-motion")).toBeVisible();
  for (const character of characters) {
    const frozen = await sampleMotionFrames(
      page,
      [100, 3000, 7200, 14800].map((time) => ({
        character,
        time,
        animate: false,
        state: { talk: 1, gesture: 1, blink: 1, turn: 1 },
      })),
    );
    expect(
      new Set(frozen.map(({ fingerprint }) => fingerprint)).size,
      `${character} frozen frame`,
    ).toBe(1);
    const charged = await sampleMotionFrames(
      page,
      [0, 0.5, 1].map((charge) => ({
        character,
        time: 3600,
        charge,
        state: { gesture: 0.8, turn: 0.5, talk: 0.6 },
      })),
    );
    expect(charged[1].head, `${character} neutral head at half charge`).toBe(0);
    expect(charged[1].lower, `${character} color fills the lower figure`).toBeGreaterThan(40);
    expect(charged[2].head, `${character} color reaches its moving head`).toBeGreaterThan(40);
  }
});

test("the live scene honors reduced motion and the stored decorative-motion preference", async ({
  page,
}) => {
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("bycoda.language", "en");
    localStorage.setItem("bycoda.crewTheme", "star-wars");
    localStorage.setItem("bycoda.decorativeMotion.v1", "true");
  });
  await page.goto("/tests/browser/crew-scene.html");
  const scene = page.locator(".crew-scene");
  await expect(scene).toHaveAttribute("data-art-status", "ready");
  await page.getByLabel("Context preview", { exact: true }).fill("100");
  await expect(scene).toHaveAttribute("data-motion", "running");
  const frame = () =>
    scene.locator("canvas").evaluate((canvas) => {
      const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      return pixels.reduce((hash, value) => Math.imul(hash ^ value, 16777619), 2166136261) >>> 0;
    });
  // `data-motion` commits before the effect paints the still frame; wait for it to settle.
  const settledFrame = async () => {
    let last = await frame();
    await expect
      .poll(async () => {
        const next = await frame();
        const settled = next === last;
        last = next;
        return settled;
      })
      .toBe(true);
    return last;
  };
  // The loop timer starts in an effect after `data-motion` commits, so advance until it ticks.
  const advancedFrame = () =>
    expect.poll(async () => {
      await page.clock.fastForward(200);
      return frame();
    });
  const moving = await frame();
  await advancedFrame().not.toBe(moving);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(scene).toHaveAttribute("data-motion", "still");
  const reduced = await settledFrame();
  await page.clock.fastForward(1200);
  expect(await frame()).toBe(reduced);

  await page.evaluate(() => {
    localStorage.setItem("bycoda.decorativeMotion.v1", "false");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "bycoda.decorativeMotion.v1", newValue: "false" }),
    );
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(scene).toHaveAttribute("data-motion", "still");
  const disabled = await settledFrame();
  await page.clock.fastForward(1200);
  expect(await frame()).toBe(disabled);
  await page.evaluate(() => {
    localStorage.setItem("bycoda.decorativeMotion.v1", "true");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "bycoda.decorativeMotion.v1", newValue: "true" }),
    );
  });
  await expect(scene).toHaveAttribute("data-motion", "running");
  await advancedFrame().not.toBe(disabled);
});

test("the live crew keeps labels and footprints on one deep crescent as helpers arrive", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("bycoda.language", "en");
    localStorage.setItem("bycoda.crewTheme", "star-wars");
  });
  await page.goto("/tests/browser/crew-scene.html");
  const scene = page.locator(".crew-scene");
  await expect(scene).toHaveAttribute("data-art-status", "ready");
  const geometry = () =>
    scene.evaluate((element) => {
      const labels = [...element.querySelectorAll<HTMLElement>(".crew-scene__label")];
      const canvas = element.querySelector("canvas")!;
      const places = window.starWarsFixtureLayout(
        labels.length,
        canvas.getBoundingClientRect().width,
      );
      const scale = canvas.width / 760;
      const c = canvas.getContext("2d")!;
      return {
        depth: Math.max(...places.map(({ y }) => y)) - Math.min(...places.map(({ y }) => y)),
        anchors: labels
          .map((label) => (parseFloat(label.style.insetInlineStart) * 760) / 100)
          .sort((a, b) => a - b),
        seats: places.map(({ x }) => x).sort((a, b) => a - b),
        footprints: places.map((place) => {
          const pixels = c.getImageData(
            (place.x - 6) * scale,
            (place.y + 68) * scale,
            12 * scale,
            4 * scale,
          ).data;
          return pixels.filter((value, index) => index % 4 === 3 && value > 20).length;
        }),
      };
    });
  for (const count of [6, 7, 12]) {
    if (count > 6) {
      await page.getByLabel("Helpers", { exact: true }).fill(String(count - 2));
      await page.getByRole("button", { name: "Use helpers", exact: true }).click();
    }
    await expect(scene.locator(".crew-scene__label")).toHaveCount(count);
    const result = await geometry();
    expect(result.depth, `${count} seats retain the deep arc`).toBeGreaterThanOrEqual(80);
    result.anchors.forEach((anchor, index) =>
      expect(Math.abs(anchor - result.seats[index])).toBeLessThanOrEqual(0.51),
    );
    expect(
      result.footprints.every((visible) => visible > 5),
      `${count} visible docking footprints`,
    ).toBe(true);
    await scene.screenshot({ path: testInfo.outputPath(`crescent-${count}-wide.png`) });
  }
  await page.setViewportSize({ width: 420, height: 900 });
  const narrow = await geometry();
  expect(narrow.depth).toBeGreaterThanOrEqual(80);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await scene.screenshot({ path: testInfo.outputPath("crescent-12-narrow.png") });
});

test("settings switch crew themes and color fills track context through compaction", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("crew-test-initialized")) {
      localStorage.clear();
      localStorage.setItem("bycoda.language", "en");
      sessionStorage.setItem("crew-test-initialized", "1");
    }
  });
  await page.setViewportSize({ width: 1200, height: 950 });
  await page.goto("/tests/browser/crew-scene.html");
  const scene = page.locator(".crew-scene");
  await expect(scene).toHaveAttribute("data-theme", "classic");
  await page.getByText("Crew settings", { exact: true }).click();
  await page.getByRole("button", { name: /^Crew theme:/ }).click();
  await page.getByRole("option", { name: "Star Wars", exact: true }).click();
  await expect(scene).toHaveAttribute("data-theme", "star-wars");
  await expect(scene).toHaveAttribute("data-art-status", "ready");
  await expect(page.locator('.crew-scene__label[data-character="chewbacca"]')).toHaveCount(1);
  await expect(page.locator('.crew-scene__label[data-character="r2-d2"]')).toHaveCount(0);
  await expect(page.locator('.crew-scene__label[data-role="advisor"]')).toHaveAttribute(
    "data-character",
    "yoda",
  );
  await expect(page.locator('.crew-scene__label[data-role="lead"]')).toHaveAttribute(
    "data-character",
    "obi-wan",
  );
  await expect(page.locator('.crew-scene__label[data-charge="unknown"]')).toHaveCount(6);
  const sample = () =>
    scene.locator("canvas").evaluate((canvas) => {
      const c = canvas.getContext("2d")!;
      const scale = canvas.width / 760;
      const place = window
        .starWarsFixtureLayout(6, canvas.getBoundingClientRect().width)
        .find(({ id }) => id === 2)!;
      const region = (svgY: number, svgHeight: number) => [
        ...c.getImageData(
          (place.x - 17 * place.scale) * scale,
          (place.y + 70 + (-224 + (svgY * 150) / 160) * place.scale) * scale,
          34 * place.scale * scale,
          ((svgHeight * 150) / 160) * place.scale * scale,
        ).data,
      ];
      return { head: region(18, 45), body: region(168, 35) };
    });
  const preview = page.getByLabel("Context preview", { exact: true });
  await preview.fill("0");
  await expect(page.locator('.crew-scene__label[data-charge="0"]')).toHaveCount(6);
  const empty = await sample();
  await preview.fill("50");
  await expect(page.locator('.crew-scene__label[data-charge="50"]')).toHaveCount(6);
  await expect.poll(async () => (await sample()).body).not.toEqual(empty.body);
  expect((await sample()).head).toEqual(empty.head);
  await scene.screenshot({ path: testInfo.outputPath("star-wars-half.png") });
  await preview.fill("100");
  await expect.poll(async () => (await sample()).head).not.toEqual(empty.head);
  await scene.screenshot({ path: testInfo.outputPath("star-wars-full.png") });
  await preview.fill("10");
  await expect(page.locator('.crew-scene__label[data-charge="10"]')).toHaveCount(6);
  await expect.poll(async () => (await sample()).head).toEqual(empty.head);
  await page.getByRole("switch", { name: "Color with context", exact: true }).click();
  await expect(page.locator(".crew-scene__meter")).toHaveCount(0);
  await expect.poll(async () => (await sample()).head).not.toEqual(empty.head);
  await page.reload();
  await expect(scene).toHaveAttribute("data-theme", "star-wars");
  await expect(scene).toHaveAttribute("data-art-status", "ready");
  await expect(page.locator(".crew-scene__meter")).toHaveCount(0);
  await page.getByText("Crew settings", { exact: true }).click();
  await page.getByRole("button", { name: /^Crew theme:/ }).click();
  await page.getByRole("option", { name: "Classic crew", exact: true }).click();
  await expect(scene).toHaveAttribute("data-theme", "classic");
  await expect(page.locator('.crew-scene__label[data-age="3"]')).toHaveCount(6);
  // The same stored setting event updates existing panes without a remount.
  await page.evaluate(() => {
    localStorage.setItem("bycoda.crewTheme", "star-wars");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "bycoda.crewTheme", newValue: "star-wars" }),
    );
  });
  await expect(scene).toHaveAttribute("data-theme", "star-wars");
  await page.getByLabel("Helpers", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Use helpers", exact: true }).click();
  await expect(page.locator(".crew-scene__label")).toHaveCount(7);
  await expect(page.locator('.crew-scene__label[data-character="chewbacca"]')).toHaveCount(1);
  await expect(page.locator('.crew-scene__label[data-character="r2-d2"]')).toHaveCount(1);
  await scene.screenshot({ path: testInfo.outputPath("star-wars-seven.png") });
  await page.getByLabel("Helpers", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Use helpers", exact: true }).click();
  await expect(page.locator(".crew-scene__label")).toHaveCount(12);
  await expect(page.locator('.crew-scene__label[data-character="yoda"]')).toHaveCount(1);
  await expect(page.locator('.crew-scene__label[data-character="obi-wan"]')).toHaveCount(1);
  await page.setViewportSize({ width: 420, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await scene.screenshot({ path: testInfo.outputPath("star-wars-crowd-mobile.png") });
});
