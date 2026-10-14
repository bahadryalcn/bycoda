// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BrowserPanel } from "./BrowserPanel";
import { hostFeatureRequest, hostToolRequest } from "../connections/model/hostFeatureClient";

vi.mock("../connections/model/hostFeatureClient", () => ({
  hostFeatureRequest: vi.fn(),
  hostToolRequest: vi.fn(),
}));
let root: Root;
let container: HTMLDivElement;
const button = (text: string) =>
  [...container.querySelectorAll("button")].find((node) => node.textContent === text)!;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  vi.mocked(hostFeatureRequest).mockReset();
  vi.mocked(hostToolRequest).mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("opens an explicitly selected preview URL on the owning host after obtaining a lease", async () => {
  vi.mocked(hostFeatureRequest).mockImplementation(async (_cwd, _capability, method) => ({
    open: method === "browser.open" || method === "browser.frame",
    url: method === "browser.open" || method === "browser.frame" ? "http://127.0.0.1:4100/" : null,
    controlling: method !== "browser.status",
    leaseId: method !== "browser.status" ? "preview-lease" : undefined,
    leaseExpiresAt: Date.now() + 30_000,
  }));
  await act(async () =>
    root.render(
      createElement(BrowserPanel, {
        cwd: "remote://machine/repo",
        initialUrl: "http://127.0.0.1:4100/",
      }),
    ),
  );
  expect(vi.mocked(hostFeatureRequest).mock.calls.map((call) => call[2])).toEqual([
    "browser.status",
    "browser.claim",
    "browser.open",
    "browser.frame",
  ]);
  expect(hostFeatureRequest).toHaveBeenCalledWith(
    "remote://machine/repo",
    "browser.shared",
    "browser.open",
    {
      url: "http://127.0.0.1:4100/",
      leaseId: "preview-lease",
    },
  );
});

it("rejects unsafe preview URLs before taking control or navigating", async () => {
  vi.mocked(hostFeatureRequest).mockResolvedValue({ open: false, url: null, controlling: false });
  await act(async () =>
    root.render(createElement(BrowserPanel, { cwd: "/repo", initialUrl: "file:///private" })),
  );
  expect(vi.mocked(hostFeatureRequest).mock.calls.map((call) => call[2])).toEqual([
    "browser.status",
  ]);
  expect(container.querySelector('[role="alert"]')!.textContent).toContain(
    "Use an HTTP or HTTPS address.",
  );
});

it("opens a website in one explicit action and forwards the newly acquired lease", async () => {
  let controlling = false;
  vi.mocked(hostFeatureRequest).mockImplementation(async (_cwd, _capability, method) => {
    if (method === "browser.claim") controlling = true;
    return {
      open: method === "browser.open" || method === "browser.frame",
      url: controlling ? "http://localhost:3000" : null,
      controlling,
      leaseId: controlling ? "new-lease" : undefined,
      leaseExpiresAt: controlling ? Date.now() + 30_000 : undefined,
      runtime: { installed: true, installing: false, version: "pinned" },
    };
  });
  await act(async () => root.render(createElement(BrowserPanel, { cwd: "/project" })));
  expect(hostFeatureRequest).toHaveBeenCalledOnce();
  await act(async () => button("Open website").click());
  expect(vi.mocked(hostFeatureRequest).mock.calls.map((call) => call[2])).toEqual([
    "browser.status",
    "browser.claim",
    "browser.open",
    "browser.frame",
  ]);
  expect(hostFeatureRequest).toHaveBeenCalledWith("/project", "browser.shared", "browser.open", {
    url: "http://localhost:3000",
    leaseId: "new-lease",
    sessionId: undefined,
  });
});

it("keeps another device's control and does not navigate after a failed claim", async () => {
  vi.mocked(hostFeatureRequest).mockImplementation(async (_cwd, _capability, method) => {
    if (method === "browser.claim") throw new Error("Another device controls this browser");
    return { open: false, url: null, controlling: false };
  });
  await act(async () => root.render(createElement(BrowserPanel, { cwd: "/project" })));
  await act(async () => button("Open website").click());
  expect(container.querySelector('[role="alert"]')!.textContent).toContain("Another device");
  expect(vi.mocked(hostFeatureRequest).mock.calls.map((call) => call[2])).toEqual([
    "browser.status",
    "browser.claim",
  ]);
});

