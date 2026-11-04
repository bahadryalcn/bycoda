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
  [...document.body.querySelectorAll("button")].find(
    (node) => node.textContent === text || node.getAttribute("aria-label") === text,
  )!;
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

it("retains the last frame while an input's replacement frame is delayed", async () => {
  let resolveFrame!: (value: unknown) => void;
  let frames = 0;
  const state = {
    open: true,
    url: "https://example.test",
    controlling: true,
    leaseId: "lease",
    documentId: "doc",
    navigationId: "nav",
    viewport: { width: 800, height: 600 },
  };
  vi.mocked(hostFeatureRequest).mockImplementation(async (_cwd, _capability, method) => {
    if (method === "browser.frame") {
      frames++;
      if (frames === 2)
        return await new Promise((resolve) => {
          resolveFrame = resolve;
        });
      return { ...state, data: "YWJj", mimeType: "image/jpeg", width: 800, height: 600 };
    }
    return state;
  });
  await act(async () =>
    root.render(createElement(BrowserPanel, { cwd: "/project", sessionId: "session" })),
  );
  const image = container.querySelector("img")!;
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 800,
    height: 600,
  } as DOMRect);
  await act(async () => image.click());
  expect(container.querySelector("img")).toBe(image);
  expect(container.textContent).not.toContain("Refresh the frame to view this page.");
  await act(async () => vi.advanceTimersByTimeAsync(150));
  await act(async () =>
    resolveFrame({ ...state, data: "ZGVm", mimeType: "image/jpeg", width: 800, height: 600 }),
  );
  expect(container.querySelector("img")?.src).toContain("ZGVm");
});

it("keeps the displayed image until the replacement finishes decoding", async () => {
  let finishDecode!: () => void;
  let decoding = 0;
  vi.spyOn(Image.prototype, "decode").mockImplementation(() =>
    ++decoding === 1
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          finishDecode = resolve;
        }),
  );
  let frames = 0;
  const state = {
    open: true,
    controlling: true,
    leaseId: "lease",
    documentId: "doc",
    navigationId: "nav",
  };
  vi.mocked(hostFeatureRequest).mockImplementation(async (_cwd, _capability, method) => ({
    ...state,
    ...(method === "browser.frame"
      ? { data: ++frames === 1 ? "YWJj" : "ZGVm", mimeType: "image/jpeg", width: 800, height: 600 }
      : {}),
  }));
  await act(async () =>
    root.render(createElement(BrowserPanel, { cwd: "/project", sessionId: "session" })),
  );
  const image = container.querySelector("img")!;
  expect(image.src).toContain("YWJj");
  await act(async () => {
    button("Refresh frame").click();
  });
  expect(image.src).toContain("YWJj");
  await act(async () => finishDecode());
  expect(image.src).toContain("ZGVm");
  vi.restoreAllMocks();
});

it("suspends hidden panel polling and restores it without navigating", async () => {
  vi.mocked(hostFeatureRequest).mockImplementation(async (_cwd, _capability, method) => ({
    open: true,
    url: "https://example.test",
    controlling: false,
    documentId: "doc",
    navigationId: "nav",
    ...(method === "browser.frame"
      ? { data: "YWJj", mimeType: "image/jpeg", width: 800, height: 600 }
      : {}),
  }));
  await act(async () =>
    root.render(
      createElement(BrowserPanel, { cwd: "/project", sessionId: "session", active: false }),
    ),
  );
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(hostFeatureRequest).not.toHaveBeenCalled();
  await act(async () =>
    root.render(
      createElement(BrowserPanel, { cwd: "/project", sessionId: "session", active: true }),
    ),
  );
  expect(container.querySelector("img")).not.toBeNull();
  await act(async () =>
    root.render(
      createElement(BrowserPanel, { cwd: "/project", sessionId: "session", active: false }),
    ),
  );
  const calls = vi.mocked(hostFeatureRequest).mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(hostFeatureRequest).toHaveBeenCalledTimes(calls);
  await act(async () =>
    root.render(
      createElement(BrowserPanel, { cwd: "/project", sessionId: "session", active: true }),
    ),
  );
  expect(vi.mocked(hostFeatureRequest).mock.calls.some((call) => call[2] === "browser.open")).toBe(
    false,
  );
});

