// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SshJumpPolicyEditor } from "./SshJumpPolicyEditor";
import {
  emptySshJumpPolicyDraft,
  sshJumpPolicyDrafts,
  type SshJumpPolicyDraft,
} from "../model/sshJumpPolicies";

it("explicitly reorders and removes complete hop drafts and preserves hidden file references", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"),
    root = createRoot(host);
  let current: SshJumpPolicyDraft[] = [];
  function Harness() {
    const [value, setValue] = useState(
      sshJumpPolicyDrafts([
        {
          host: "first",
          user: "alice",
          port: 22,
          identityFile: "~/first key",
          knownHostsFile: "~/first trust",
        },
        { host: "second", user: "bob", port: 2222, certificateFile: "~/second cert" },
      ]),
    );
    current = value;
    return createElement(SshJumpPolicyEditor, { value, onChange: setValue });
  }
  try {
    await act(async () => root.render(createElement(Harness)));
    expect(host.querySelector("details")?.open).toBe(false);
    expect(host.textContent).toContain("Strict host-key verification is always enabled");
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Move up: 2"]')!.click(),
    );
    expect(current.map((h) => h.host)).toEqual(["second", "first"]);
    expect(current[0].certificateFile).toBe("~/second cert");
    expect(current[1].knownHostsFile).toBe("~/first trust");
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Remove jump host: 1"]')!.click(),
    );
    expect(current[0]).toMatchObject({
      host: "first",
      identityFile: "~/first key",
      knownHostsFile: "~/first trust",
    });
    const port = host.querySelector<HTMLInputElement>('[aria-label="Jump host 1: Port"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(port, "");
      port.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(current[0].port).toBe("");
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    const add = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Add jump host"),
    )!;
    await act(async () => add.click());
    expect(current).toHaveLength(2);
    expect(current[0].port).toBe("");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
it("honors controlled changes and eight-hop/disabled limits without callbacks on mount", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"),
    root = createRoot(host),
    change = vi.fn();
  const value = Array.from({ length: 8 }, () => ({
    ...emptySshJumpPolicyDraft(),
    host: "bastion",
  }));
  try {
    await act(async () =>
      root.render(createElement(SshJumpPolicyEditor, { value, onChange: change, disabled: true })),
    );
    expect(change).not.toHaveBeenCalled();
    expect([...host.querySelectorAll("button")].every((b) => b.disabled)).toBe(true);
    await act(async () =>
      root.render(createElement(SshJumpPolicyEditor, { value, onChange: change })),
    );
    expect(
      [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Add jump host"))
        ?.disabled,
    ).toBe(true);
    const next = [{ ...value[0], host: "external-change", certificateFile: "~/preserved cert" }];
    await act(async () =>
      root.render(createElement(SshJumpPolicyEditor, { value: next, onChange: change })),
    );
    expect(host.querySelector<HTMLInputElement>('[aria-label="Jump host 1: Host"]')!.value).toBe(
      "external-change",
    );
    expect(
      host.querySelector<HTMLInputElement>('[aria-label="Jump host 1: Certificate file"]')!.value,
    ).toBe("~/preserved cert");
    expect(change).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
