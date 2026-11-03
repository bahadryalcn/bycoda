// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useBoardDataState } from "./useTaskBoardOperations";

it("keeps the last verified time while a retained board refreshes or fails", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
  type Board = Parameters<typeof useBoardDataState>[0];
  let answer!: ReturnType<typeof useBoardDataState>;
  function Probe({ board }: { board: Board }) {
    const next = useBoardDataState(board);
    useLayoutEffect(() => {
      answer = next;
    });
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  const board = { hasTaskAnswer: true, pending: false, error: undefined, machines: [{}] } as Board;
  try {
    await act(async () => root.render(createElement(Probe, { board })));
    expect(answer.boardDataState.updatedAt).toBe(1_000);
    clock.mockReturnValue(2_000);
    await act(async () =>
      root.render(createElement(Probe, { board: { ...board, pending: true } })),
    );
    expect(answer.boardDataState).toMatchObject({ updatedAt: 1_000, phase: "refreshing" });
    clock.mockReturnValue(3_000);
    await act(async () =>
      root.render(createElement(Probe, { board: { ...board, error: "Offline" } })),
    );
    expect(answer.boardDataState).toMatchObject({ updatedAt: 1_000, phase: "stale" });
    clock.mockReturnValue(4_000);
    await act(async () => root.render(createElement(Probe, { board: { ...board } })));
    expect(answer.boardDataState.updatedAt).toBe(4_000);
  } finally {
    await act(async () => root.unmount());
    clock.mockRestore();
    vi.unstubAllGlobals();
  }
});
