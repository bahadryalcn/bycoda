// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession, type Session } from "../../sessions/model/session";
import { AdoptedSessionNotice, BackgroundSessionIndicator } from "./AdoptedSessionNotice";
import { setLanguagePreference } from "../../../shared/i18n";
import { getSessions, resetSessionsStore } from "../../sessions/model/sessionsStore";

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

it("shows the warning, disables repeat clicks, and reports the sync without any copy", async () => {
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
  expect(container.textContent).toContain("Conversation synced.");
  expect(container.textContent).not.toContain("local copy");
  expect(container.textContent).not.toContain("project history");
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
  expect(container.textContent).not.toContain("host");
  act(() =>
    root.render(
      createElement(AdoptedSessionNotice, {
        session: { ...session, adoptedDivergence: { key: "k" } },
        onRefresh: vi.fn(),
      }),
    ),
  );
  expect(container.textContent).toContain("iki bilgisayarda değiştirildi");
  expect([...container.querySelectorAll("button")].map((item) => item.textContent)).toEqual([
    "Bunu koru",
    "Diğerini koru",
    "İkisini de koru",
  ]);
});

it("keeps background execution in an accessible action with tap and keyboard details", async () => {
  act(() => root.render(createElement(BackgroundSessionIndicator, { session })));
  expect(button().getAttribute("aria-label")).toContain("running in the background");
  expect(button().querySelector('[aria-hidden="true"]')).not.toBeNull();
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

const choices = () => [...container.querySelectorAll("button")];
const choiceTexts = () => choices().map((item) => item.textContent);

it("offers the three choices only for a proven divergence, and Keep this records the answer on the session", () => {
  const flagged: Session = { ...session, adoptedDivergence: { key: "3:a:b:x:y" } };
  resetSessionsStore([flagged]);
  const onRefresh = vi.fn();
  // A conflict without a proven divergence has just the sync action.
  act(() => root.render(createElement(AdoptedSessionNotice, { session, onRefresh })));
  expect(choiceTexts()).toEqual(["Sync conversation"]);
  expect(container.textContent).toContain("Sync to compare them again");

  act(() => root.render(createElement(AdoptedSessionNotice, { session: flagged, onRefresh })));
  expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
  expect(container.textContent).toContain("changed on two computers");
  expect(choiceTexts()).toEqual(["Keep this", "Keep other", "Keep both"]);
  // What each answer costs is visible text, not only a tooltip.
  expect(container.textContent).toContain("Keep this discards the other computer's changes");
  expect(container.textContent).toContain("Keep other discards the changes made here");
  // Dropping the other computer's work is asked twice, with Keep both on offer.
  act(() => choices()[0].click());
  expect(onRefresh).not.toHaveBeenCalled();
  expect(getSessions()[0].adoptedDivergence?.keep).toBeUndefined();
  expect(container.textContent).toContain("Discard the other computer's changes");
  expect(choiceTexts()).toEqual(["Discard and keep this", "Keep both", "Back"]);
  act(() => choices()[2].click());
  expect(choiceTexts()).toEqual(["Keep this", "Keep other", "Keep both"]);
  expect(getSessions()[0].adoptedDivergence?.keep).toBeUndefined();
  act(() => choices()[0].click());
  act(() => choices()[0].click());
  expect(onRefresh).not.toHaveBeenCalled();
  expect(getSessions()[0]).toMatchObject({
    adoptedSyncConflict: undefined,
    adoptedDivergence: { key: "3:a:b:x:y", keep: true },
  });
  // The session is answered: the notice leaves with the conflict flag.
  act(() =>
    root.render(createElement(AdoptedSessionNotice, { session: getSessions()[0], onRefresh })),
  );
  expect(container.textContent).toBe("");
});

it("Keep both is one click away from the Keep this confirmation", async () => {
  const flagged: Session = { ...session, adoptedDivergence: { key: "k" } };
  resetSessionsStore([flagged]);
  const onRefresh = vi.fn(async () => true);
  act(() => root.render(createElement(AdoptedSessionNotice, { session: flagged, onRefresh })));
  act(() => choices()[0].click());
  await act(async () => choices()[1].click());
  expect(onRefresh).toHaveBeenCalledExactlyOnceWith(flagged.id, undefined, "keep-both");
  expect(getSessions()[0].adoptedDivergence?.keep).toBeUndefined();
});

it("Keep other asks for the other version once, with no copy, and says which one was kept", async () => {
  const flagged: Session = { ...session, adoptedDivergence: { key: "k" } };
  let finish!: (branched: boolean) => void;
  const onRefresh = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  act(() => root.render(createElement(AdoptedSessionNotice, { session: flagged, onRefresh })));
  act(() => {
    choices()[1].click();
    choices()[1].click();
  });
  expect(onRefresh).toHaveBeenCalledExactlyOnceWith(flagged.id, undefined, "keep-other");
  // Nothing else can be chosen while the answer is being applied.
  expect(choices().every((item) => item.disabled)).toBe(true);
  await act(async () => {
    finish(false);
    root.render(
      createElement(AdoptedSessionNotice, {
        session: { ...flagged, adoptedSyncConflict: undefined, adoptedDivergence: undefined },
        onRefresh,
      }),
    );
  });
  expect(container.textContent).toContain("The other computer's version was kept");
  expect(container.textContent).not.toContain("local copy");
});

it("Keep both asks for one branch and tells where it is", async () => {
  const flagged: Session = { ...session, adoptedDivergence: { key: "k" } };
  const onRefresh = vi.fn(async () => true);
  act(() => root.render(createElement(AdoptedSessionNotice, { session: flagged, onRefresh })));
  await act(async () => choices()[2].click());
  expect(onRefresh).toHaveBeenCalledExactlyOnceWith(flagged.id, undefined, "keep-both");
  await act(async () =>
    root.render(
      createElement(AdoptedSessionNotice, {
        session: { ...flagged, adoptedSyncConflict: undefined, adoptedDivergence: undefined },
        onRefresh,
      }),
    ),
  );
  expect(container.textContent).toContain("Both versions are kept");
  expect(container.textContent).toContain("new conversation in project history");
  expect(container.textContent).not.toContain("(local copy)");
});

it("keeps the choices on screen when applying one fails, and a later answer can be tried again", async () => {
  const flagged: Session = { ...session, adoptedDivergence: { key: "k" } };
  const onRefresh = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(true);
  act(() => root.render(createElement(AdoptedSessionNotice, { session: flagged, onRefresh })));
  await act(async () => choices()[2].click());
  expect(container.textContent).toContain("Check the connection and try again");
  expect(choiceTexts()).toEqual(["Keep this", "Keep other", "Keep both"]);
  expect(choices().some((item) => item.disabled)).toBe(false);
  await act(async () => choices()[2].click());
  expect(onRefresh).toHaveBeenCalledTimes(2);
});

it("cannot answer during a local turn, and a sync that finds two versions asks instead of saying it synced", async () => {
  const flagged: Session = { ...session, adoptedDivergence: { key: "k" } };
  act(() =>
    root.render(
      createElement(AdoptedSessionNotice, {
        session: { ...flagged, busy: true },
        onRefresh: vi.fn(),
      }),
    ),
  );
  expect(choices().map((item) => [item.textContent, item.disabled])).toEqual([
    ["Keep this", false],
    ["Keep other", true],
    ["Keep both", true],
  ]);
  // A plain sync that ends flagged with a divergence leaves the question open.
  resetSessionsStore([flagged]);
  const onRefresh = vi.fn(async () => false);
  act(() => root.render(createElement(AdoptedSessionNotice, { session, onRefresh })));
  await act(async () => button().click());
  expect(onRefresh).toHaveBeenCalledOnce();
  expect(container.textContent).not.toContain("Conversation synced.");
});