it("sends pointer down and up in order without a duplicate click", async () => {
  const state = {
    open: true,
    controlling: true,
    leaseId: "lease",
    documentId: "doc",
    navigationId: "nav",
  };
  vi.mocked(hostFeatureRequest).mockImplementation(async (_cwd, _capability, method) => ({
    ...state,
    ...(method === "browser.frame"
      ? { data: "YWJj", mimeType: "image/jpeg", width: 800, height: 600 }
      : {}),
  }));
  await act(async () =>
    root.render(createElement(BrowserPanel, { cwd: "/project", sessionId: "session" })),
  );
  const image = container.querySelector("img")!;
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 800,
    height: 600,
  } as DOMRect);
  await act(async () => {
    image.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, clientX: 20, clientY: 30, button: 0 }),
    );
    image.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, clientX: 20, clientY: 30, button: 0 }),
    );
    image.click();
  });
  const inputs = vi
    .mocked(hostFeatureRequest)
    .mock.calls.filter((call) => call[2] === "browser.input")
    .map((call) => call[3]);
  expect(inputs.map((input) => input?.action)).toEqual(["down", "up"]);
  expect(inputs.every((input) => input?.documentId === "doc")).toBe(true);
});

it("forwards focused hover and cancels wheel locally before scrolling the browser", async () => {
  const state = {
    open: true,
    controlling: true,
    leaseId: "lease",
    documentId: "doc",
    navigationId: "nav",
  };
  vi.mocked(hostFeatureRequest).mockImplementation(async (_cwd, _capability, method) => ({
    ...state,
    ...(method === "browser.frame"
      ? { data: "YWJj", mimeType: "image/jpeg", width: 800, height: 600 }
      : {}),
  }));
  await act(async () =>
    root.render(createElement(BrowserPanel, { cwd: "/project", sessionId: "hover-test" })),
  );
  const image = container.querySelector("img")!;
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 800,
    height: 600,
  } as DOMRect);
  image.focus();
  const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: 3, deltaY: 40 });
  await act(async () => {
    image.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: 80, clientY: 90 }),
    );
    image.dispatchEvent(wheel);
  });
  expect(wheel.defaultPrevented).toBe(true);
  const inputs = vi
    .mocked(hostFeatureRequest)
    .mock.calls.filter((call) => call[2] === "browser.input")
    .map((call) => call[3]);
  expect(inputs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "pointer", action: "move", x: 80, y: 90 }),
      expect.objectContaining({ kind: "scroll", x: 3, y: 40 }),
    ]),
  );
});

it("releases a pressed pointer on cancellation", async () => {
  const state = {
    open: true,
    controlling: true,
    leaseId: "lease",
    documentId: "doc",
    navigationId: "nav",
  };
  vi.mocked(hostFeatureRequest).mockImplementation(async (_cwd, _capability, method) => ({
    ...state,
    ...(method === "browser.frame"
      ? { data: "YWJj", mimeType: "image/jpeg", width: 800, height: 600 }
      : {}),
  }));
  await act(async () =>
    root.render(createElement(BrowserPanel, { cwd: "/project", sessionId: "cancel-test" })),
  );
  const image = container.querySelector("img")!;
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 800,
    height: 600,
  } as DOMRect);
  await act(async () => {
    image.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, clientX: 12, clientY: 16, button: 0 }),
    );
    image.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
  });
  const inputs = vi
    .mocked(hostFeatureRequest)
    .mock.calls.filter((call) => call[2] === "browser.input")
    .map((call) => call[3]);
  expect(inputs.map((input) => input?.action)).toEqual(["down", "up"]);
});

