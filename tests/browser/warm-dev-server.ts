import { chromium, type FullConfig } from "@playwright/test";

/**
 * A cold fixture server transforms the shared styles and modules on first
 * navigation, which can outlast the first test's timeout. Load one fixture
 * before the suite so every test starts against a warm server.
 */
export default async function warmDevServer(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(new URL("/tests/browser/crew-scene.html", baseURL).href, { timeout: 300_000 });
  } finally {
    await browser.close();
  }
}
