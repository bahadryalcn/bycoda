// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { AddRemoteProjectDialog } from "./AddRemoteProjectDialog";
import { remoteProjectFor } from "../model/remoteProjects";
import { isLocalProject, looksLikeProject } from "../../projects/model/recents";
import { notifyRemoteRecovered } from "../model/remoteHealth";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

let root: Root;
let container: HTMLDivElement;
let machines: unknown[];
const opened: string[] = [];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  opened.length = 0;
  machines = [
    {
      id: "machine",
      name: "Home server",
      endpoint: "ssh://home",
      environmentId: "env",
    },
  ];
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command, input) => {
    if (command === "remote_machines") return machines;
    const { method, params } = input as {
      method: string;
      params: { path?: string; cwd?: string };
    };
    if (method === "projects.browse" && params.path === "/home/me/code/app")
      return {
        path: "/home/me/code/app",
        parent: "/home/me/code",
        entries: [],
      };
    if (method === "projects.browse")
      return params.path === "/home/me/code"
        ? {
            path: "/home/me/code",
            parent: "/home/me",
            entries: [{ name: "app", path: "/home/me/code/app" }],
          }
        : {
            path: "/home/me",
            parent: "/home",
            entries: [{ name: "code", path: "/home/me/code" }],
          };
    if (method === "projects.open") return { id: "host-project", cwd: params.cwd, name: "app" };
    throw new Error(`Unexpected ${method}`);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  localStorage.clear();
});

it.each(["online", "recovered"])(
  "recovers a folder listing on %s without replacing a typed path or opening a project",
  async (event) => {
    const original = vi.mocked(invoke).getMockImplementation()!;
    let offline = true;
    vi.mocked(invoke).mockImplementation(async (command, input) => {
      if (offline && (input as { method?: string } | undefined)?.method === "projects.browse")
        throw new Error("Machine is unreachable");
      return original(command, input);
    });
    await render();
    expect(document.body.textContent).toContain("Data has not been verified");
    const input = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="Folder path on the machine"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "/my/unsaved/path",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    offline = false;
    await act(async () => {
      if (event === "online") window.dispatchEvent(new Event("online"));
      else notifyRemoteRecovered("env");
    });
    expect(document.body.textContent).not.toContain("Data has not been verified");
    expect(input.value).toBe("/my/unsaved/path");
    expect(opened).toEqual([]);
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(
          (call) => (call[1] as { method?: string } | undefined)?.method === "projects.open",
        ),
    ).toHaveLength(0);
  },
);

async function render(onCancel = vi.fn()) {
  // The app runs in StrictMode, which remounts components in development.
  await act(async () =>
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(AddRemoteProjectDialog, {
          onCancel,
          onOpen: (key: string) => opened.push(key),
        }),
      ),
    ),
  );
  for (let i = 0; i < 4; i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

it("Escape yalnız üst overlay'i kapatır, uzaktaki proje penceresine sızmaz", async () => {
  const cancel = vi.fn();
  await render(cancel);
  const { Modal } = await import("../../../shared/ui/Modal");
  const childHost = document.createElement("div");
  document.body.append(childHost);
  const childRoot = createRoot(childHost);
  const childCancel = vi.fn();
  try {
    await act(async () =>
      childRoot.render(
        createElement(Modal, { title: "Top", onClose: childCancel, children: "top" }),
      ),
    );
    act(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      ),
    );
    expect(childCancel).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  } finally {
    act(() => childRoot.unmount());
    childHost.remove();
  }
  act(() =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    ),
  );
  expect(cancel).toHaveBeenCalledTimes(1);
});
const button = (text: string) =>
  [...document.body.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text),
  )!;

it("browses a machine's folders and adds the chosen one as a project", async () => {
  await render();
  await act(async () => button("code").click());
  await act(async () => button("app").click());
  const path = document.body.querySelector<HTMLInputElement>(
    'input[aria-label="Folder path on the machine"]',
  )!;
  expect(path.value).toBe("/home/me/code/app");
  expect(path.getAttribute("spellcheck")).toBe("false");
  await act(async () => button("Open").click());
  expect(opened).toEqual(["remote://env/home/me/code/app"]);
  expect(remoteProjectFor(opened[0])).toEqual({
    key: "remote://env/home/me/code/app",
    environmentId: "env",
    projectId: "host-project",
    cwd: "/home/me/code/app",
  });
  // It is a rail project, but never a folder on this computer.
  expect(looksLikeProject(opened[0])).toBe(true);
  expect(isLocalProject(opened[0])).toBe(false);
});

it("uzak makinede yeni klasör oluşturur ve açılacak yolu günceller", async () => {
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, input) => {
    const request = input as { method?: string; params?: { path?: string; name?: string } };
    if (request?.method === "projects.createDirectory") {
      expect(request.params).toEqual({ path: "/home/me", name: "Yeni proje" });
      return { path: "/home/me/Yeni proje", parent: "/home/me", entries: [] };
    }
    return original(command, input);
  });
  await render();
  await act(async () => button("New folder").click());
  const input = document.body.querySelector<HTMLInputElement>(
    'input[aria-label="New folder name"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Yeni proje",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("Create").click());
  expect(
    document.body.querySelector<HTMLInputElement>('input[aria-label="Folder path on the machine"]')
      ?.value,
  ).toBe("/home/me/Yeni proje");
});