it("does not replay queued input under a replacement lease for the same document", async () => {
  let inputCount = 0;
  const state = {
    open: true,
    controlling: true,
    leaseId: "lease-a",
    documentId: "same-doc",
    navigationId: "nav",
  };
  vi.mocked(hostFeatureRequest).mockImplementation(async (_cwd, _capability, method) => ({
    ...state,
    ...(method === "browser.input" ? { leaseId: ++inputCount === 1 ? "lease-b" : "lease-b" } : {}),
    ...(method === "browser.frame"
      ? { data: "YWJj", mimeType: "image/jpeg", width: 800, height: 600 }
      : {}),
  }));
  await act(async () =>
    root.render(createElement(BrowserPanel, { cwd: "/project", sessionId: "lease-test" })),
  );
  const image = container.querySelector("img")!;
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 800,
    height: 600,
  } as DOMRect);
  await act(async () => {
    image.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    image.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }));
  });
  expect(
    vi.mocked(hostFeatureRequest).mock.calls.filter((call) => call[2] === "browser.input"),
  ).toHaveLength(1);
  expect(container.textContent).toContain(
    "Browser input was not sent because the page or control changed.",
  );
});

it("rechecks the lease at actual dispatch after a queued frame read", async () => {
  let finish!: (value: unknown) => void;
  let frames = 0;
  const state = {
    open: true,
    controlling: true,
    leaseId: "lease-a",
    documentId: "doc",
    navigationId: "nav",
  };
  vi.mocked(hostFeatureRequest).mockImplementation(async (_cwd, _capability, method) => {
    if (method === "browser.frame" && ++frames === 2)
      return await new Promise((resolve) => {
        finish = resolve;
      });
    return {
      ...state,
      ...(method === "browser.frame"
        ? { data: "YWJj", mimeType: "image/jpeg", width: 800, height: 600 }
        : {}),
    };
  });
  await act(async () =>
    root.render(createElement(BrowserPanel, { cwd: "/project", sessionId: "serial-lease" })),
  );
  const image = container.querySelector("img")!;
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 800,
    height: 600,
  } as DOMRect);
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  await act(async () => image.click());
  await act(async () =>
    finish({
      ...state,
      leaseId: "lease-b",
      data: "YWJj",
      mimeType: "image/jpeg",
      width: 800,
      height: 600,
    }),
  );
  expect(
    vi.mocked(hostFeatureRequest).mock.calls.filter((call) => call[2] === "browser.input"),
  ).toHaveLength(0);
});

it("blocks further input after a failed frame until a successful explicit refresh", async () => {
  let frames = 0;
  const state = {
    open: true,
    controlling: true,
    leaseId: "lease",
    documentId: "doc",
    navigationId: "nav",
  };
  vi.mocked(hostFeatureRequest).mockImplementation(async (_cwd, _capability, method) => {
    if (method === "browser.frame" && ++frames === 2) throw new Error("capture failed");
    return {
      ...state,
      ...(method === "browser.frame"
        ? { data: "YWJj", mimeType: "image/jpeg", width: 800, height: 600 }
        : {}),
    };
  });
  await act(async () =>
    root.render(createElement(BrowserPanel, { cwd: "/project", sessionId: "failure-test" })),
  );
  const image = container.querySelector("img")!;
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 800,
    height: 600,
  } as DOMRect);
  await act(async () => image.click());
  await act(async () => vi.advanceTimersByTimeAsync(50));
  expect(container.querySelector("img")).toBe(image);
  await act(async () => image.click());
  expect(
    vi.mocked(hostFeatureRequest).mock.calls.filter((call) => call[2] === "browser.input"),
  ).toHaveLength(1);
  await act(async () => button("Refresh frame").click());
  await act(async () => image.click());
  expect(
    vi.mocked(hostFeatureRequest).mock.calls.filter((call) => call[2] === "browser.input"),
  ).toHaveLength(2);
});

