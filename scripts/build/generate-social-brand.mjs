import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// Keep the established raster campaign layout; replace its emblem from vector.
// The surrounding blank background samples remain unchanged, making reruns stable.
const directory = new URL("../../public/brand/bycoda/", import.meta.url);
const header = new URL("x-header-v1.png", directory);
const original = await readFile(header);
const mark = await readFile(new URL("mark-tea-red-dark.svg", directory), "utf8");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const result = await page.evaluate(
    async ({ imageBytes, markSource }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${imageBytes}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const before = context.getImageData(0, 0, canvas.width, canvas.height);
      const scale = canvas.width / 2048;
      const x0 = Math.floor(520 * scale);
      const x1 = Math.ceil(828 * scale);
      const y0 = Math.floor(164 * scale);
      const y1 = Math.ceil(496 * scale);
      const sampleLeft = Math.floor(516 * scale);
      const sampleRight = Math.ceil(829 * scale);
      const patch = context.getImageData(x0, y0, x1 - x0, y1 - y0);
      for (let y = 0; y < patch.height; y++) {
        const left = ((y0 + y) * canvas.width + sampleLeft) * 4;
        const right = ((y0 + y) * canvas.width + sampleRight) * 4;
        for (let x = 0; x < patch.width; x++) {
          const weight = (x0 + x - sampleLeft) / (sampleRight - sampleLeft);
          for (let channel = 0; channel < 4; channel++) {
            patch.data[(y * patch.width + x) * 4 + channel] = Math.round(
              before.data[left + channel] * (1 - weight) + before.data[right + channel] * weight,
            );
          }
        }
      }
      context.putImageData(patch, x0, y0);
      const emblem = new Image();
      emblem.src = `data:image/svg+xml;base64,${btoa(markSource)}`;
      await emblem.decode();
      context.drawImage(emblem, 500 * scale, 158 * scale, 344 * scale, 344 * scale);
      const after = context.getImageData(0, 0, canvas.width, canvas.height);
      let changedOutside = 0;
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          if (x >= x0 && x < x1 && y >= y0 && y < y1) continue;
          const offset = (y * canvas.width + x) * 4;
          for (let channel = 0; channel < 4; channel++) {
            if (before.data[offset + channel] !== after.data[offset + channel]) changedOutside++;
          }
        }
      }
      return {
        width: canvas.width,
        height: canvas.height,
        changedOutside,
        png: canvas.toDataURL("image/png").split(",")[1],
      };
    },
    { imageBytes: original.toString("base64"), markSource: mark },
  );
  assert.equal(result.width, 2172);
  assert.equal(result.height, 724);
  assert.equal(
    result.changedOutside,
    0,
    "Logo replacement changed the campaign layout outside its footprint",
  );
  await writeFile(header, Buffer.from(result.png, "base64"));
  console.log(
    `Updated ${fileURLToPath(header)}; 2172x724, no pixels changed outside emblem footprint.`,
  );
} finally {
  await browser.close();
}
