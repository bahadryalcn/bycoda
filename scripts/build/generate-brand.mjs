import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { encodeIcon, renderBrandIcon } from "./brand-icon.mjs";

// Original outlined lettering: no system font or external font dependency.
const root = fileURLToPath(new URL("../../public/brand/bycoda/", import.meta.url));
await mkdir(root, { recursive: true });
const ink = "#262930",
  silver = "#DCE2EA";
const fullBlack = "#000000";
// One geometry source for static exports, startup animation and voice feedback.
const geometry = JSON.parse(
  await readFile(new URL("../../src/shared/lib/brandGeometry.json", import.meta.url), "utf8"),
);
// Shell marks keep pixel-sized strokes and separated drops at their 24px use size.
for (const [tone, foreground] of [
  ["black", "#000000"],
  ["white", "#FFFFFF"],
]) {
  await writeFile(
    `${root}/mark-small-${tone}.svg`,
    renderBrandIcon(geometry, 24, { foreground, background: "none" }),
  );
}
if (process.argv.includes("--shell-only")) process.exit(0);
// Targeted small-icon regeneration must not rewrite lockups or launch images.
if (process.argv.includes("--favicons-only")) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const [stem, options] of [
      ["favicon", {}],
      ["favicon-full-dark", { foreground: "#000000", background: "none" }],
    ]) {
      await writeFile(
        `${root}/${stem}.svg`,
        renderBrandIcon(geometry, 32, { ...options, responsive: true }),
      );
      const images = [];
      for (const size of [16, 32, 48]) {
        await page.setViewportSize({ width: size, height: size });
        await page.setContent(
          `<style>html,body{margin:0;background:transparent}svg{display:block}</style>${renderBrandIcon(geometry, size, options)}`,
        );
        const bytes = await page.screenshot({ omitBackground: true });
        await writeFile(`${root}/${stem}-${size}.png`, bytes);
        images.push({ size, bytes });
      }
      await writeFile(`${root}/${stem}.ico`, encodeIcon(images));
    }
  } finally {
    await browser.close();
  }
  console.log("Native-size favicons generated.");
  process.exit(0);
}
const mark = (color, compact = false) =>
  `<g fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round"><path d="${geometry.rim}" stroke-width="${compact ? 2.4 : geometry.rimStroke}"/>${Array.from({ length: 6 }, (_, i) => `<path data-tea-drop="${i}" transform="rotate(${i * 60} 40 40)" stroke-width="${geometry.dropStroke}" d="${geometry.drop}"/>`).join("")}<path fill="${color}" stroke="none" d="${geometry.code}"/></g>`;
