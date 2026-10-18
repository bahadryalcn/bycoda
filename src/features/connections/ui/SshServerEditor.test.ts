// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SshServerEditor } from "./SshServerEditor";
import { resetRetainedState } from "../../../shared/hooks/useRetainedState";
import { saveSshConnection, type ServerRecord } from "../model/serverInventory";
vi.mock("../model/serverInventory", () => ({ saveSshConnection: vi.fn() }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  resetRetainedState();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const legacy: ServerRecord = {
  id: "stable-existing",
  name: "Host",
  kind: "ssh",
  sshEndpoint: {
    host: "destination.invalid",
    user: "alice",
    port: 2222,
    jumpHost: "legacy@bastion:22",
  },
  metadata: { tags: [], favorite: false },
};
async function input(label: string, value: string) {
  const element = [...document.querySelectorAll("label")].find(
    (labelElement) => labelElement.textContent?.replace("*", "").trim() === label,
  )!;
  expect(element).toBeTruthy();
  const field = document.getElementById(element.htmlFor) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("migrates a legacy jump only on explicit save and preserves ID with public certificate references", async () => {
  vi.mocked(saveSshConnection).mockResolvedValue(legacy);
  await act(async () =>
    root.render(
      createElement(SshServerEditor, { server: legacy, onClose: vi.fn(), onSaved: vi.fn() }),
    ),
  );
  expect(saveSshConnection).not.toHaveBeenCalled();
  expect(
    [...document.querySelectorAll("input")].some((field) => field.value === "legacy@bastion:22"),
  ).toBe(true);
  await input("Public SSH certificate file", "C:/keys/public-certificate");
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Add jump host"))!
      .click(),
  );
  await input("Jump host 2", "operator@second:2200");
  await act(async () =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(saveSshConnection).toHaveBeenCalledWith({
    id: "stable-existing",
    name: "Host",
    endpoint: {
      host: "destination.invalid",
      user: "alice",
      port: 2222,
      identityFile: undefined,
      jumpHost: undefined,
      jumpHosts: ["legacy@bastion:22", "operator@second:2200"],
      certificateFile: "C:/keys/public-certificate",
    },
  });
  expect(legacy.sshEndpoint?.jumpHost).toBe("legacy@bastion:22");
  expect(document.querySelector('input[type="password"]')).toBeNull();
});
it("does not save an incomplete route or certificate reference containing controls", async () => {
  await act(async () =>
    root.render(createElement(SshServerEditor, { server: legacy, onClose: vi.fn() })),
  );
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Add jump host"))!
      .click(),
  );
  await act(async () =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(saveSshConnection).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("valid SSH endpoint");
});

const policyServer: ServerRecord = {
  ...legacy,
  id: "stable-policy-server",
  sshEndpoint: {
    ...legacy.sshEndpoint!,
    jumpHost: undefined,
    identityFile: "target key",
    certificateFile: "target cert.pub",
    jumpPolicies: [
      {
        host: "first",
        user: "operator",
        port: 2222,
        identityFile: "~/first key",
        certificateFile: "~/first cert.pub",
        knownHostsFile: "~/first trust",
      },
      { host: "second", port: 22, knownHostsFile: "~/second trust" },
    ],
  },
};
async function submit() {
  await act(async () =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
async function setAriaInput(name: string, value: string) {
  const field = document.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("preserves canonical policy IDs and every hop reference through explicit save", async () => {
  vi.mocked(saveSshConnection).mockResolvedValue(policyServer);
  const saved = vi.fn();
  await act(async () =>
    root.render(
      createElement(SshServerEditor, { server: policyServer, onClose: vi.fn(), onSaved: saved }),
    ),
  );
  expect(
    document
      .querySelector('[role="switch"][aria-label="Per-hop SSH policy"]')
      ?.getAttribute("aria-checked"),
  ).toBe("true");
  expect(saveSshConnection).not.toHaveBeenCalled();
  await submit();
  expect(saveSshConnection).toHaveBeenCalledWith({
    id: policyServer.id,
    name: policyServer.name,
    endpoint: { ...policyServer.sshEndpoint, jumpHost: undefined },
  });
  expect(saved).toHaveBeenCalledExactlyOnceWith(policyServer);
});
it("keeps independent legacy and per-hop drafts when the mode is switched both ways", async () => {
  await act(async () =>
    root.render(createElement(SshServerEditor, { server: legacy, onClose: vi.fn() })),
  );
  const toggle = () =>
    document.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Per-hop SSH policy"]')!;
  await act(async () => toggle().click());
  expect(
    document.querySelector<HTMLInputElement>('input[aria-label="Jump host 1: Host"]')!.value,
  ).toBe("");
  await setAriaInput("Jump host 1: Host", "typed-bastion");
  await setAriaInput("Jump host 1: Identity file", "~/typed key reference");
  await act(async () => toggle().click());
  expect(
    [...document.querySelectorAll("input")].some((field) => field.value === "legacy@bastion:22"),
  ).toBe(true);
  await input("Jump host", "edited@legacy:2222");
  await act(async () => toggle().click());
  expect(
    document.querySelector<HTMLInputElement>('input[aria-label="Jump host 1: Host"]')!.value,
  ).toBe("typed-bastion");
  expect(
    document.querySelector<HTMLInputElement>('input[aria-label="Jump host 1: Identity file"]')!
      .value,
  ).toBe("~/typed key reference");
  vi.mocked(saveSshConnection).mockResolvedValue(legacy);
  await submit();
  expect(vi.mocked(saveSshConnection).mock.calls[0][0].endpoint).toMatchObject({
    jumpPolicies: [{ host: "typed-bastion", port: 22, identityFile: "~/typed key reference" }],
  });
  expect(vi.mocked(saveSshConnection).mock.calls[0][0].endpoint.jumpHosts).toBeUndefined();
  await act(async () => toggle().click());
  await submit();
  expect(vi.mocked(saveSshConnection).mock.calls[1][0].endpoint.jumpHosts).toEqual([
    "edited@legacy:2222",
  ]);
  expect(vi.mocked(saveSshConnection).mock.calls[1][0].endpoint.jumpPolicies).toBeUndefined();
});
it("blocks invalid hop save and quick connect without overwriting drafts", async () => {
  const connect = vi.fn();
  await act(async () =>
    root.render(
      createElement(SshServerEditor, {
        server: policyServer,
        onClose: vi.fn(),
        onConnect: connect,
      }),
    ),
  );
  await setAriaInput("Jump host 1: Port", "");
  await submit();
  expect(saveSshConnection).not.toHaveBeenCalled();
  expect(connect).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("valid SSH endpoint");
  expect(
    document.querySelector<HTMLInputElement>('input[aria-label="Jump host 1: Port"]')!.value,
  ).toBe("");
  await setAriaInput("Jump host 1: Port", "2200");
  await submit();
  expect(connect).toHaveBeenCalledTimes(1);
  expect(connect.mock.calls[0][0].jumpPolicies[0]).toMatchObject({
    port: 2200,
    identityFile: "~/first key",
    knownHostsFile: "~/first trust",
  });
  expect(saveSshConnection).not.toHaveBeenCalled();
});

const proxyServer: ServerRecord = {
  ...legacy,
  id: "stable-proxy-server",
  sshEndpoint: {
    host: "target.invalid",
    port: 22,
    httpProxy: { host: "proxy.invalid", port: 8080 },
  },
};
const toggleProxy = () =>
  document.querySelector<HTMLButtonElement>('[role="switch"][aria-label="HTTP CONNECT upstream"]')!;
it("roundtrips a saved HTTP CONNECT profile and retains its draft across explicit disable/enable", async () => {
  vi.mocked(saveSshConnection).mockResolvedValue(proxyServer);
  await act(async () =>
    root.render(createElement(SshServerEditor, { server: proxyServer, onClose: vi.fn() })),
  );
  expect(toggleProxy().getAttribute("aria-checked")).toBe("true");
  expect(saveSshConnection).not.toHaveBeenCalled();
  await submit();
  expect(vi.mocked(saveSshConnection).mock.calls[0][0].endpoint.httpProxy).toEqual({
    host: "proxy.invalid",
    port: 8080,
  });
  expect(vi.mocked(saveSshConnection).mock.calls[0][0].id).toBe(proxyServer.id);
  await input("Proxy host", "edited-proxy.invalid");
  await input("Proxy port", "3128");
  await act(async () => toggleProxy().click());
  await submit();
  expect(vi.mocked(saveSshConnection).mock.calls[1][0].endpoint.httpProxy).toBeUndefined();
  await act(async () => toggleProxy().click());
  await submit();
  expect(vi.mocked(saveSshConnection).mock.calls[2][0].endpoint.httpProxy).toEqual({
    host: "edited-proxy.invalid",
    port: 3128,
  });
  expect(document.querySelector('input[type="password"]')).toBeNull();
  expect(document.body.textContent).toContain("Basic credentials require separate approval");
});
it("retains HTTPS transport across editing and explicitly returns to legacy HTTP", async () => {
  const secure = {
    ...proxyServer,
    sshEndpoint: {
      ...proxyServer.sshEndpoint!,
      httpProxy: { host: "proxy.invalid", port: 443, scheme: "https" as const },
    },
  };
  vi.mocked(saveSshConnection).mockResolvedValue(secure);
  await act(async () =>
    root.render(createElement(SshServerEditor, { server: secure, onClose: vi.fn() })),
  );
  const choice = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (button) => button.textContent === label,
    )!;
  expect(choice("HTTPS").getAttribute("aria-checked")).toBe("true");
  await input("Proxy host", "secure-proxy.invalid");
  await submit();
  expect(vi.mocked(saveSshConnection).mock.calls[0][0].endpoint.httpProxy).toEqual({
    host: "secure-proxy.invalid",
    port: 443,
    scheme: "https",
  });
  await act(async () => choice("HTTP").click());
  await submit();
  expect(vi.mocked(saveSshConnection).mock.calls[1][0].endpoint.httpProxy).toEqual({
    host: "secure-proxy.invalid",
    port: 443,
  });
});
it("rejects mixed HTTP/jump routes until the owner explicitly chooses one without erasing either draft", async () => {
  await act(async () =>
    root.render(createElement(SshServerEditor, { server: legacy, onClose: vi.fn() })),
  );
  await act(async () => toggleProxy().click());
  await input("Proxy host", "proxy.invalid");
  await submit();
  expect(saveSshConnection).not.toHaveBeenCalled();
  expect(document.querySelector('[role="status"]')?.textContent).toContain(
    "Choose either an HTTP proxy or a jump chain",
  );
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Remove jump host: 1"]')!.click(),
  );
  vi.mocked(saveSshConnection).mockResolvedValue(legacy);
  await submit();
  expect(vi.mocked(saveSshConnection).mock.calls[0][0].endpoint.httpProxy?.host).toBe(
    "proxy.invalid",
  );
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('[role="switch"][aria-label="Per-hop SSH policy"]')!
      .click(),
  );
  await setAriaInput("Jump host 1: Host", "typed-hop.invalid");
  await submit();
  expect(saveSshConnection).toHaveBeenCalledTimes(1);
  await act(async () => toggleProxy().click());
  await submit();
  expect(vi.mocked(saveSshConnection).mock.calls[1][0].endpoint.jumpPolicies).toEqual([
    { host: "typed-hop.invalid", port: 22 },
  ]);
  await act(async () => toggleProxy().click());
  expect(
    document.querySelector<HTMLInputElement>('input[aria-label="Jump host 1: Host"]')!.value,
  ).toBe("typed-hop.invalid");
});
it("blocks incomplete or nonliteral proxy ports before quick connect", async () => {
  const connect = vi.fn();
  await act(async () =>
    root.render(
      createElement(SshServerEditor, { server: proxyServer, onClose: vi.fn(), onConnect: connect }),
    ),
  );
  for (const port of ["", "0", "65536", "1e2", "22.5"]) {
    await input("Proxy port", port);
    await submit();
    expect(connect).not.toHaveBeenCalled();
  }
  await input("Proxy port", "3128");
  await submit();
  expect(connect).toHaveBeenCalledTimes(1);
  expect(connect.mock.calls[0][0].httpProxy).toEqual({ host: "proxy.invalid", port: 3128 });
  expect(saveSshConnection).not.toHaveBeenCalled();
});

it("rejects proxy URLs, userinfo and invalid host labels while accepting a raw IPv6 target", async () => {
  const connect = vi.fn();
  await act(async () =>
    root.render(
      createElement(SshServerEditor, { server: proxyServer, onClose: vi.fn(), onConnect: connect }),
    ),
  );
  for (const value of [
    "bad_proxy.invalid",
    "[::1]",
    "https://proxy.invalid",
    "user@proxy.invalid",
    "-bad.invalid",
    "bad..invalid",
    "bad.invalid-",
    "localhost:3128",
  ]) {
    await input("Proxy host", value);
    await submit();
    expect(connect).not.toHaveBeenCalled();
  }
  await input("Proxy host", "2001:db8::1");
  await submit();
  expect(connect).toHaveBeenCalledTimes(1);
  expect(connect.mock.calls[0][0].httpProxy).toEqual({ host: "2001:db8::1", port: 8080 });
});
