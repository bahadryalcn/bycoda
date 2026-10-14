// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { BrowserPanel } from "./BrowserPanel";
import { hostFeatureRequest } from "../connections/model/hostFeatureClient";
import { registerBrowserComposer } from "./browserComposer";

vi.mock("../connections/model/hostFeatureClient", () => ({ hostFeatureRequest: vi.fn() }));
let container: HTMLDivElement, root: Root;
let state: Record<string, unknown>;
const element = {
  tag: "button",
  text: "Save",
  selector: "body > button",
  path: "body > button",
  ancestry: [],
  computedStyle: {},
  bounds: { x: 10, y: 20, width: 100, height: 40 },
  center: { x: 60, y: 40 },
};
const selection = {
  id: "selection",
  sessionId: "host",
  projectId: "project",
  navigationId: "nav",
  pageUrl: "https://example.test/",
  capturedAt: "now",
  viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
  devicePixelRatio: 1,
  element,
  trust: "untrusted-page-data",
  limitations: [],
  screenshot: { data: "YWJj", mimeType: "image/jpeg", width: 1280, height: 720 },
};
const button = (name: string) =>
  Array.from(container.querySelectorAll("button")).find((el) => el.textContent === name)!;
async function render(sessionId = "host", composerSessionId = "shell") {
  await act(async () =>
    root.render(createElement(BrowserPanel, { cwd: "/project", sessionId, composerSessionId })),
  );
}
async function start() {
  await act(async () => button("Select element and add to composer").click());
}
async function select() {
  const img = container.querySelector("img")!;
  vi.spyOn(img, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 640,
    height: 360,
  } as DOMRect);
  await act(async () =>
    img.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 30, clientY: 20 })),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  state = {
    open: true,
    url: "https://example.test/",
    controlling: true,
    leaseId: "lease",
    leaseExpiresAt: 31000,
    navigationId: "nav",
  };
  vi.mocked(hostFeatureRequest)
    .mockReset()
    .mockImplementation(async (_cwd, _cap, method) => {
      if (method === "browser.annotation.start") state.annotationId = "annotation";
      if (method === "browser.annotation.cancel") delete state.annotationId;
      return {
        ...state,
        ...(method === "browser.frame"
          ? { data: "YWJj", mimeType: "image/jpeg", width: 1280, height: 720 }
          : {}),
        ...(method === "browser.annotation.select" || method === "browser.annotation.read"
          ? { selection }
          : {}),
      };
    });
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

it("routes selection clicks to inspection, then only adds a draft attachment after review", async () => {
  const receive = vi.fn(() => true);
  const stop = registerBrowserComposer("/project", "shell", receive);
  try {
    await render();
    await start();
    await select();
    expect(hostFeatureRequest).toHaveBeenCalledWith(
      "/project",
      "browser.annotation",
      "browser.annotation.select",
      {
        sessionId: "host",
        annotationId: "annotation",
        navigationId: "nav",
        leaseId: "lease",
        x: 60,
        y: 40,
      },
    );
    expect(
      vi.mocked(hostFeatureRequest).mock.calls.some((call) => call[2] === "browser.input"),
    ).toBe(false);
    expect(receive).not.toHaveBeenCalled();
    expect(container.querySelector('[data-selected="true"]')).not.toBeNull();
    await act(async () => button("Add selection to composer").click());
    expect(receive).toHaveBeenCalledOnce();
    expect(receive.mock.calls[0][0]).toMatchObject({
      browserAnnotation: { sessionId: "host", projectId: "project" },
    });
    expect(container.textContent).toContain("Added to composer");
  } finally {
    stop();
  }
});
it("clears on remove, Escape, navigation and lease loss", async () => {
  await render();
  await start();
  await select();
  await act(async () => button("Remove selection").click());
  expect(container.textContent).not.toContain("Explain the selected element");
  await select();
  await act(async () =>
    container
      .querySelector("img")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(container.textContent).not.toContain("Cancel selection");
  await start();
  await select();
  state.navigationId = "next";
  delete state.annotationId;
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  expect(container.textContent).not.toContain("Explain the selected element");
  expect(container.querySelector("img")).toBeNull();
  state.navigationId = "nav";
  await act(async () => button("Refresh frame").click());
  await start();
  await select();
  await act(async () => {
    vi.advanceTimersByTime(30_000);
  });
  expect(container.textContent).not.toContain("Cancel selection");
  expect(button("Select element and add to composer").disabled).toBe(true);
});
it("ignores a late capture after the target conversation changes", async () => {
  await render();
  await start();
  let finish!: (value: unknown) => void;
  vi.mocked(hostFeatureRequest).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const img = container.querySelector("img")!;
  vi.spyOn(img, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 640,
    height: 360,
  } as DOMRect);
  act(() =>
    img.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 30, clientY: 20 })),
  );
  await act(async () => {});
  await render("other-host", "other-shell");
  await act(async () => {
    finish({ ...state, selection });
  });
  expect(container.textContent).not.toContain("Explain the selected element");
  expect(container.textContent).not.toContain("Cancel selection");
});

it("inspects the latest hover point when an earlier host read finishes slowly", async () => {
  await render();
  await start();
  const img = container.querySelector("img")!;
  vi.spyOn(img, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 640,
    height: 360,
  } as DOMRect);
  let finish!: (value: unknown) => void;
  vi.mocked(hostFeatureRequest).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  act(() =>
    img.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 30, clientY: 20 })),
  );
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
  act(() =>
    img.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: 200, clientY: 20 }),
    ),
  );
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
  const next = { ...element, bounds: { ...element.bounds, x: 200 } };
  vi.mocked(hostFeatureRequest).mockImplementationOnce(async () => ({ ...state, hover: next }));
  await act(async () => {
    finish({ ...state, hover: element });
  });
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
  expect(
    container.querySelector<HTMLElement>('[data-selected="false"]')?.style.insetInlineStart,
  ).toBe("15.625%");
  expect(hostFeatureRequest).toHaveBeenLastCalledWith(
    "/project",
    "browser.annotation",
    "browser.annotation.hover",
    {
      sessionId: "host",
      annotationId: "annotation",
      navigationId: "nav",
      leaseId: "lease",
      x: 400,
      y: 40,
    },
  );
});
