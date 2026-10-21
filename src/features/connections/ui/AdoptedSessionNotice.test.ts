// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession, type Session } from "../../sessions/model/session";
import { AdoptedSessionNotice, BackgroundSessionIndicator } from "./AdoptedSessionNotice";
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
  expect(container.textContent).not.toContain("running in the background");
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

it("removes an obsolete Retry warning when automatic reconciliation clears the conflict", async () => {
  const onRefresh = vi.fn().mockRejectedValue(new Error("offline"));
  act(() => root.render(createElement(AdoptedSessionNotice, { session, onRefresh })));
  await act(async () => button().click());
  expect(buttonText()).toBe("Retry refresh");
  act(() =>
    root.render(
      createElement(AdoptedSessionNotice, {
        session: { ...session, adoptedSyncConflict: undefined },
        onRefresh,
      }),
    ),
  );
  expect(button()).toBeNull();
  expect(container.textContent).not.toContain("Check the connection and try again");
  expect(container.textContent).toBe("");
});

it("does not leave a different conversation busy or show an old refresh failure", async () => {
  let fail!: (reason: unknown) => void;
  const onRefresh = vi.fn(
    () =>
      new Promise<boolean>((_resolve, reject) => {
        fail = reject;
      }),
  );
  act(() => root.render(createElement(AdoptedSessionNotice, { session, onRefresh })));
  await act(async () => {
    button().click();
  });
  const other = {
    ...session,
    id: "other",
    adoptedSyncConflict: undefined,
    continuingElsewhere: undefined,
  };
  act(() => root.render(createElement(AdoptedSessionNotice, { session: other, onRefresh })));
  expect(container.textContent).toBe("");
  await act(async () => fail(new Error("offline")));
  expect(container.textContent).toBe("");
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
  expect(container.textContent).toBe("");
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
  expect(container.textContent).toBe("");
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
  expect(container.textContent).not.toContain("arka planda devam ediyor");
  expect(container.textContent).toContain("iki farklı sürümü bulundu");
  expect(button().textContent).toBe("Konuşmayı eşitle");
  await act(async () => button().click());
  expect(container.textContent).toContain("Konuşma eşitlendi.");
  expect(container.textContent).toContain("proje geçmişine");
  expect(container.textContent).not.toContain("host");
});

it("keeps background execution in an accessible SVG action with tap and keyboard details", async () => {
  act(() => root.render(createElement(BackgroundSessionIndicator, { session })));
  expect(button().getAttribute("aria-label")).toContain("running in the background");
  expect(button().querySelector("svg")).not.toBeNull();
  expect(container.textContent).toBe("");
  button().focus();
  expect(document.activeElement).toBe(button());
  await act(async () => button().click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "New messages appear automatically",
  );
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  act(() =>
    root.render(createElement(BackgroundSessionIndicator, { session: { ...session, busy: true } })),
  );
  expect(button()).toBeNull();
});