it("never resends uncertain input and requires explicit frame recovery", async () => {
  let inputs = 0;
  const state = {
    open: true,
    controlling: true,
    leaseId: "lease",
    documentId: "doc",
    navigationId: "nav",
  };
  vi.mocked(hostFeatureRequest).mockImplementation(async (_cwd, _capability, method) => {
    if (method === "browser.input" && ++inputs === 1) throw new Error("RPC_TIMEOUT");
    return {
      ...state,
      ...(method === "browser.frame"
        ? { data: "YWJj", mimeType: "image/jpeg", width: 800, height: 600 }
        : {}),
    };
  });
  await act(async () =>
    root.render(createElement(BrowserPanel, { cwd: "/project", sessionId: "timeout-test" })),
  );
  const image = container.querySelector("img")!;
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 800,
    height: 600,
  } as DOMRect);
  await act(async () => image.click());
  await act(async () => image.click());
  expect(inputs).toBe(1);
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(inputs).toBe(1);
  await act(async () => button("Refresh frame").click());
  await act(async () => image.click());
  expect(inputs).toBe(2);
});

it("dispatches queued pointer input before requesting one replacement frame", async () => {
  const state = {
    open: true,
    controlling: true,
    leaseId: "lease",
    documentId: "doc",
    navigationId: "nav",
  };
  vi.mocked(hostFeatureRequest).mockImplementation(async (_cwd, _capability, method) => ({
    ...state,
    ...(method === "browser.frame"
      ? { data: "YWJj", mimeType: "image/jpeg", width: 800, height: 600 }
      : {}),
  }));
  await act(async () =>
    root.render(createElement(BrowserPanel, { cwd: "/project", sessionId: "session" })),
  );
  const image = container.querySelector("img")!;
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 800,
    height: 600,
  } as DOMRect);
  await act(async () => {
    image.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    image.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }));
  });
  const beforeFrame = vi.mocked(hostFeatureRequest).mock.calls.map((call) => call[2]);
  expect(beforeFrame.slice(-2)).toEqual(["browser.input", "browser.input"]);
  await act(async () => vi.advanceTimersByTimeAsync(150));
  expect(
    vi.mocked(hostFeatureRequest).mock.calls.filter((call) => call[2] === "browser.frame"),
  ).toHaveLength(2);
});

it("sends text through the focused browser input receiver", async () => {
  const state = {
    open: true,
    controlling: true,
    leaseId: "lease",
    documentId: "doc",
    navigationId: "nav",
  };
  vi.mocked(hostFeatureRequest).mockImplementation(async (_cwd, _capability, method) => ({
    ...state,
    ...(method === "browser.frame"
      ? { data: "YWJj", mimeType: "image/jpeg", width: 800, height: 600 }
      : {}),
  }));
  await act(async () =>
    root.render(createElement(BrowserPanel, { cwd: "/project", sessionId: "session" })),
  );
  const receiver = container.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Direct browser input"]',
  )!;
  receiver.focus();
  await act(async () => {
    receiver.value = "İstanbul";
    receiver.dispatchEvent(new InputEvent("input", { bubbles: true, data: "İstanbul" }));
  });
  expect(hostFeatureRequest).toHaveBeenCalledWith(
    "/project",
    "browser.sessionScopes.v1",
    "browser.input",
    expect.objectContaining({ kind: "text", text: "İstanbul", documentId: "doc" }),
  );
});

