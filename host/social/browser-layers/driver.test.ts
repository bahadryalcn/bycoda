import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { BrowserLayerDriver, type BrowserLayerDeps, type LayerAudit } from "./driver";
import { domPage, fakeDecisions } from "./test-support";
import { defaultBrowserSettings, type BrowserSettings } from "./browser-settings";
import { UnexpectedScreen, type ScreenSummary } from "./types";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const summary: ScreenSummary = {
  url: "https://x.example/home",
  title: "",
  buttons: [],
  fields: [],
  headings: [],
  errors: [],
};
const unexpected = () => new UnexpectedScreen(summary);

const BANNER = `<div role="dialog"><h2>Cookies</h2>
  <button type="button">Reject all</button><button type="button">Accept all</button></div>`;
const DESTRUCTIVE = `<div role="dialog"><h2>Confirm</h2><button type="button">Delete account</button></div>`;
const CAPTCHA = `<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>`;

async function harness(options: {
  html: string;
  url?: string;
  settings?: BrowserSettings;
  decisions?: ReturnType<typeof fakeDecisions>;
  desktop?: BrowserLayerDeps["desktop"];
  presence?: BrowserLayerDeps["presence"];
  allowLayer?: BrowserLayerDeps["allowLayer"];
}) {
  const dom = domPage(options.url ?? "https://x.example/home", options.html);
  const audits: LayerAudit[] = [];
  const healing = { suggest: vi.fn(async () => undefined) };
  const needsHuman = { open: vi.fn(async () => undefined) };
  const directory = await mkdtemp(join(tmpdir(), "layers-"));
  directories.push(directory);
  const deps: BrowserLayerDeps = {
    platformOf: async () => "x",
    page: async () => dom.page,
    settings: async (accountId) => options.settings ?? defaultBrowserSettings(accountId),
    presence: options.presence ?? (async () => undefined),
    ownerActiveComputerId: async () => undefined,
    allowLayer: options.allowLayer ?? (async () => undefined),
    ...(options.decisions ? { decisions: options.decisions } : {}),
    ...(options.desktop ? { desktop: options.desktop } : {}),
    healing,
    needsHuman,
    directory,
    audit: (entry) => {
      audits.push(entry);
    },
  };
  return { driver: new BrowserLayerDriver(deps), dom, audits, healing, needsHuman };
}

const desktopSettings = (): BrowserSettings => ({
  accountId: "acc",
  visibility: "hidden",
  desktopControl: { allowed: true, computerId: "pc-1" },
});