const glyphs = {
  b: "M0 6V44 M0 31C0 13 28 13 28 31S0 49 0 31Z",
  y: "M0 18L14 40 M28 18L11 46Q8 51 3 51",
  a: "M28 18V44 M28 31C28 13 0 13 0 31S28 49 28 31Z",
  i: "M4 18v28 M4 5v1",
  m: "M4 46V19h3c7-3 15 0 15 8v19 M22 27c0-11 18-12 18 0v19",
  c: "M27 22C19 14 0 17 0 31S19 48 27 40",
  o: "M14 18C32 18 32 44 14 44S-4 18 14 18Z",
  d: "M28 6V44 M28 31C28 13 0 13 0 31S28 49 28 31Z",
  e: "M1 33h27c0-21-28-21-28 0 0 16 19 18 27 10",
};
function letters(color) {
  // Equal side bearings in the 280-unit wordmark, shared by every lockup.
  // Ascenders: 6; lowercase body: 18–44; compact y descender: 51.
  const advance = 38;
  const inkWidth = 5 * advance + 28;
  let x = (280 - inkWidth) / 2;
  return (
    [..."bycoda"]
      .map((letter) => {
        const path = `<path transform="translate(${x} 0)" d="${glyphs[letter]}"/>`;
        x += advance;
        return path;
      })
      .join("")
      .replace(
        /^/,
        `<g transform="translate(0 -0.5)" fill="none" stroke="${color}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round">`,
      ) + "</g>"
  );
}
function svg(w, h, body, adaptive = false) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="bycoda">${adaptive ? `<style>.ink{color:${ink}}@media(prefers-color-scheme:dark){.ink{color:${silver}}}</style>` : ""}${body}</svg>\n`;
}
const variants = {
  light: ink,
  dark: silver,
  black: fullBlack,
  white: "#FFFFFF",
  "full-dark": fullBlack,
};
const assets = {};
for (const [name, color] of Object.entries(variants)) {
  assets[`mark-${name}`] = svg(80, 80, mark(color));
  assets[`wordmark-${name}`] = svg(280, 56, letters(color));
  assets[`logo-horizontal-${name}`] = svg(
    390,
    80,
    mark(color) + `<g transform="translate(104 12)">${letters(color)}</g>`,
  );
  assets[`logo-stacked-${name}`] = svg(
    280,
    170,
    `<g transform="translate(90 0) scale(1.25)">${mark(color)}</g><g transform="translate(0 114)">${letters(color)}</g>`,
  );
}
assets.mark = svg(80, 80, `<g class="ink">${mark("currentColor")}</g>`, true);
assets.wordmark = svg(280, 56, `<g class="ink">${letters("currentColor")}</g>`, true);
assets["logo-horizontal"] = svg(
  390,
  80,
  `<g class="ink">${mark("currentColor")}<g transform="translate(104 12)">${letters("currentColor")}</g></g>`,
  true,
);
assets["app-icon-full-dark"] = svg(
  1024,
  1024,
  `<g transform="translate(128 128) scale(9.6)">${mark(fullBlack)}</g>`,
);
assets["favicon-full-dark"] = renderBrandIcon(geometry, 32, {
  foreground: "#000000",
  background: "none",
  responsive: true,
});
// Native vector logo animation: only the six saucer droplets change color.
const teaRed = "#D32030";
function animatedMark(color = fullBlack) {
  let index = 0;
  return mark(color).replace(
    /<path data-tea-drop="(\d+)"/g,
    (_, drop) =>
      `<path data-tea-drop="${drop}" class="tea-drop" style="animation-delay:${(0.5 + index++ * 0.12).toFixed(2)}s" stroke="${color}"`,
  );
}
const teaStyle = `<style>.tea-drop{animation:tea-red .85s cubic-bezier(.4,0,.2,1) forwards}@keyframes tea-red{to{stroke:${teaRed}}}@media(prefers-reduced-motion:reduce){.tea-drop{animation:none;stroke:${teaRed}}}</style>`;
assets["mark-tea-red-animated"] = svg(80, 80, teaStyle + animatedMark());
assets["mark-tea-red-animated-dark"] = svg(80, 80, teaStyle + animatedMark(silver));
// White logo with exactly one red drop advancing clockwise every 240ms.
// The previous drop returns to white, and reduced motion retains the white mark.
const loadingWhite = "#FFFFFF";
const teaLoadingStyle = `<style>.tea-drop{stroke:${loadingWhite};animation:tea-loading 1.44s steps(1,end) infinite}@keyframes tea-loading{0%{stroke:${teaRed}}16.6666667%,100%{stroke:${loadingWhite}}}@media(prefers-reduced-motion:reduce){.tea-drop{animation:none;stroke:${loadingWhite}}}</style>`;
let loadingDrop = 0;
assets["mark-tea-red-loading"] = svg(
  80,
  80,
  teaLoadingStyle +
    animatedMark(loadingWhite).replace(
      /animation-delay:[\d.]+s/g,
      () => `animation-delay:${(-1.44 + loadingDrop++ * 0.24).toFixed(2)}s`,
    ),
);
assets["logo-horizontal-tea-red-animated"] = svg(
  390,
  80,
  teaStyle + animatedMark() + `<g transform="translate(104 12)">${letters(fullBlack)}</g>`,
);
const redMark = mark(fullBlack).replace(
  /data-tea-drop="(\d+)"/g,
  `data-tea-drop="$1" stroke="${teaRed}"`,
);
const redMarkDark = mark(silver).replace(
  /data-tea-drop="(\d+)"/g,
  `data-tea-drop="$1" stroke="${teaRed}"`,
);
assets["mark-tea-red"] = svg(80, 80, redMark);
assets["mark-tea-red-dark"] = svg(80, 80, redMarkDark);
assets["logo-horizontal-tea-red"] = svg(
  390,
  80,
  redMark + `<g transform="translate(104 12)">${letters(fullBlack)}</g>`,
);
assets["logo-horizontal-tea-red-dark"] = svg(
  390,
  80,
  redMarkDark + `<g transform="translate(104 12)">${letters(silver)}</g>`,
);
assets["app-icon"] = svg(
  1024,
  1024,
  `<rect x="32" y="32" width="960" height="960" rx="220" fill="${fullBlack}"/><g transform="translate(128 128) scale(9.6)">${mark("#FFFFFF")}</g>`,
);
assets.favicon = renderBrandIcon(geometry, 32, { responsive: true });
// Rename lettering without regenerating the existing marks or platform icons.
const letteringOnly = process.argv.includes("--wordmarks-only");
// Updating the startup loop must not regenerate unrelated marks or native icons.
if (process.argv.includes("--loading-only")) {
  await writeFile(`${root}/mark-tea-red-loading.svg`, assets["mark-tea-red-loading"]);
  process.exit(0);
}
const isLettering = (name) => /^(wordmark|logo-horizontal|logo-stacked)(-|$)/.test(name);
for (const [name, content] of Object.entries(assets)) {
  if (!letteringOnly || isLettering(name)) await writeFile(`${root}/${name}.svg`, content);
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  async function raster(name, width, height, output = name) {
    await page.setViewportSize({ width, height });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:100%;height:100%}</style>${name.startsWith("favicon") ? renderBrandIcon(geometry, width, name.includes("full-dark") ? { foreground: "#000000", background: "none" } : {}) : assets[name]}`,
    );
    await page.screenshot({ path: `${root}/${output}.png`, omitBackground: true });
  }
  if (letteringOnly) {
    for (const name of Object.keys(assets).filter(isLettering)) {
      if (name.includes("animated") || name === "wordmark" || name === "logo-horizontal") continue;
      const [, width, height] = assets[name].match(/width="(\d+)" height="(\d+)"/);
      await raster(name, Number(width) * 4, Number(height) * 4);
    }
  } else {
    for (const name of Object.keys(variants)) {
      await raster(`mark-${name}`, 1024, 1024);
      await raster(`wordmark-${name}`, 1120, 224);
      await raster(`logo-horizontal-${name}`, 1560, 320);
      await raster(`logo-stacked-${name}`, 1120, 680);
    }
    await raster("app-icon", 1024, 1024);
    await raster("app-icon-full-dark", 1024, 1024);
    await raster("mark-tea-red", 1024, 1024);
    await raster("mark-tea-red-dark", 1024, 1024);
    await raster("logo-horizontal-tea-red", 1560, 320);
    await raster("logo-horizontal-tea-red-dark", 1560, 320);
    for (const size of [16, 32, 48])
      await raster("favicon-full-dark", size, size, `favicon-full-dark-${size}`);
    await raster("app-icon-full-dark", 180, 180, "apple-touch-icon-full-dark");
    for (const size of [192, 512])
      await raster("app-icon-full-dark", size, size, `icon-full-dark-${size}`);
    for (const size of [16, 32, 48]) await raster("favicon", size, size, `favicon-${size}`);
    await raster("app-icon", 180, 180, "apple-touch-icon");
    for (const size of [192, 512]) await raster("app-icon", size, size, `icon-${size}`);
    // A maskable icon keeps the entire symbol inside the central 80% safe circle.
    assets.maskable = svg(
      512,
      512,
      `<rect width="512" height="512" fill="${fullBlack}"/><g transform="translate(96 96) scale(4)">${mark("#FFFFFF")}</g>`,
    );
    await writeFile(`${root}/icon-maskable.svg`, assets.maskable);
    await raster("maskable", 512, 512, "icon-maskable");
  }
} finally {
  await browser.close();
}
// ICO container with independent native-resolution PNG entries.
const sizes = [16, 32, 48];
async function writeIco(stem, output) {
  const images = await Promise.all(sizes.map((size) => readFile(`${root}/${stem}-${size}.png`)));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  images.forEach((bytes, index) => {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = sizes[index];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(bytes.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += bytes.length;
  });
  await writeFile(`${root}/${output}.ico`, Buffer.concat([header, ...images]));
}
if (!letteringOnly) {
  await writeIco("favicon", "favicon");
  await writeIco("favicon-full-dark", "favicon-full-dark");
}
await writeFile(
  `${root}/tea-red-animation.html`,
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>bycoda — tea saucer animation</title>
<style>body{margin:0;padding:40px 24px;background:#f5f5f5;color:#000;font:15px system-ui,sans-serif}main{max-width:960px;margin:auto}h1{font-size:20px;font-weight:600}section{display:flex;align-items:center;justify-content:center;background:white;border:1px solid #ddd;border-radius:16px;margin:24px 0;padding:48px 20px;min-height:180px}.symbol{width:160px;height:160px}.lockup{width:min(100%,650px);height:auto}button{background:#000;color:#fff;border:0;border-radius:8px;padding:12px 20px;font:inherit;cursor:pointer}button:focus-visible{outline:3px solid ${teaRed};outline-offset:4px}@media(prefers-reduced-motion:reduce){button{display:none}}</style></head>
<body><main><h1>bycoda / from black to red</h1><section><img class="symbol" src="mark-tea-red-animated.svg" alt="bycoda tea saucer mark"></section><section><img class="lockup" src="logo-horizontal-tea-red-animated.svg" alt="bycoda wordmark logo"></section><button type="button" id="replay">Replay</button></main><script>let replayCount=0;document.getElementById('replay').addEventListener('click',()=>{replayCount++;document.querySelectorAll('img').forEach(img=>{const clone=img.cloneNode(true);clone.src=img.getAttribute('src').split('?')[0]+'?replay='+replayCount;img.replaceWith(clone);});});</script></body></html>\n`,
);
await writeFile(
  `${root}/manifest.webmanifest`,
  JSON.stringify(
    {
      name: "bycoda",
      short_name: "bycoda",
      display: "standalone",
      start_url: "/",
      background_color: ink,
      theme_color: ink,
      icons: [192, 512]
        .map((size) => ({
          src: `icon-${size}.png`,
          sizes: `${size}x${size}`,
          type: "image/png",
          purpose: "any",
        }))
        .concat([
          { src: "icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ]),
    },
    null,
    2,
  ) + "\n",
);
console.log("bycoda SVG and PNG brand assets generated.");
