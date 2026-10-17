import { chooseSocialValue } from "./socialTestControls";
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HostProject, RemoteMachine } from "../../connections/model/protocol";
import { SocialAuthority } from "./SocialAuthority";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
let container: HTMLDivElement, root: Root;
const onSelect = vi.fn();
const machines: RemoteMachine[] = [
  {
    id: "local",
    name: "Bu bilgisayar",
    environmentId: "local-env",
    endpoint: "http://127.0.0.1:3774",
  },
  {
    id: "remote",
    name: "MacBook",
    environmentId: "remote-env",
    endpoint: "https://remote.test",
  },
  {
    id: "other",
    name: "Linux",
    environmentId: "other-env",
    endpoint: "https://other.test",
  },
];
const projects: HostProject[] = [{ id: "target-project", name: "Merkezi proje", cwd: "/project" }];
const localStatus = {
  environmentId: "local-env",
  sourceMachineId: "local",
  authority: null,
  projects: [{ id: "source-project", name: "Yerel proje" }],
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.invoke.mockReset().mockImplementation(async () => localStatus);
  onSelect.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function mount(
  selectedHost = "remote",
  list = machines,
  targetProjects = projects,
  skipRun = false,
) {
  await act(async () =>
    root.render(
      createElement(SocialAuthority, {
        machines: list,
        selectedHost,
        projects: targetProjects,
        onSelect,
        run: async (action: () => Promise<unknown>) => {
          if (skipRun) return false;
          try {
            await action();
            return true;
          } catch {
            return false;
          }
        },
      }),
    ),
  );
}
async function input(value: string) {
  const element = container.querySelector<HTMLInputElement>('input[type="url"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function map(value = "target-project") {
  await chooseSocialValue(
    container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!,
    value,
  );
}
async function save() {
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
it("shows loading, recoverable status failures and a retry action", async () => {
  let fail!: (error: Error) => void;
  mocks.invoke.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  await mount();
  expect(container.textContent).toContain("Host ayarı yükleniyor");
  await act(async () => fail(new Error("Host kapalı")));
  expect(container.textContent).toContain("Merkezi host ayarı okunamadı: Host kapalı");
  expect(container.querySelector("form")).toBeNull();
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelector("form")).not.toBeNull();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
it("does not reload status when only the machines array object changes", async () => {
  await mount();
  await mount(
    "remote",
    machines.map((machine) => ({ ...machine })),
  );
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});
it("validates explicit mappings and endpoint before changing authority", async () => {
  await mount();
  await input("https://local.test");
  await save();
  expect(container.textContent).toContain("En az bir projeyi");
  await map();
  for (const value of [
    "http://public.test",
    "https://user:password@local.test",
    "https://local.test/rpc",
    "https://local.test?secret=1",
  ]) {
    await input(value);
    await save();
    expect(container.textContent).toContain("HTTPS adresi kullanın");
  }
  expect(mocks.invoke).not.toHaveBeenCalledWith("social_authority_connect", expect.anything());
  await input(" https://local.test/ ");
  await save();
  expect(mocks.invoke).toHaveBeenCalledWith("social_authority_connect", {
    machineId: "remote",
    mapping: { "source-project": "target-project" },
    sourceEndpoint: "https://local.test",
  });
  expect(onSelect).toHaveBeenCalledWith("remote");
});
it("never reuses project mappings or endpoint values for another host", async () => {
  await mount();
  await input("https://local.test");
  await map();
  await mount("other");
  expect(container.querySelector('button[aria-haspopup="dialog"]')?.textContent).toContain(
    "Bu projeyi paylaşma",
  );
  expect(container.querySelector<HTMLInputElement>('input[type="url"]')!.value).toBe("");
  await save();
  expect(mocks.invoke).not.toHaveBeenCalledWith("social_authority_connect", expect.anything());
});
it("rejects stale mappings after a target project disappears", async () => {
  await mount();
  await input("https://local.test");
  await map();
  await mount("remote", machines, []);
  expect(container.querySelector('button[aria-haspopup="dialog"]')?.textContent).toContain(
    "Bu projeyi paylaşma",
  );
  expect(container.textContent).toContain("Bazı kayıtlı projeler artık bulunamıyor");
  await save();
  expect(mocks.invoke).not.toHaveBeenCalledWith("social_authority_connect", expect.anything());
});
it("blocks duplicate authority changes and avoids a late selection after the user changes host", async () => {
  let finish!: () => void;
  mocks.invoke.mockImplementation((command: string) =>
    command === "social_authority_connect"
      ? new Promise<void>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(localStatus),
  );
  await mount();
  await input("https://local.test");
  await map();
  await save();
  await save();
  expect(
    mocks.invoke.mock.calls.filter(([command]) => command === "social_authority_connect"),
  ).toHaveLength(1);
  await mount("other");
  await act(async () => finish());
  expect(onSelect).not.toHaveBeenCalled();
});
it("retains the form after a connect failure and allows retry", async () => {
  mocks.invoke.mockImplementation((command: string) =>
    command === "social_authority_connect"
      ? Promise.reject(new Error("Host erişilemiyor"))
      : Promise.resolve(localStatus),
  );
  await mount();
  await input("https://local.test");
  await map();
  await save();
  expect(container.textContent).toContain("Host ayarı değiştirilemedi: Host erişilemiyor");
  expect(container.querySelector<HTMLInputElement>('input[type="url"]')!.value).toBe(
    "https://local.test",
  );
  mocks.invoke.mockImplementation(async () => localStatus);
  await save();
  expect(container.textContent).toContain("Merkezi host kaydedildi");
});
it("resets to the local host through an explicit action and does not enable sending", async () => {
  mocks.invoke.mockImplementation(async () => ({
    ...localStatus,
    authorityMachineId: "remote",
    authority: {
      environmentId: "remote-env",
      mapping: { "source-project": "target-project" },
    },
  }));
  await mount("local");
  const reset = Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.startsWith("Yerel host'a dön"),
  )!;
  await act(async () => reset.click());
  expect(mocks.invoke).toHaveBeenCalledWith("social_authority_connect", {
    machineId: null,
    mapping: {},
    sourceEndpoint: null,
  });
  expect(onSelect).toHaveBeenCalledWith("local");
  expect(container.textContent).toContain("Gönderimler durdurulmuş durumda");
});
it("does not claim authority changed when the parent skips a busy operation", async () => {
  await mount("remote", machines, projects, true);
  await input("https://local.test");
  await map();
  await save();
  expect(mocks.invoke).not.toHaveBeenCalledWith("social_authority_connect", expect.anything());
  expect(container.textContent).toContain("Başka bir işlem sürüyor");
  expect(container.textContent).not.toContain("Merkezi host kaydedildi");
});