it("shows missing runtime setup before opening and never downloads or claims on entry", async () => {
  vi.mocked(hostFeatureRequest).mockResolvedValue({
    open: false,
    url: null,
    controlling: false,
    runtime: { installed: false, installing: false, version: "pinned" },
  });
  await act(async () => root.render(createElement(BrowserPanel, { cwd: "/project" })));
  expect(button("Open website").disabled).toBe(true);
  expect(button("Set up host browser").closest("details")).toBeNull();
  expect(vi.mocked(hostFeatureRequest).mock.calls.map((call) => call[2])).toEqual([
    "browser.status",
  ]);
});

it("expires control at the host lease deadline while leaving viewing available", async () => {
  vi.mocked(hostFeatureRequest).mockResolvedValue({
    open: true,
    url: "http://localhost:3000",
    controlling: true,
    leaseId: "lease",
    leaseExpiresAt: Date.now() + 30_000,
  });
  await act(async () => root.render(createElement(BrowserPanel, { cwd: "/project" })));
  await act(async () => button("Renew control").click());
  expect(button("Open website").disabled).toBe(false);
  act(() => vi.advanceTimersByTime(30_000));
  expect(button("Open website").disabled).toBe(false);
  expect(button("Type text").disabled).toBe(true);
  expect(button("Refresh frame").disabled).toBe(false);
  expect(button("Claim control").disabled).toBe(false);
});

it("loads an existing shared view on entry without taking control", async () => {
  vi.mocked(hostFeatureRequest).mockImplementation(async (_cwd, _capability, method) => ({
    open: true,
    url: "https://example.test",
    controlling: false,
    ...(method === "browser.frame"
      ? { data: "image", mimeType: "image/jpeg", width: 640, height: 360 }
      : {}),
  }));
  await act(async () => root.render(createElement(BrowserPanel, { cwd: "/project" })));
  expect(vi.mocked(hostFeatureRequest).mock.calls.map((call) => call[2])).toEqual([
    "browser.status",
    "browser.frame",
  ]);
  expect(container.querySelector("img")).not.toBeNull();
  expect(button("Type text").disabled).toBe(true);
  expect(button("Refresh frame").disabled).toBe(false);
  expect(container.querySelector("input")!.value).toBe("https://example.test");
});

it("uses the current lease and host frame dimensions for input", async () => {
  let controlling = false;
  vi.mocked(hostFeatureRequest).mockImplementation(async (_cwd, _capability, method) => {
    if (method === "browser.claim") controlling = true;
    return {
      open: true,
      url: "https://example.test",
      controlling,
      ...(controlling ? { leaseId: "current-lease", leaseExpiresAt: Date.now() + 30_000 } : {}),
      ...(method === "browser.frame"
        ? { data: "image", mimeType: "image/jpeg", width: 640, height: 360 }
        : {}),
    };
  });
  await act(async () => root.render(createElement(BrowserPanel, { cwd: "/project" })));
  await act(async () => button("Claim control").click());
  const img = container.querySelector("img")!;
  vi.spyOn(img, "getBoundingClientRect").mockReturnValue({
    left: 10,
    top: 20,
    width: 320,
    height: 180,
  } as DOMRect);
  await act(async () =>
    img.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 170, clientY: 110 })),
  );
  expect(hostFeatureRequest).toHaveBeenCalledWith("/project", "browser.shared", "browser.input", {
    kind: "click",
    x: 320,
    y: 180,
    leaseId: "current-lease",
  });
});

it("does not enable input on a closed browser just because control was claimed", async () => {
  vi.mocked(hostFeatureRequest).mockResolvedValue({
    open: false,
    url: null,
    controlling: true,
    leaseId: "lease",
    leaseExpiresAt: Date.now() + 30_000,
  });
  await act(async () => root.render(createElement(BrowserPanel, { cwd: "/project" })));
  expect(button("Open website").disabled).toBe(false);
  expect(button("Refresh frame").disabled).toBe(true);
  expect(button("Type text").disabled).toBe(true);
  expect(button("Enter").disabled).toBe(true);
});

