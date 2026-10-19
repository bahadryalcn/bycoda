// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { SshSettings } from "./SshSettings";
import type { ServerRecord } from "../model/serverInventory";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("./ServersTerminalWorkspace", () => ({ useGenerateSshKey: () => undefined }));
let root: Root;
let container: HTMLDivElement;
const server: ServerRecord = {
  id: "saved-target",
  name: "Production",
  kind: "ssh",
  sshEndpoint: { host: "production.invalid", port: 22 },
  metadata: { tags: [], favorite: false },
};
const key = { identityFile: "C:/keys/work", keyType: "ssh-ed25519", fingerprint: "SHA256:public" };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  native.invoke.mockImplementation(async (command: string) => {
    if (command === "ssh_public_keys_list") return [key];
    if (command === "ssh_agent_identities") throw new Error("Agent unavailable");
    if (command === "server_ssh_identity_set")
      return { ...server, sshEndpoint: { ...server.sshEndpoint, identityFile: key.identityFile } };
    return [];
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("keeps discovered keys usable when the agent inventory fails and assigns once without connecting", async () => {
  const assigned = vi.fn();
  await act(async () =>
    root.render(
      createElement(SshSettings, {
        server,
        servers: [server],
        onClose: vi.fn(),
        onAssigned: assigned,
      }),
    ),
  );
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Some SSH information");
  const choose = document.querySelector<HTMLButtonElement>('button[aria-label^="Assign key:"]')!;
  expect(choose.disabled).toBe(false);
  await act(async () => {
    choose.click();
    choose.click();
  });
  expect(
    native.invoke.mock.calls.filter(([command]) => command === "server_ssh_identity_set"),
  ).toEqual([["server_ssh_identity_set", { id: server.id, identityFile: key.identityFile }]]);
  expect(assigned).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: server.id }));
  expect(native.invoke.mock.calls.some(([command]) => command === "ssh_terminal_spawn")).toBe(
    false,
  );
});
it("opens global SSH management with an empty inventory and preserves config text between sections", async () => {
  await act(async () => root.render(createElement(SshSettings, { servers: [], onClose: vi.fn() })));
  expect(document.querySelector('button[aria-label^="Assign key:"]')).toBeNull();
  const find = (name: string) =>
    [...document.querySelectorAll("button")].find((button) => button.textContent === name)!;
  await act(async () => find("Import SSH config").click());
  const input = document.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      "Host work\n HostName work.invalid",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => find("Keys").click());
  await act(async () => find("Import SSH config").click());
  expect(input.value).toContain("work.invalid");
  expect(
    native.invoke.mock.calls.some(
      ([command]) => command === "ssh_config_preview" || command === "server_ssh_save",
    ),
  ).toBe(false);
});