it("points to Settings when no machine is connected", async () => {
  machines = [];
  await render();
  expect(document.body.textContent).toContain("No machines are connected yet");
  expect(button("Add a machine")).toBeTruthy();
});

it("retains the old folder during failed navigation and retries the requested folder before allowing Open", async () => {
  const original = vi.mocked(invoke).getMockImplementation()!;
  let fail!: (error: unknown) => void;
  let first = true;
  vi.mocked(invoke).mockImplementation((command, input) => {
    const request = input as { method?: string; params?: { path?: string } } | undefined;
    if (
      first &&
      request?.method === "projects.browse" &&
      request.params?.path === "/home/me/code"
    ) {
      first = false;
      return new Promise((_resolve, reject) => {
        fail = reject;
      });
    }
    return original(command, input);
  });
  await render();
  await act(async () => button("code").click());
  expect(document.body.textContent).toContain("Refreshing folders");
  expect((button("Open") as HTMLButtonElement).disabled).toBe(true);
  await act(async () => fail(new Error("Permission denied")));
  expect(document.body.textContent).toContain("Permission denied");
  expect(document.body.textContent).toContain("Showing last loaded folder: /home/me");
  expect((button("Open") as HTMLButtonElement).disabled).toBe(true);
  await act(async () =>
    (document.querySelector('button[aria-label^="Retry loading"]') as HTMLButtonElement).click(),
  );
  expect(
    document.body.querySelector<HTMLInputElement>('input[aria-label="Folder path on the machine"]')
      ?.value,
  ).toBe("/home/me/code");
  expect((button("Open") as HTMLButtonElement).disabled).toBe(false);
  expect(document.body.textContent).not.toContain("Permission denied");
});

it("does not present an unreadable machine registry as a successful empty result", async () => {
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((command, input) =>
    command === "remote_machines"
      ? Promise.reject(new Error("Registry unavailable"))
      : original(command, input),
  );
  await render();
  expect(document.body.textContent).toContain("Registry unavailable");
  expect(document.body.textContent).not.toContain("No machines are connected yet");
  vi.mocked(invoke).mockImplementation(original);
  await act(async () =>
    (document.querySelector('button[aria-label^="Retry loading"]') as HTMLButtonElement).click(),
  );
  expect(document.body.textContent).not.toContain("Registry unavailable");
  expect(button("code")).toBeTruthy();
});

it("ignores an older machine-list failure after a newer read succeeds", async () => {
  await render();
  const reads: { resolve: (value: unknown) => void; reject: (error: unknown) => void }[] = [];
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((command, input) =>
    command === "remote_machines"
      ? new Promise((resolve, reject) => reads.push({ resolve, reject }))
      : original(command, input),
  );
  await act(async () => {
    window.dispatchEvent(new Event("bycoda:remote-machines"));
    window.dispatchEvent(new Event("bycoda:remote-machines"));
  });
  expect(reads).toHaveLength(2);
  await act(async () => reads[1].resolve([]));
  await act(async () => reads[0].reject(new Error("Old read failed")));
  expect(document.body.textContent).toContain("No machines are connected yet");
  expect(document.body.textContent).not.toContain("Old read failed");
});

it("ignores a project that finishes opening after cancellation", async () => {
  const original = vi.mocked(invoke).getMockImplementation()!;
  let finish!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation((command, input) => {
    if ((input as { method?: string } | undefined)?.method === "projects.open")
      return new Promise((resolve) => {
        finish = resolve;
      });
    return original(command, input);
  });
  await render();
  await act(async () => button("Open").click());
  await act(async () => button("Cancel").click());
  await act(async () => finish({ id: "late", cwd: "/home/me", name: "me" }));
  expect(opened).toEqual([]);
});

it("keeps a pending remote Open bound to its original machine and prevents duplicate submission", async () => {
  machines.push({
    id: "second",
    name: "Second server",
    endpoint: "ssh://second",
    environmentId: "second-env",
  });
  const original = vi.mocked(invoke).getMockImplementation()!;
  let finish!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation((command, input) => {
    if ((input as { method?: string } | undefined)?.method === "projects.open")
      return new Promise((resolve) => {
        finish = resolve;
      });
    return original(command, input);
  });
  await render();
  const form = document.body.querySelector("form")!;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  const picker = document.body.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
  expect(picker.disabled).toBe(true);
  expect(button("Opening…").getAttribute("aria-busy")).toBe("true");
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter((call) => (call[1] as { method?: string })?.method === "projects.open"),
  ).toHaveLength(1);
  await act(async () => finish({ id: "opened", cwd: "/home/me", name: "me" }));
  expect(opened).toHaveLength(1);
  expect(picker.disabled).toBe(false);
});