describe("BrowserLayerDriver", () => {
  it("returns the recipe value and audits one done layer when the recipe succeeds", async () => {
    const { driver, audits } = await harness({ html: BANNER });
    await expect(driver.run("acc", { name: "send", recipe: async () => "ok" })).resolves.toBe("ok");
    expect(audits).toEqual([
      expect.objectContaining({ layer: "recipe", status: "done", step: "send", accountId: "acc" }),
    ]);
  });

  it("stops a captcha page at NEEDS_HUMAN without any click, fill, typing or decision call", async () => {
    const decisions = fakeDecisions({ screen: { value: "cookie_banner", confidence: 0.99 } });
    const { driver, dom, needsHuman } = await harness({ html: CAPTCHA, decisions });
    const recipe = vi.fn(async () => {
      throw unexpected();
    });
    const failure = await driver
      .run("acc", { name: "send", recipe, jobId: "job-1" })
      .catch((error) => error);
    expect(failure).toBeInstanceOf(SocialPlatformError);
    expect(failure.code).toBe("needs_human");
    expect(needsHuman.open).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "captcha", jobId: "job-1" }),
    );
    expect(decisions.calls).toHaveLength(0);
    for (const spy of [dom.interactions.click, dom.interactions.fill, dom.interactions.insertText])
      expect(spy).not.toHaveBeenCalled();
    expect(recipe).toHaveBeenCalledTimes(1);
  });

  it("clicks one safe candidate on a cookie banner at or above the threshold, then retries the recipe once", async () => {
    const decisions = fakeDecisions({
      screen: { value: "cookie_banner", confidence: 0.9 },
      element: { value: "c2", confidence: 0.9 },
    });
    const { driver, dom, healing, audits } = await harness({ html: BANNER, decisions });
    const recipe = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(unexpected())
      .mockResolvedValueOnce("sent");
    await expect(driver.run("acc", { name: "send", recipe })).resolves.toBe("sent");
    expect(dom.interactions.click).toHaveBeenCalledTimes(1);
    const selector = dom.interactions.click.mock.calls[0]![0] as string;
    expect(dom.window.document.querySelectorAll(selector)).toHaveLength(1);
    expect(dom.window.document.querySelector(selector)?.textContent).toBe("Accept all");
    expect(healing.suggest).toHaveBeenCalledWith(
      expect.objectContaining({ source: "decision", step: "send" }),
    );
    expect(audits.map((entry) => `${entry.layer}:${entry.status}`)).toEqual([
      "recipe:unexpected_screen",
      "decision:done",
    ]);
  });

  it("does not click when the screen confidence is below the threshold and falls through to NEEDS_HUMAN", async () => {
    const decisions = fakeDecisions({
      screen: { value: "cookie_banner", confidence: 0.5 },
      element: { value: "c2", confidence: 0.99 },
    });
    const { driver, dom, needsHuman, audits } = await harness({ html: BANNER, decisions });
    await expect(
      driver.run("acc", {
        name: "send",
        recipe: async () => {
          throw unexpected();
        },
      }),
    ).rejects.toBeInstanceOf(SocialPlatformError);
    expect(dom.interactions.click).not.toHaveBeenCalled();
    expect(needsHuman.open).toHaveBeenCalledTimes(1);
    expect(audits.find((entry) => entry.layer === "decision")).toEqual(
      expect.objectContaining({ status: "failed", detail: "below_threshold" }),
    );
  });

  it("never clicks a destructive label even when the model picks it", async () => {
    const decisions = fakeDecisions({
      screen: { value: "confirm_dialog", confidence: 0.95 },
      element: { value: "c1", confidence: 0.95 },
    });
    const { driver, dom } = await harness({ html: DESTRUCTIVE, decisions });
    await expect(
      driver.run("acc", {
        name: "send",
        recipe: async () => {
          throw unexpected();
        },
      }),
    ).rejects.toBeInstanceOf(SocialPlatformError);
    expect(dom.interactions.click).not.toHaveBeenCalled();
    expect(decisions.calls.every((call) => call.taskType !== "element_choice")).toBe(true);
  });

  it("uses the desktop layer only for a single job with an away owner, and records a suggestion when it selects a path", async () => {
    const desktop = {
      run: vi.fn(async () => ({
        done: true,
        selector: "html > body:nth-child(2) > button:nth-child(1)",
      })),
    };
    const recipe = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(unexpected())
      .mockResolvedValueOnce("done");
    const { driver, healing, audits } = await harness({
      html: "<main>Plain page</main>",
      settings: desktopSettings(),
      desktop,
      presence: async () => ({ supported: true, locked: false, idleMs: 11 * 60_000 }),
    });
    await expect(driver.run("acc", { name: "send", recipe, outreach: false })).resolves.toBe(
      "done",
    );
    expect(desktop.run).toHaveBeenCalledWith(
      expect.objectContaining({ computerId: "pc-1", step: "send" }),
    );
    expect(healing.suggest).toHaveBeenCalledWith(expect.objectContaining({ source: "desktop" }));
    expect(audits.find((entry) => entry.layer === "desktop")).toEqual(
      expect.objectContaining({ status: "done" }),
    );
  });

  it("skips the desktop layer for outreach, unknown outreach, or an active owner", async () => {
    const desktop = { run: vi.fn(async () => ({ done: true })) };
    const base = { settings: desktopSettings(), desktop };
    const outreach = await harness({
      ...base,
      html: "<main/>",
      presence: async () => ({ supported: true, locked: false, idleMs: 11 * 60_000 }),
    });
    await expect(
      outreach.driver.run("acc", {
        name: "send",
        outreach: true,
        recipe: async () => {
          throw unexpected();
        },
      }),
    ).rejects.toBeInstanceOf(SocialPlatformError);
    const unknown = await harness({
      ...base,
      html: "<main/>",
      presence: async () => ({ supported: true, locked: false, idleMs: 11 * 60_000 }),
    });
    await expect(
      unknown.driver.run("acc", {
        name: "send",
        recipe: async () => {
          throw unexpected();
        },
      }),
    ).rejects.toBeInstanceOf(SocialPlatformError);
    const active = await harness({
      ...base,
      html: "<main/>",
      presence: async () => ({ supported: true, locked: false, idleMs: 1000 }),
    });
    await expect(
      active.driver.run("acc", {
        name: "send",
        outreach: false,
        recipe: async () => {
          throw unexpected();
        },
      }),
    ).rejects.toBeInstanceOf(SocialPlatformError);
    expect(desktop.run).not.toHaveBeenCalled();
  });

  it("propagates a layer limit refusal before any decision action", async () => {
    const decisions = fakeDecisions({
      screen: { value: "cookie_banner", confidence: 0.95 },
      element: { value: "c2", confidence: 0.95 },
    });
    const { driver, dom } = await harness({
      html: BANNER,
      decisions,
      allowLayer: async (_accountId, layer) => {
        if (layer === "decision") throw new SocialPlatformError("rate_limit", Date.now() + 1000);
      },
    });
    const failure = await driver
      .run("acc", {
        name: "send",
        recipe: async () => {
          throw unexpected();
        },
      })
      .catch((error) => error);
    expect(failure.code).toBe("rate_limit");
    expect(dom.interactions.click).not.toHaveBeenCalled();
  });

  it("audits only fixed detail codes, never URLs or page text", async () => {
    const decisions = fakeDecisions({ screen: { value: "cookie_banner", confidence: 0.2 } });
    const { driver, audits } = await harness({
      html: BANNER,
      decisions,
      url: "https://x.example/home?token=secret",
    });
    await driver
      .run("acc", {
        name: "send",
        recipe: async () => {
          throw unexpected();
        },
      })
      .catch(() => undefined);
    const serialized = JSON.stringify(audits);
    expect(serialized).not.toContain("token=secret");
    expect(serialized).not.toContain("Reject all");
    for (const entry of audits) expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  });
});
