// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { LiveSearchView } from "./LiveSearchView";
import { resetSessionsStore, setSessions } from "../../../features/sessions/model/sessionsStore";
import type { Session } from "../../../features/sessions/model/session";
import { NOTHING_LOCKED } from "../../../features/group-lock/model/lockState";

const rendered = vi.hoisted(() => vi.fn());
vi.mock("../surfaces/lazySurfaces", () => ({
  preloadToolSurface: vi.fn(),
  SearchView: (props: { sessions: Session[] }) => {
    rendered(props.sessions);
    return null;
  },
}));
it("keeps search stable during streamed prose and adopts its text when the turn settles", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetSessionsStore([
    {
      id: "one",
      cwd: "/p",
      blocks: [{ id: "a", role: "assistant", text: "a", streaming: true }],
    } as Session,
  ]);
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () =>
      root.render(
        createElement(LiveSearchView, { lockSnapshot: NOTHING_LOCKED } as ComponentProps<
          typeof LiveSearchView
        >),
      ),
    );
    rendered.mockClear();
    await act(async () =>
      setSessions((items) => [
        { ...items[0], blocks: [{ ...items[0].blocks[0], text: "ab" }] } as Session,
      ]),
    );
    expect(rendered).not.toHaveBeenCalled();
    await act(async () =>
      setSessions((items) => [
        { ...items[0], blocks: [{ ...items[0].blocks[0], streaming: false }] } as Session,
      ]),
    );
    expect(rendered).toHaveBeenCalledOnce();
    expect(rendered.mock.lastCall![0][0].blocks[0].text).toBe("ab");
  } finally {
    await act(async () => root.unmount());
    resetSessionsStore([]);
    vi.unstubAllGlobals();
  }
});
