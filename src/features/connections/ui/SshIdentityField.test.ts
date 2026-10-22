// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SshIdentityField } from "./SshIdentityField";

const native = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: native.open }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  native.invoke.mockResolvedValue([]);
  native.open.mockResolvedValue(null);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const browse = () =>
  container.querySelector<HTMLButtonElement>('button[aria-label^="Choose key file…:"]')!;

it("selects an unrestricted single private-key path without reading, saving or connecting", async () => {
  const changed = vi.fn();
  native.open.mockResolvedValue("C:/User keys/custom key.pem");
  await act(async () =>
    root.render(createElement(SshIdentityField, { value: "C:/keys/previous", onChange: changed })),
  );
  await act(async () => browse().click());
  expect(native.open).toHaveBeenCalledExactlyOnceWith({
    title: "Choose private SSH key",
    multiple: false,
    directory: false,
    defaultPath: "C:/keys/previous",
  });
  expect(changed).toHaveBeenCalledExactlyOnceWith("C:/User keys/custom key.pem");
  expect(native.invoke.mock.calls.map(([command]) => command)).toEqual(["ssh_public_keys_list"]);
});

it("keeps the existing selection when the native picker is cancelled", async () => {
  const changed = vi.fn();
  await act(async () =>
    root.render(createElement(SshIdentityField, { value: "~/.ssh/work", onChange: changed })),
  );
  await act(async () => browse().click());
  expect(changed).not.toHaveBeenCalled();
  expect(native.open).toHaveBeenCalledExactlyOnceWith({
    title: "Choose private SSH key",
    multiple: false,
    directory: false,
  });
  expect(
    container.querySelector<HTMLInputElement>('input[aria-label="Identity file"]')?.value,
  ).toBe("~/.ssh/work");
});

it("offers file selection when key discovery fails and exposes a recoverable picker error", async () => {
  native.invoke.mockRejectedValue(new Error("inventory unavailable"));
  native.open.mockRejectedValue(new Error("picker unavailable"));
  const changed = vi.fn();
  await act(async () =>
    root.render(createElement(SshIdentityField, { value: "", onChange: changed })),
  );
  expect(browse().disabled).toBe(false);
  await act(async () => browse().click());
  expect(container.textContent).toContain(
    "Could not open the file picker. Enter a key path or try again.",
  );
  expect(
    container.querySelector<HTMLInputElement>('input[aria-label="Identity file"]')?.disabled,
  ).toBe(false);
  expect(changed).not.toHaveBeenCalled();
  native.open.mockResolvedValue("/Users/test/.ssh/id_ed25519");
  await act(async () => browse().click());
  expect(changed).toHaveBeenCalledExactlyOnceWith("/Users/test/.ssh/id_ed25519");
  expect(container.textContent).not.toContain("Could not open the file picker.");
});

it("blocks duplicate pickers and ignores a selection after the owning field closes", async () => {
  let finish!: (path: string) => void;
  native.open.mockReturnValue(
    new Promise<string>((resolve) => {
      finish = resolve;
    }),
  );
  const changed = vi.fn();
  await act(async () =>
    root.render(createElement(SshIdentityField, { value: "", onChange: changed })),
  );
  await act(async () => {
    browse().click();
    browse().click();
  });
  expect(native.open).toHaveBeenCalledTimes(1);
  await act(async () => root.render(null));
  await act(async () => finish("/Users/test/.ssh/work"));
  expect(changed).not.toHaveBeenCalled();
});

it("distinguishes same-name keys by path and clears only the draft when returning to SSH defaults", async () => {
  const changed = vi.fn();
  const keys = ["C:/team/id_ed25519", "C:/archive/id_ed25519"].map((identityFile) => ({
    identityFile,
    keyType: "ssh-ed25519",
    fingerprint: "SHA256:public",
  }));
  native.invoke.mockResolvedValue(keys);
  await act(async () =>
    root.render(createElement(SshIdentityField, { value: "", onChange: changed })),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label^="Choose SSH key:"]')!.click(),
  );
  const search = document.querySelector<HTMLInputElement>('input[placeholder="Search SSH keys…"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      search,
      "/archive/",
    );
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const options = document.querySelectorAll<HTMLButtonElement>('[role="option"]');
  expect(options).toHaveLength(1);
  expect(options[0].textContent).toContain("C:/archive/id_ed25519");
  await act(async () => options[0].click());
  expect(changed).toHaveBeenCalledExactlyOnceWith("C:/archive/id_ed25519");
  await act(async () =>
    root.render(
      createElement(SshIdentityField, { value: "C:/archive/id_ed25519", onChange: changed }),
    ),
  );
  expect(
    container.querySelector('button[aria-label^="Choose SSH key:"]')?.getAttribute("aria-label"),
  ).toBe("Choose SSH key: id_ed25519");
  expect(container.textContent).toContain("C:/archive/id_ed25519");
  expect(container.textContent).toContain("SHA256:public");
  await act(async () =>
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Use SSH defaults")!
      .click(),
  );
  expect(changed).toHaveBeenLastCalledWith("");
  expect(native.open).not.toHaveBeenCalled();
  expect(native.invoke.mock.calls.map(([command]) => command)).toEqual(["ssh_public_keys_list"]);
});

it("refreshes discovered keys without changing the selected draft", async () => {
  const changed = vi.fn();
  await act(async () =>
    root.render(createElement(SshIdentityField, { value: "C:/custom/work", onChange: changed })),
  );
  native.invoke.mockResolvedValue([
    { identityFile: "C:/new/deployment", keyType: "ssh-ed25519", fingerprint: "SHA256:new" },
  ]);
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label^="Refresh SSH keys:"]')!.click(),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>('button[aria-label^="Choose SSH key:"]')!.click(),
  );
  expect(document.querySelector('[role="option"][data-value="C:/new/deployment"]')).toBeTruthy();
  expect(document.querySelector('[role="option"][data-value="C:/custom/work"]')).toBeTruthy();
  expect(changed).not.toHaveBeenCalled();
  expect(native.invoke).toHaveBeenCalledTimes(2);
});
