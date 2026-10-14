// @vitest-environment happy-dom
import { act, createElement, type MutableRefObject } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useFollowBottom } from "./useFollowBottom";
vi.mock("../model/transcriptActivity", () => ({ nestedScrollAbsorbsWheel: () => true }));
afterEach(() => vi.unstubAllGlobals());

it("okuyucu yukarı gidince takibi durdurur, büyümede konumunu korur ve dinleyiciyi temizler", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let resize!: () => void;
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const el = document.createElement("div");
  el.append(document.createElement("div"));
  let height = 500;
  Object.defineProperties(el, {
    scrollHeight: { get: () => height },
    clientHeight: { value: 100 },
  });
  const root = createRoot(document.createElement("div"));
  let following!: MutableRefObject<boolean>;
  function Probe({ revision }: { revision: number }) {
    following = useFollowBottom(el, true, revision, 16, true);
    return null;
  }
  act(() => root.render(createElement(Probe, { revision: 1 })));
  el.scrollTop = 400;
  el.dispatchEvent(new Event("scroll"));
  el.scrollTop = 200;
  el.dispatchEvent(new Event("scroll"));
  expect(following.current).toBe(false);
  height = 600;
  act(() => resize());
  expect(el.scrollTop).toBe(200);
  el.scrollTop = 500;
  el.dispatchEvent(new Event("scroll"));
  expect(following.current).toBe(true);
  height = 700;
  act(() => resize());
  expect(el.scrollTop).toBe(700);
  height = 400;
  el.scrollTop = 300;
  el.dispatchEvent(new Event("scroll"));
  expect(following.current).toBe(true);
  act(() => root.unmount());
  expect(disconnect).toHaveBeenCalledTimes(1);
  following.current = true;
  el.scrollTop = 20;
  el.dispatchEvent(new Event("scroll"));
  expect(following.current).toBe(true);
});

it("32 piksel mesafe politikası hareket yönünden bağımsız devam eder", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const el = document.createElement("div");
  el.append(document.createElement("div"));
  Object.defineProperties(el, { scrollHeight: { value: 500 }, clientHeight: { value: 100 } });
  const root = createRoot(document.createElement("div"));
  let following!: MutableRefObject<boolean>;
  const target = { current: el };
  function Probe() {
    following = useFollowBottom(target, true, 1, 32);
    return null;
  }
  act(() => root.render(createElement(Probe)));
  el.scrollTop = 400;
  el.dispatchEvent(new Event("scroll"));
  el.scrollTop = 369;
  el.dispatchEvent(new Event("scroll"));
  expect(following.current).toBe(true);
  el.scrollTop = 367;
  el.dispatchEvent(new Event("scroll"));
  expect(following.current).toBe(false);
  el.scrollTop = 376;
  el.dispatchEvent(new Event("scroll"));
  expect(following.current).toBe(true);
  act(() => root.unmount());
});
