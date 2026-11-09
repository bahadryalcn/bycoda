import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
import { WINDOWS_ICON_SIZES, encodeIcon, renderBrandIcon } from "./brand-icon.mjs";

// Refresh packaging inputs only; this does not build, install or release an app.
const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);
const tauri = path.join(path.dirname(require.resolve("@tauri-apps/cli")), "tauri.js");
const source = path.join(root, "public/brand/bycoda/app-icon.png");
const destination = path.join(root, "src-tauri/icons");
const execute = promisify(execFile);
const windowsOnly = process.argv.includes("--windows-only");
if (!windowsOnly) {
  const result = await execute(
    process.execPath,
    [tauri, "icon", source, "--output", destination, "--ios-color", "#000000"],
    { cwd: root, timeout: 60_000, windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
}

// NSIS requires a 24-bit BMP. Keep its existing 164x314 layout and typography.
const width = 164;
const height = 314;
const mark = await readFile(path.join(root, "public/brand/bycoda/mark-white.svg"), "utf8");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width, height } });
  const geometry = JSON.parse(
    await readFile(path.join(root, "src/shared/lib/brandGeometry.json"), "utf8"),
  );
  const windowsDirectory = path.join(destination, "windows");
  await mkdir(windowsDirectory, { recursive: true });
  const rendered = new Map();
  for (const size of new Set([...WINDOWS_ICON_SIZES, 30, 44])) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block}</style>${renderBrandIcon(geometry, size)}`,
    );
    const bytes = await page.screenshot({ omitBackground: true });
    rendered.set(size, bytes);
    await writeFile(path.join(windowsDirectory, `${size}.png`), bytes);
  }
  await writeFile(
    path.join(destination, "icon.ico"),
    encodeIcon(WINDOWS_ICON_SIZES.map((size) => ({ size, bytes: rendered.get(size) }))),
  );
  for (const [name, size] of [
    ["32x32", 32],
    ["64x64", 64],
    ["128x128", 128],
    ["128x128@2x", 256],
    ["Square30x30Logo", 30],
    ["Square44x44Logo", 44],
  ]) {
    await writeFile(path.join(destination, `${name}.png`), rendered.get(size));
  }
  if (!windowsOnly) {
    await page.setViewportSize({ width, height });
    await page.setContent(
      `<html><body style="margin:0;background:#171717"><canvas width="${width}" height="${height}"></canvas></body></html>`,
    );
    const pixels = await page.evaluate(
      async ({ sourceMark, width, height }) => {
        const canvas = document.querySelector("canvas");
        const context = canvas.getContext("2d");
        context.fillStyle = "#171717";
        context.fillRect(0, 0, width, height);
        const image = new Image();
        image.src = `data:image/svg+xml;base64,${btoa(sourceMark)}`;
        await image.decode();
        context.drawImage(image, 27, 67, 110, 110);
        context.fillStyle = "#FFFFFF";
        context.textAlign = "center";
        context.font = "22px Segoe UI, sans-serif";
        context.fillText("bycoda", width / 2, 224);
        return Array.from(context.getImageData(0, 0, width, height).data);
      },
      { sourceMark: mark, width, height },
    );
    const stride = Math.ceil((width * 3) / 4) * 4;
    const bitmap = Buffer.alloc(54 + stride * height);
    bitmap.write("BM");
    bitmap.writeUInt32LE(bitmap.length, 2);
    bitmap.writeUInt32LE(54, 10);
    bitmap.writeUInt32LE(40, 14);
    bitmap.writeInt32LE(width, 18);
    bitmap.writeInt32LE(height, 22);
    bitmap.writeUInt16LE(1, 26);
    bitmap.writeUInt16LE(24, 28);
    bitmap.writeUInt32LE(stride * height, 34);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const input = (y * width + x) * 4;
        const output = 54 + (height - 1 - y) * stride + x * 3;
        bitmap[output] = pixels[input + 2];
        bitmap[output + 1] = pixels[input + 1];
        bitmap[output + 2] = pixels[input];
      }
    }
    await writeFile(path.join(destination, "installer-sidebar.bmp"), bitmap);

    // Expo native inputs have independent ownership in the nested checkout.
    const artwork = mark.slice(mark.indexOf(">") + 1, mark.lastIndexOf("</svg>"));
    await page.setViewportSize({ width: 1024, height: 1024 });
    for (const asset of [
      {
        name: "mobile-icon.png",
        background: '<rect width="1024" height="1024" fill="#000000"/>',
        offset: 112,
        scale: 10,
      },
      { name: "mobile-adaptive-foreground.png", background: "", offset: 224, scale: 7.2 },
    ]) {
      const output = path.join(root, "public/brand/bycoda", asset.name);
      await page.setContent(
        `<html><body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${asset.background}<g transform="translate(${asset.offset} ${asset.offset}) scale(${asset.scale})">${artwork}</g></svg></body></html>`,
      );
      await page.screenshot({ path: output, omitBackground: !asset.background });
      // An absent mobile checkout does not block desktop/platform generation.
      if (process.argv.includes("--sync-mobile")) {
        await copyFile(output, path.join(root, "mobile/assets/brand", asset.name));
      }
    }
  }
} finally {
  await browser.close();
}
console.log(
  windowsOnly
    ? "Windows native-size icons generated."
    : "Native bycoda icons, NSIS sidebar and Expo inputs generated.",
);
