import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { BrowserProfiles } from "./browser-profiles";
import { SessionBrowserRegistry, type BrowserLoader } from "./shared-browser";

const storage = {
  cookies: [],
  origins: [
    {
      origin: "https://example.com",
      localStorage: [{ name: "test", value: "fixture-only" }],
    },
  ],
};

it("imports a profile, gates named browser access and isolates it from other sessions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-browser-profiles-"));
  const profiles = new BrowserProfiles(directory);
  const goto = vi.fn();
  const newContext = vi.fn(async () => ({
    newPage: async () => ({
      goto,
      url: () => "https://example.com/",
      screenshot: async () => Buffer.from("frame"),
      setViewportSize: async () => {},
      mouse: { click: vi.fn(), wheel: vi.fn() },
      keyboard: { type: vi.fn(), press: vi.fn() },
    }),
  }));
  const loader: BrowserLoader = async () => ({
    chromium: { launch: async () => ({ newContext, close: vi.fn() }) },
  });
  const browser = new SessionBrowserRegistry(loader, Date.now, { profiles });
  try {
    const [{ id }] = (
      await profiles.update("import", {
        name: "Work",
        json: JSON.stringify(storage),
      })
    ).profiles;
    await expect(
      profiles.update("import", { name: "work", json: JSON.stringify(storage) }),
    ).rejects.toThrow("unique");
    expect((await new BrowserProfiles(directory).list()).profiles).toEqual([
      { id, name: "Work", agents: false },
    ]);
    await profiles.update("default", id);
    const scope = { projectId: "project", sessionId: "agent-session" };
    const claim = await browser.dispatchForSession("browser.claim", scope, "agent");
    const params = { ...scope, leaseId: claim.leaseId };
    await expect(
      browser.dispatchForSession(
        "browser.open",
        {
          ...params,
          url: "https://example.com/",
          profile: "Work",
        },
        "agent",
      ),
    ).rejects.toThrow("not been granted");
    expect(newContext).not.toHaveBeenCalled();
    await browser.dispatchForSession(
      "browser.open",
      { ...params, url: "https://example.com/" },
      "agent",
    );
    expect(newContext).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ storageState: expect.anything() }),
    );
    await profiles.update("grant", { id, agents: true });
    const status = await browser.dispatchForSession("browser.status", scope, "agent");
    expect(status).toMatchObject({ profiles: [{ id, name: "Work", agents: true }] });
    expect(JSON.stringify(status)).not.toContain("fixture-only");
    await browser.dispatchForSession(
      "browser.open",
      {
        ...params,
        url: "https://example.com/",
        profile: "work",
      },
      "agent",
    );
    expect(newContext).toHaveBeenLastCalledWith(expect.objectContaining({ storageState: storage }));
    await browser.dispatchForSession(
      "browser.resize",
      {
        ...params,
        width: 3840,
        height: 2160,
      },
      "agent",
    );
    expect(await browser.dispatchForSession("browser.frame", scope, "agent")).toMatchObject({
      width: 3840,
      height: 2160,
    });
    await profiles.update("grant", { id, agents: false });
    expect(await browser.dispatchForSession("browser.status", scope, "agent")).toMatchObject({
      open: false,
      url: null,
      profiles: [],
    });
    await expect(browser.dispatchForSession("browser.frame", scope, "agent")).rejects.toThrow(
      "not been granted",
    );
    await browser.dispatchForSession(
      "browser.open",
      {
        ...params,
        url: "https://example.com/",
        profile: "isolated",
      },
      "agent",
    );
    expect(newContext).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ storageState: expect.anything() }),
    );
    const contextsBeforeLoopback = newContext.mock.calls.length;
    await browser.dispatchForSession(
      "browser.open",
      { ...params, url: "http://localhost:3000/" },
      "agent",
    );
    expect(newContext).toHaveBeenCalledTimes(contextsBeforeLoopback + 1);
    expect(newContext).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ storageState: expect.anything() }),
    );
    await profiles.update("grant", { id, agents: true });
    await profiles.update("development", id);
    await browser.dispatchForSession(
      "browser.open",
      { ...params, url: "http://localhost:3000/settings" },
      "agent",
    );
    expect(newContext).toHaveBeenLastCalledWith(expect.objectContaining({ storageState: storage }));
    await profiles.update("agentAccess", false);
    await expect(browser.dispatchForSession("browser.status", scope, "agent")).rejects.toThrow(
      "turned off",
    );
    const owner = await browser.dispatch("browser.claim", {}, "owner");
    await browser.dispatch(
      "browser.open",
      { leaseId: owner.leaseId, url: "https://example.com/" },
      "owner",
    );
    expect(newContext).toHaveBeenLastCalledWith(expect.objectContaining({ storageState: storage }));
    expect((await profiles.update("remove", id)).defaultProfileId).toBeNull();
  } finally {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it("selects independent default and development profiles while enforcing agent grants", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-browser-routes-"));
  const profiles = new BrowserProfiles(directory);
  try {
    const [{ id }] = (
      await profiles.update("import", {
        name: "Work",
        json: JSON.stringify(storage),
      })
    ).profiles;
    await profiles.update("default", id);
    expect(
      await profiles.resolve(undefined, true, undefined, "https://example.com/"),
    ).toMatchObject({ id });
    expect(
      await profiles.resolve(undefined, true, undefined, "http://localhost:3000/"),
    ).toBeUndefined();
    await profiles.update("development", id);
    expect(
      await profiles.resolve(undefined, true, undefined, "http://127.0.0.1:3000/"),
    ).toMatchObject({ id });
    expect(
      await profiles.resolve(undefined, false, undefined, "http://localhost:3000/"),
    ).toBeUndefined();
    await profiles.update("grant", { id, agents: true });
    expect(
      await profiles.resolve(undefined, false, undefined, "https://example.com/"),
    ).toMatchObject({ id });
    expect(await profiles.resolve(undefined, false, undefined, "http://[::1]:3000/")).toMatchObject(
      { id },
    );
    expect(
      await profiles.resolve("isolated", false, undefined, "http://localhost:3000/"),
    ).toBeUndefined();
    await profiles.update("default", null);
    expect((await new BrowserProfiles(directory).list()).developmentProfileId).toBe(id);
    expect((await profiles.update("remove", id)).developmentProfileId).toBeNull();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