it("does not fetch a frame when an old host's status arrives after switching projects", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(hostFeatureRequest).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => root.render(createElement(BrowserPanel, { cwd: "/old" })));
  vi.mocked(hostFeatureRequest).mockResolvedValue({ open: false, url: null, controlling: false });
  await act(async () => root.render(createElement(BrowserPanel, { cwd: "/new" })));
  await act(async () => finish({ open: true, url: "https://old.test", controlling: true }));
  expect(container.textContent).not.toContain("https://old.test");
  expect(
    vi.mocked(hostFeatureRequest).mock.calls.filter((call) => call[2] === "browser.frame"),
  ).toHaveLength(0);
});

it("blocks duplicate requests before React paints the busy state", async () => {
  vi.mocked(hostFeatureRequest).mockResolvedValue({ open: false, url: null, controlling: false });
  await act(async () => root.render(createElement(BrowserPanel, { cwd: "/project" })));
  let finish!: (value: unknown) => void;
  vi.mocked(hostFeatureRequest).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => {
    button("Status").click();
    button("Status").click();
  });
  expect(hostFeatureRequest).toHaveBeenCalledTimes(2);
  await act(async () => finish({ open: false, url: null, controlling: false }));
});
it("shows an unavailable state and recovers through retry when the initial host read fails", async () => {
  vi.mocked(hostFeatureRequest)
    .mockRejectedValueOnce(new Error("Host offline"))
    .mockResolvedValueOnce({ open: false, url: null, controlling: false });
  await act(async () => root.render(createElement(BrowserPanel, { cwd: "/project" })));
  expect(container.textContent).toContain("Browser unavailable");
  expect(container.textContent).not.toContain("Checking browser…");
  await act(async () => button("Retry").click());
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain("Browser closed");
});

it("sets up the browser only on an explicit request on the owning host", async () => {
  let installed = false;
  vi.mocked(hostFeatureRequest).mockImplementation(async (_cwd, _capability, method) => {
    if (method === "browser.setup") installed = true;
    return {
      open: false,
      url: null,
      controlling: false,
      runtime: { installed, installing: false, version: "pinned" },
    };
  });
  await act(async () => root.render(createElement(BrowserPanel, { cwd: "remote://mac/repo" })));
  expect(hostFeatureRequest).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("Browser setup required");
  await act(async () => button("Set up host browser").click());
  expect(hostFeatureRequest).toHaveBeenCalledWith(
    "remote://mac/repo",
    "browser.shared.setup",
    "browser.setup",
    { leaseId: undefined },
  );
  expect(container.textContent).toContain("Browser runtime ready");
  expect(button("Set up host browser").disabled).toBe(true);
});

it("refreshes live view only when enabled and pauses while hidden or unmounted", async () => {
  vi.mocked(hostFeatureRequest).mockResolvedValue({
    open: true,
    url: "https://example.test",
    controlling: false,
  });
  await act(async () => root.render(createElement(BrowserPanel, { cwd: "remote://mac/repo" })));
  await act(async () => vi.advanceTimersByTime(3000));
  expect(hostFeatureRequest).toHaveBeenCalledTimes(2);
  const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => checkbox.click());
  expect(hostFeatureRequest).toHaveBeenCalledTimes(3);
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await act(async () => vi.advanceTimersByTime(3000));
  expect(hostFeatureRequest).toHaveBeenCalledTimes(3);
  hidden.mockReturnValue(false);
  await act(async () => vi.advanceTimersByTime(1000));
  expect(hostFeatureRequest).toHaveBeenCalledTimes(4);
  await act(async () => root.render(null));
  await act(async () => vi.advanceTimersByTime(3000));
  expect(hostFeatureRequest).toHaveBeenCalledTimes(4);
  hidden.mockRestore();
});

