// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import { registerAppConfirmHost, type AppConfirmRequest } from "../../shared/model/appConfirm";
import { SessionGroupListRow } from "./SessionFolderListRows";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.unstubAllGlobals();
});

const session = (id: string) => ({ id, title: id }) as SessionSummary;

function render(kind: "settled" | "pinned", sessions: SessionSummary[]) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  const onArchiveAll = vi.fn();
  const onDeleteAll = vi.fn();
  const entry =
    kind === "settled"
      ? ({ kind, collapsed: true, sessions } as const)
      : ({ kind, collapsed: true, sessions, folders: [] } as const);
  act(() =>
    root.render(
      createElement(
        "ul",
        null,
        createElement(SessionGroupListRow, {
          entry,
          virtual: {},
          expanded: false,
          busyIds: new Set(),
          doneIds: new Set(),
          approvalIds: new Set(),
          reminderColor: "",
          renderName: (name) => name,
          onToggle: () => undefined,
          onArchiveAll,
          onDeleteAll,
        }),
      ),
    ),
  );
  const header = container.querySelector<HTMLButtonElement>("[data-folder-row]")!;
  const openMenu = () =>
    act(() => {
      header.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 4, clientY: 4 }),
      );
    });
  const item = (label: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((entry) =>
      entry.textContent?.includes(label),
    );
  return { onArchiveAll, onDeleteAll, openMenu, item };
}

it("deletes every listed settled session through the delete owner", () => {
  const view = render("settled", [session("a"), session("b")]);
  view.openMenu();
  act(() => view.item("Delete all")!.click());
  expect(view.onDeleteAll).toHaveBeenCalledWith(["a", "b"]);
  expect(view.onArchiveAll).not.toHaveBeenCalled();
});

it("archives every listed settled session only after confirmation", async () => {
  const requests: AppConfirmRequest[] = [];
  let answer = false;
  cleanups.push(
    registerAppConfirmHost(async (request) => {
      requests.push(request);
      return answer;
    }),
  );
  const view = render("settled", [session("a"), session("b")]);
  view.openMenu();
  await act(async () => view.item("Archive all")!.click());
  expect(requests[0]).toMatchObject({ title: "Archive 2 settled sessions?", tone: "normal" });
  expect(view.onArchiveAll).not.toHaveBeenCalled();
  answer = true;
  view.openMenu();
  await act(async () => view.item("Archive all")!.click());
  expect(view.onArchiveAll).toHaveBeenCalledWith(["a", "b"]);
});

it("offers no bulk menu on other groups", () => {
  const view = render("pinned", [session("a")]);
  view.openMenu();
  expect(view.item("Delete all")).toBeUndefined();
  expect(view.item("Archive all")).toBeUndefined();
});