it("holds intermediate composition and sends final pasted text once", async () => {
  const state = {
    open: true,
    controlling: true,
    leaseId: "lease",
    documentId: "doc",
    navigationId: "nav",
  };
  vi.mocked(hostFeatureRequest).mockImplementation(async (_cwd, _capability, method) => ({
    ...state,
    ...(method === "browser.frame"
      ? { data: "YWJj", mimeType: "image/jpeg", width: 800, height: 600 }
      : {}),
  }));
  await act(async () =>
    root.render(createElement(BrowserPanel, { cwd: "/project", sessionId: "composition-test" })),
  );
  const receiver = container.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Direct browser input"]',
  )!;
  receiver.focus();
  await act(async () => {
    receiver.value = "İsta";
    receiver.dispatchEvent(
      new InputEvent("input", { bubbles: true, data: "İsta", isComposing: true }),
    );
  });
  expect(vi.mocked(hostFeatureRequest).mock.calls.some((call) => call[2] === "browser.input")).toBe(
    false,
  );
  await act(async () => {
    receiver.value = "İstanbul";
    receiver.dispatchEvent(
      new InputEvent("input", { bubbles: true, data: "İstanbul", inputType: "insertFromPaste" }),
    );
  });
  expect(
    vi
      .mocked(hostFeatureRequest)
      .mock.calls.filter((call) => call[2] === "browser.input")
      .map((call) => call[3]?.text),
  ).toEqual(["İstanbul"]);
});

it("forwards focused selection shortcut with its modifier", async () => {
  const state = {
    open: true,
    controlling: true,
    leaseId: "lease",
    documentId: "doc",
    navigationId: "nav",
  };
  vi.mocked(hostFeatureRequest).mockImplementation(async (_cwd, _capability, method) => ({
    ...state,
    ...(method === "browser.frame"
      ? { data: "YWJj", mimeType: "image/jpeg", width: 800, height: 600 }
      : {}),
  }));
  await act(async () =>
    root.render(createElement(BrowserPanel, { cwd: "/project", sessionId: "key-test" })),
  );
  const receiver = container.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Direct browser input"]',
  )!;
  receiver.focus();
  await act(async () =>
    receiver.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "a", ctrlKey: true }),
    ),
  );
  expect(hostFeatureRequest).toHaveBeenCalledWith(
    "/project",
    "browser.sessionScopes.v1",
    "browser.input",
    expect.objectContaining({ kind: "key", key: "A", modifiers: ["Control"] }),
  );
});

it("renders a390px browser frame without stretching its coordinate system", async () => {
  vi.mocked(hostFeatureRequest).mockImplementation(async (_cwd, _capability, method) => ({
    open: true,
    url: "http://localhost:3000/",
    controlling: true,
    leaseId: "lease",
    leaseExpiresAt: Date.now() + 30_000,
    viewport: { width: 390, height: 844 },
    navigationId: "mobile",
    ...(method === "browser.frame"
      ? { width: 390, height: 844, mimeType: "image/jpeg", data: "mobile" }
      : {}),
  }));
  await act(async () =>
    root.render(createElement(BrowserPanel, { cwd: "/project", sessionId: "session" })),
  );
  const image = container.querySelector<HTMLImageElement>(".host-browser-frame")!;
  expect(image).not.toBeNull();
  const preview = container.querySelector<HTMLElement>(".host-browser-preview")!;
  expect(preview.style.getPropertyValue("--host-browser-width")).toBe("390px");
  expect(Number(preview.style.getPropertyValue("--host-browser-aspect"))).toBeCloseTo(390 / 844);
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
    left: 10,
    top: 20,
    width: 195,
    height: 422,
  } as DOMRect);
  await act(async () =>
    image.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 107.5, clientY: 231 })),
  );
  expect(hostFeatureRequest).toHaveBeenCalledWith(
    "/project",
    "browser.sessionScopes.v1",
    "browser.input",
    {
      kind: "click",
      x: 195,
      y: 422,
      leaseId: "lease",
      sessionId: "session",
      requestId: expect.any(String),
    },
  );
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

