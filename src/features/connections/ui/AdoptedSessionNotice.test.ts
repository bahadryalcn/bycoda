// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession, type Session } from "../../sessions/model/session";
import { AdoptedSessionNotice } from "./AdoptedSessionNotice";

let root: Root;
let container: HTMLDivElement;
let session: Session;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  session = {
    ...newSession("claude", "/repo"),
    continuingElsewhere: true,
    adoptedSyncConflict: true,
  };
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const button = () => container.querySelector("button")!;

it("shows both warnings, disables repeat clicks, and explains the preserved copy after success", async () => {
  let finish!: (preserved: boolean) => void;
  const onRefresh = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  act(() => root.render(createElement(AdoptedSessionNotice, { session, onRefresh })));
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Working on host");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("local copy was kept");
  act(() => {
    button().click();
    button().click();
  });
  expect(onRefresh).toHaveBeenCalledExactlyOnceWith(session.id);
  expect(button().disabled).toBe(true);
  expect(button().textContent).toBe("Refreshing…");
  await act(async () => {
    finish(true);
    root.render(
      createElement(AdoptedSessionNotice, {
        session: {
          ...session,
          continuingElsewhere: undefined,
          adoptedSyncConflict: undefined,
        },
        onRefresh,
      }),
    );
  });
  expect(container.textContent).toContain("project history");
  expect(container.textContent).toContain("(local copy)");
  expect(button().disabled).toBe(false);
});

it("shows a connection failure and allows a successful retry", async () => {
  const onRefresh = vi
    .fn()
    .mockRejectedValueOnce(new Error("Host unavailable. Try again."))
    .mockResolvedValue(false);
  act(() => root.render(createElement(AdoptedSessionNotice, { session, onRefresh })));
  await act(async () => button().click());
  expect(container.textContent).toContain("Host unavailable");
  expect(button().textContent).toBe("Retry refresh");
  await act(async () => button().click());
  expect(onRefresh).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain("Updated from host.");
  expect(container.textContent).not.toContain("Host unavailable");
});

it("blocks refresh during a local turn", () => {
  const onRefresh = vi.fn();
  act(() =>
    root.render(
      createElement(AdoptedSessionNotice, {
        session: { ...session, busy: true },
        onRefresh,
      }),
    ),
  );
  act(() => button().click());
  expect(button().disabled).toBe(true);
  expect(onRefresh).not.toHaveBeenCalled();
});
