// @vitest-environment happy-dom
import { act, createElement, useContext, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RetainedSocialPanel } from "./RetainedSocialPanel";
import { SocialFeedbackContext } from "./socialContext";

it("freezes hidden props/context and restores local forms with the current callback on activation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  const rendered = vi.fn(),
    oldAction = vi.fn(),
    newAction = vi.fn();
  function Form({ value, onSave }: { value: string; onSave: () => void }) {
    const [draft, setDraft] = useState("unsaved");
    const feedback = useContext(SocialFeedbackContext);
    rendered(value, feedback.notice);
    return createElement(
      "button",
      {
        onClick: () => {
          setDraft("retained");
          onSave();
        },
      },
      `${draft}:${value}:${feedback.notice}`,
    );
  }
  const render = (active: boolean, value: string, onSave: () => void) =>
    root.render(
      createElement(RetainedSocialPanel, {
        active,
        busy: false,
        error: "",
        notice: value,
        children: createElement(Form, { value, onSave }),
      }),
    );
  try {
    await act(async () => render(true, "one", oldAction));
    await act(async () => node.querySelector("button")!.click());
    await act(async () => render(false, "one", oldAction));
    const calls = rendered.mock.calls.length;
    await act(async () => render(false, "two", newAction));
    expect(rendered).toHaveBeenCalledTimes(calls);
    expect(node.textContent).toBe("retained:one:one");
    await act(async () => render(true, "two", newAction));
    expect(node.textContent).toBe("retained:two:two");
    await act(async () => node.querySelector("button")!.click());
    expect(oldAction).toHaveBeenCalledTimes(1);
    expect(newAction).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    node.remove();
    vi.unstubAllGlobals();
  }
});
