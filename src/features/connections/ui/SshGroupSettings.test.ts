// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SshGroupSettings } from "./SshGroupSettings";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
import type { ServerRecord } from "../model/serverInventory";
import type { SshConfigurationPreview, SshGroupDefaults } from "../model/sshGroupDefaults";
const native = vi.hoisted(() => ({
  list: vi.fn(),
  preview: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  apply: vi.fn(),
}));
vi.mock("../model/sshGroupDefaults", async (importActual) => ({
  ...(await importActual<object>()),
  listSshGroupDefaults: native.list,
  previewSshConfiguration: native.preview,
  saveSshGroupDefaults: native.save,
  removeSshGroupDefaults: native.remove,
  setSshInheritance: native.apply,
}));
const group: SshGroupDefaults = {
  id: "group-1",
  revision: 4,
  name: "Production",
  defaults: { user: "group-user", port: 2222 },
  environment: [],
  shellKind: "posix",
};
const binding = { groupId: "group-1", fields: ["user" as const], environment: false };
const server: ServerRecord = {
  id: "server-1",
  name: "Server",
  kind: "ssh",
  sshEndpoint: { host: "server.invalid", user: "local-user", port: 22 },
  metadata: { tags: [], favorite: false, group: "legacy-label" },
};
function preview(inheritance: typeof binding | null): SshConfigurationPreview {
  return {
    connectionId: server.id,
    inheritance,
    configuration: {
      endpoint: {
        host: "server.invalid",
        user: inheritance ? "group-user" : "local-user",
        port: 22,
      },
      provenance: {
        user: {
          source: inheritance ? "group" : "connection",
          ...(inheritance ? { groupId: group.id, revision: 4 } : {}),
        },
        port: { source: "connection" },
      },
      environment: [],
      digest: "fresh-digest",
    },
  };
}
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  resetRetainedState();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  native.list.mockResolvedValue([group]);
  native.preview.mockResolvedValue(preview(binding));
  native.apply.mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((item) => item.textContent === text)!;
const render = () =>
  act(async () => root.render(createElement(SshGroupSettings, { server, onClose: vi.fn() })));
async function input(label: string, value: string) {
  const field = [...document.querySelectorAll("label")].find(
    (item) => item.textContent?.trim() === label,
  )!;
  const element = document.getElementById(field.htmlFor)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("loads saved inheritance read-only, requires an explicit fresh preview and applies only the reviewed digest", async () => {
  await render();
  expect(native.preview).toHaveBeenCalledExactlyOnceWith(server.id, null, true);
  expect(native.apply).not.toHaveBeenCalled();
  expect(button("Apply inheritance").disabled).toBe(true);
  await act(async () => button("Preview effective configuration").click());
  expect(native.preview).toHaveBeenLastCalledWith(server.id, binding, false);
  expect(document.body.textContent).toContain("group-user@server.invalid:22");
  expect(document.body.textContent).toContain("Production · r4");
  await act(async () => button("Apply inheritance").click());
  expect(native.apply).toHaveBeenCalledExactlyOnceWith(server.id, binding, binding, "fresh-digest");
  expect(button("Apply inheritance").disabled).toBe(true);
});
it("invalidates a preview after a checkbox edit and preserves selections after native CAS rejection", async () => {
  await render();
  await act(async () => button("Preview effective configuration").click());
  const label = [...document.querySelectorAll("label")].find(
    (item) => item.textContent?.trim() === "SSH port",
  )!;
  await act(async () => label.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(button("Apply inheritance").disabled).toBe(true);
  const changed = { ...binding, fields: ["user", "port"] };
  native.preview.mockResolvedValue(preview(changed as typeof binding));
  await act(async () => button("Preview effective configuration").click());
  native.apply.mockRejectedValue(new Error("configuration changed"));
  await act(async () => button("Apply inheritance").click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("configuration changed");
  expect(label.querySelector<HTMLInputElement>("input")!.checked).toBe(true);
  expect(native.apply).toHaveBeenCalledTimes(1);
});
it("preserves edited group drafts on save conflict and in-use deletion errors, without auto-binding", async () => {
  await render();
  await act(async () => button("Edit group").click());
  await input("Group name", "Owner draft");
  native.save.mockRejectedValue(new Error("revision conflict"));
  await act(async () => button("Save group").click());
  expect(native.save).toHaveBeenCalledWith(
    expect.objectContaining({ id: group.id, revision: 4, name: "Owner draft" }),
    4,
  );
  expect(document.querySelector<HTMLInputElement>('input[value="Owner draft"]')).not.toBeNull();
  expect(native.apply).not.toHaveBeenCalled();
  native.remove.mockRejectedValue(new Error("group in use"));
  await act(async () => button("Delete group").click());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 320)));
  await act(async () => button("Confirm delete").click());
  expect(native.remove).toHaveBeenCalledExactlyOnceWith(group.id, 4);
  expect(document.body.textContent).toContain("group in use");
  expect(button("Save group")).toBeTruthy();
});
it("never migrates a legacy display label and creates profiles only after explicit group save", async () => {
  native.preview.mockResolvedValue(preview(null));
  await render();
  expect(native.apply).not.toHaveBeenCalled();
  expect(native.save).not.toHaveBeenCalled();
  await act(async () => button("New group").click());
  await input("Group name", "New defaults");
  await input("Default SSH user", "new-user");
  native.save.mockImplementation(async (profile: SshGroupDefaults) => ({
    ...profile,
    revision: 1,
  }));
  await act(async () => button("Save group").click());
  expect(native.save).toHaveBeenCalledWith(
    expect.objectContaining({ revision: 0, name: "New defaults", defaults: { user: "new-user" } }),
    null,
  );
  expect(native.apply).not.toHaveBeenCalled();
  expect(native.preview).toHaveBeenCalledTimes(1);
});
it("ignores initial read replies after unmount without applying or losing retained drafts", async () => {
  let finish!: (value: SshGroupDefaults[]) => void;
  native.list.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  await act(async () => root.unmount());
  await act(async () => finish([group]));
  expect(native.apply).not.toHaveBeenCalled();
  expect(native.save).not.toHaveBeenCalled();
  root = createRoot(host);
});