it("recovers from another client's lease through an explicit control claim", async () => {
  vi.mocked(hostFeatureRequest).mockImplementation(async (_cwd, _capability, method, params) => {
    if (method === "browser.claim" && params?.takeover !== true)
      throw new Error("Another device controls this browser");
    return {
      open: true,
      url: "http://localhost:3000",
      controlling: method === "browser.claim",
      leaseId: method === "browser.claim" ? "owner-lease" : undefined,
    };
  });
  await act(async () => root.render(createElement(BrowserPanel, { cwd: "/project" })));
  await act(async () => button("Open website").click());
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  await act(async () => button("View only").click());
  await act(async () => button("Claim control").click());
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(hostFeatureRequest).toHaveBeenLastCalledWith(
    "/project",
    "browser.shared",
    "browser.claim",
    { takeover: true, leaseId: undefined },
  );
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
  await act(async () => button("Browser controls and setup").click());
  await act(async () => button("Renew control").click());
  expect(button("Open website").disabled).toBe(false);
  act(() => vi.advanceTimersByTime(30_000));
  expect(button("Open website").disabled).toBe(false);
  if (!button("Type text")) await act(async () => button("Browser controls and setup").click());
  expect(button("Type text").disabled).toBe(true);
  expect(button("Refresh frame").disabled).toBe(false);
  await act(async () => button("View only").click());
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
  if (!button("Type text")) await act(async () => button("Browser controls and setup").click());
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
  await act(async () => button("View only").click());
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
    requestId: expect.any(String),
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
  if (!button("Type text")) await act(async () => button("Browser controls and setup").click());
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
  await act(async () => button("Browser controls and setup").click());
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
  const status = container.querySelector(".host-browser-status-dot")!;
  expect(status.getAttribute("data-tone")).toBe("danger");
  // The status dot opens the controls, where the failed read can be retried.
  await act(async () => button("Browser unavailable").click());
  await act(async () => button("Retry").click());
  expect(container.querySelector(".host-browser-status-dot")!.getAttribute("data-tone")).toBe(
    "warning",
  );
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
  await act(async () => button("Browser controls and setup").click());
  expect(document.body.textContent).toContain("Browser runtime ready");
  expect(button("Set up host browser")).toBeUndefined();
});

it("refreshes live view by default and pauses while disabled, hidden or unmounted", async () => {
  vi.mocked(hostFeatureRequest).mockResolvedValue({
    open: true,
    url: "https://example.test",
    controlling: false,
  });
  await act(async () => root.render(createElement(BrowserPanel, { cwd: "remote://mac/repo" })));
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(hostFeatureRequest).toHaveBeenCalledTimes(3);
  const liveSwitch = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
  await act(async () => liveSwitch.click());
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(hostFeatureRequest).toHaveBeenCalledTimes(3);
  await act(async () => liveSwitch.click());
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(hostFeatureRequest).toHaveBeenCalledTimes(3);
  hidden.mockReturnValue(false);
  await act(async () => vi.advanceTimersByTimeAsync(1000));
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
    {
      leaseId: "selected-lease",
      sessionId: "mac-session",
      ownerPresentationScope: expect.any(String),
    },
    { kind: "local" },
  );
  expect(hostFeatureRequest).not.toHaveBeenCalled();
  expect(
    vi.mocked(hostToolRequest).mock.calls.every((call) => call[3]?.sessionId === "mac-session"),
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
  await act(async () => vi.advanceTimersByTimeAsync(1000));
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
  expect(
    container.querySelector<HTMLButtonElement>('[role="switch"]')!.getAttribute("aria-checked"),
  ).toBe("true");
  expect(container.textContent).not.toContain("https://old.test");
  expect(button("Open website").disabled).toBe(false);
  if (!button("Type text")) await act(async () => button("Browser controls and setup").click());
  expect(button("Type text").disabled).toBe(true);
  expect(button("Refresh frame").disabled).toBe(true);
  await act(async () => vi.advanceTimersByTime(3000));
  expect(frames).toBe(2);
  expect(hostFeatureRequest).not.toHaveBeenCalled();
});
