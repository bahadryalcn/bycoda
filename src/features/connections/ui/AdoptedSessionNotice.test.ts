// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession, type Session } from "../../sessions/model/session";
import { AdoptedSessionNotice } from "./AdoptedSessionNotice";
import { setLanguagePreference } from "../../../shared/i18n";

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
afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await setLanguagePreference("en");
});
const button = () => container.querySelector("button")!;
const buttonText = () => {
  const copy = button().cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return copy.textContent;
};

it("shows both warnings, disables repeat clicks, and explains the preserved copy after success", async () => {
  let finish!: (preserved: boolean) => void;
  const onRefresh = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  act(() => root.render(createElement(AdoptedSessionNotice, { session, onRefresh })));
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "running in the background",
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Your messages were kept",
  );
  act(() => {
    button().click();
    button().click();
  });
  expect(onRefresh).toHaveBeenCalledExactlyOnceWith(session.id);
  expect(button().disabled).toBe(true);
  expect(buttonText()).toBe("Refreshing…");
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
  expect(button()).toBeNull();
});

it("shows a connection failure and allows a successful retry", async () => {
  const onRefresh = vi
    .fn()
    .mockRejectedValueOnce(new Error("Host unavailable. Try again."))
    .mockResolvedValue(false);
  act(() => root.render(createElement(AdoptedSessionNotice, { session, onRefresh })));
  await act(async () => button().click());
  expect(container.textContent).toContain("Check the connection and try again");
  expect(buttonText()).toBe("Retry refresh");
  await act(async () => button().click());
  expect(onRefresh).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain("Conversation synced.");
  expect(container.textContent).not.toContain("Check the connection and try again");
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

it("explains automatic background updates without a redundant refresh action", () => {
  act(() =>
    root.render(
      createElement(AdoptedSessionNotice, {
        session: { ...session, adoptedSyncConflict: undefined },
        onRefresh: vi.fn(),
      }),
    ),
  );
  expect(container.textContent).toContain("New messages appear automatically");
  expect(button()).toBeNull();
});

it("hides the extra notice when a live turn is already attached", () => {
  act(() =>
    root.render(
      createElement(AdoptedSessionNotice, {
        session: { ...session, busy: true, adoptedSyncConflict: undefined },
        onRefresh: vi.fn(),
      }),
    ),
  );
  expect(container.textContent).toBe("");
});

it("clears success feedback after six seconds without hiding an active background run", async () => {
  vi.useFakeTimers();
  const onRefresh = vi.fn(async () => false);
  act(() => root.render(createElement(AdoptedSessionNotice, { session, onRefresh })));
  await act(async () => button().click());
  act(() =>
    root.render(
      createElement(AdoptedSessionNotice, {
        session: { ...session, adoptedSyncConflict: undefined },
        onRefresh,
      }),
    ),
  );
  expect(container.textContent).toContain("Conversation synced.");
  act(() => vi.advanceTimersByTime(6_000));
  expect(container.textContent).not.toContain("Conversation synced.");
  expect(container.textContent).toContain("running in the background");
  act(() =>
    root.render(
      createElement(AdoptedSessionNotice, {
        session: { ...session, adoptedSyncConflict: undefined, continuingElsewhere: undefined },
        onRefresh,
      }),
    ),
  );
  expect(container.textContent).toBe("");
});

it("translates background, conflict, action and success messages into Turkish", async () => {
  await setLanguagePreference("tr");
  act(() =>
    root.render(
      createElement(AdoptedSessionNotice, {
        session,
        onRefresh: vi.fn(async () => true),
      }),
    ),
  );
  expect(container.textContent).toContain("arka planda devam ediyor");
  expect(container.textContent).toContain("iki farklı sürümü bulundu");
  expect(button().textContent).toBe("Konuşmayı eşitle");
  await act(async () => button().click());
  expect(container.textContent).toContain("Konuşma eşitlendi.");
  expect(container.textContent).toContain("proje geçmişine");
  expect(container.textContent).not.toContain("host");
});