it("uses the explicitly selected local browser and blocks conversation annotations on a different host", async () => {
  vi.mocked(hostToolRequest).mockResolvedValue({
    open: true,
    url: "http://localhost:5173",
    controlling: true,
    leaseId: "selected-lease",
    leaseExpiresAt: Date.now() + 30_000,
    data: "local-frame",
    mimeType: "image/jpeg",
    navigationId: "local-nav",
    runtime: { installed: false, installing: false, version: "pinned" },
  });
  await act(async () =>
    root.render(
      createElement(BrowserPanel, {
        cwd: "remote://macbook/repo",
        sessionId: "mac-session",
        composerSessionId: "shell-session",
        hostTarget: { kind: "local" },
        hostLabel: "This computer",
      }),
    ),
  );
  expect(container.textContent).toContain("Shared host browser · This computer");
  expect(button("Select element and add to composer").disabled).toBe(true);
  await act(async () => button("Select element and add to composer").click());
  await act(async () => button("Set up host browser").click());
  expect(hostToolRequest).toHaveBeenCalledWith(
    "remote://macbook/repo",
    "browser.shared.setup",
    "browser.setup",
    { leaseId: "selected-lease" },
    { kind: "local" },
  );
  expect(hostFeatureRequest).not.toHaveBeenCalled();
  expect(
    vi.mocked(hostToolRequest).mock.calls.every((call) => !("sessionId" in (call[3] ?? {}))),
  ).toBe(true);
});

it("keeps same-owner browser annotation calls on the original conversation project", async () => {
  const state = {
    open: true,
    url: "http://localhost:3000",
    controlling: true,
    leaseId: "lease",
    leaseExpiresAt: Date.now() + 30_000,
    navigationId: "owner-nav",
  };
  vi.mocked(hostToolRequest).mockResolvedValue({
    ...state,
    data: "owner-frame",
    mimeType: "image/jpeg",
  });
  vi.mocked(hostFeatureRequest).mockResolvedValue({ ...state, annotationId: "selection" });
  await act(async () =>
    root.render(
      createElement(BrowserPanel, {
        cwd: "remote://macbook/repo",
        sessionId: "owner-session",
        hostTarget: { kind: "machine", machineId: "mac" },
        annotationsAllowed: true,
      }),
    ),
  );
  await act(async () => button("Select element and add to composer").click());
  expect(hostFeatureRequest).toHaveBeenCalledWith(
    "remote://macbook/repo",
    "browser.annotation",
    "browser.annotation.start",
    {
      sessionId: "owner-session",
      annotationId: undefined,
      navigationId: "owner-nav",
      leaseId: "lease",
    },
  );
});

it("clears live frames and control on a target switch and ignores a late old-host frame", async () => {
  let finish!: (value: unknown) => void;
  let frames = 0;
  vi.mocked(hostToolRequest).mockImplementation(
    async (_cwd, _capability, method, _params, target) => {
      if (target?.kind === "local") return { open: false, url: null, controlling: false };
      if (method === "browser.frame" && ++frames > 1)
        return new Promise((resolve) => {
          finish = resolve;
        });
      return {
        open: true,
        url: "https://old.test",
        controlling: true,
        leaseId: "old-lease",
        leaseExpiresAt: Date.now() + 30_000,
        data: "old-frame",
        mimeType: "image/jpeg",
      };
    },
  );
  await act(async () =>
    root.render(
      createElement(BrowserPanel, {
        cwd: "/repo",
        hostTarget: { kind: "machine", machineId: "old" },
      }),
    ),
  );
  await act(async () =>
    container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
  );
  await act(async () =>
    root.render(createElement(BrowserPanel, { cwd: "/repo", hostTarget: { kind: "local" } })),
  );
  await act(async () =>
    finish({
      open: true,
      url: "https://old.test",
      controlling: true,
      data: "late-frame",
      mimeType: "image/jpeg",
    }),
  );
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
  expect(container.textContent).not.toContain("https://old.test");
  expect(button("Open website").disabled).toBe(false);
  expect(button("Type text").disabled).toBe(true);
  expect(button("Refresh frame").disabled).toBe(true);
  await act(async () => vi.advanceTimersByTime(3000));
  expect(frames).toBe(2);
  expect(hostFeatureRequest).not.toHaveBeenCalled();
});
