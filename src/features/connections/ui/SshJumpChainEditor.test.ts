// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SshJumpChainEditor } from "./SshJumpChainEditor";
it("reorders and removes hop references explicitly without changing their contents", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  function Form() {
    const [value, setValue] = useState(["alice@first:22", "bob@second:2222"]);
    return createElement(SshJumpChainEditor, { value, onChange: setValue });
  }
  try {
    await act(async () => root.render(createElement(Form)));
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Move up: 2"]')!.click(),
    );
    expect([...container.querySelectorAll("input")].map((field) => field.value)).toEqual([
      "bob@second:2222",
      "alice@first:22",
    ]);
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="Remove jump host: 1"]')!.click(),
    );
    expect([...container.querySelectorAll("input")].map((field) => field.value)).toEqual([
      "alice@first:22",
    ]);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
