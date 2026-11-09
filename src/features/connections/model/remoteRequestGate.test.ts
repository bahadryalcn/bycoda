// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { saveRemoteAutoReconnect } from "../../settings/model/settings";
import {
  adoptRemoteMachineInventory,
  mayStartTunnel,
  remoteMachineFor,
  remoteRequest,
} from "./connections";
import {
  readRemoteLifecycle,
  pauseConnectionRecovery,
  beginConnectionAttempt,
  recordFeatureHealth,
} from "./remoteLifecycle";
import { recordRemoteConnection, resetRemoteHealth } from "./remoteHealth";
import { NativeHostConnectionError } from "../../../platform/tauri/hostConnection";

const down = "Machine is unreachable. Check the host and SSH tunnel, then reconnect.";
const machine = {
  id: "m1",
  name: "Mini",
  endpoint: "",
  environmentId: "env",
  ssh: { target: "me@mini", remotePort: 3774 },
};

it("pins workspace dispatch to the selected environment before the saved machine can change", async () => {
  adoptRemoteMachineInventory([machine]);
  let finish!: (value: unknown) => void;
  invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const request = remoteRequest("m1", "workspace.run", {
    command: "write_text_file",
    args: { path: "C:/project/draft.txt", content: "draft" },
  }).catch((error: unknown) => error);
  expect(invoke).toHaveBeenCalledWith(
    "remote_request",
    expect.objectContaining({
      machineId: "m1",
      expectedEnvironmentId: "env",
      method: "workspace.run",
    }),
  );
  adoptRemoteMachineInventory([{ ...machine, environmentId: "replacement" }]);
  finish("old-host-result");
  expect(String(await request)).toContain("Connection changed");
  expect(invoke.mock.calls.filter(([command]) => command === "remote_request")).toHaveLength(1);
});

it.each([
  [
    "devices.preview",
    { deviceId: "simulator", requestId: "original-preview", url: "exp://127.0.0.1:8081" },
  ],
  [
    "devices.preview.mobile.start",
    {
      projectId: "project",
      deviceId: "simulator",
      requestId: "original-preview",
      url: "exp://127.0.0.1:8081",
    },
  ],
  ["devices.setup", { agentAccess: false }],
  ["devices.stop", {}],
  ["devices.action", { deviceId: "simulator", action: { type: "home" } }],
  ["devices.capture", { deviceId: "simulator" }],
] as const)(
  "preserves an ordinary %s Native HTTP unknown outcome without inventing envelope identity",
  async (method, params) => {
    const marker = `The device operation may have completed [RPC_DEVICE_OUTCOME_UNKNOWN] (${method}). Its outcome is unknown. Do not repeat the request; inspect its original device or preview status and reconnect the selected machine if access changed.`;
    invoke.mockRejectedValueOnce(marker);
    const error = await remoteRequest("m1", method, params).catch((reason: unknown) => reason);
    expect(error).toMatchObject({
      name: "NativeHostConnectionError",
      code: "RPC_DEVICE_OUTCOME_UNKNOWN",
      method,
      uncertain: true,
      unsupported: false,
      retry: "never",
      requestId: null,
      generation: null,
      commandId: null,
    });
    if (method === "devices.preview" || method === "devices.preview.mobile.start")
      expect(error).toHaveProperty("previewRequestId", "original-preview");
    else expect(error).not.toHaveProperty("previewRequestId");
    expect(error).not.toHaveProperty("result");
    expect(error).not.toHaveProperty("frame");
    expect(invoke).toHaveBeenCalledTimes(1);
  },
);

it.each([
  "RPC_AUTHORIZATION: Device credential is invalid or revoked",
  "[RPC_DEVICE_OUTCOME_UNKNOWN]",
  "The operation outcome is unknown",
  "The device operation may have completed [RPC_DEVICE_OUTCOME_UNKNOWN] (devices.stop). Its outcome is unknown. Do not repeat the request; inspect its original device or preview status and reconnect the selected machine if access changed.",
])("preserves ordinary errors outside the exact device HTTP marker: %s", async (reason) => {
  invoke.mockRejectedValueOnce(reason);
  await expect(
    remoteRequest("m1", "devices.preview", { requestId: "original-preview" }),
  ).rejects.toBe(reason);
  expect(invoke).toHaveBeenCalledTimes(1);
});

it("does not interpret device HTTP marker prose on a pure query", async () => {
  const reason =
    "The device operation may have completed [RPC_DEVICE_OUTCOME_UNKNOWN] (files.list). Its outcome is unknown. Do not repeat the request; inspect its original device or preview status and reconnect the selected machine if access changed.";
  invoke.mockRejectedValueOnce(reason);
  await expect(remoteRequest("m1", "files.list")).rejects.toBe(reason);
});

it.each([
  [
    "devices.preview",
    { deviceId: "simulator", requestId: "original-preview", url: "exp://127.0.0.1:8081" },
  ],
  ["devices.action", { deviceId: "simulator", action: { type: "press", x: 1, y: 2 } }],
  ["devices.capture", { deviceId: "simulator" }],
  ["devices.boot", { deviceId: "simulator" }],
  ["devices.start", {}],
  ["devices.setup", { projectId: "project", agentAccess: false }],
  ["devices.stop", { projectId: "project" }],
  [
    "devices.preview.mobile.start",
    {
      projectId: "project",
      deviceId: "simulator",
      requestId: "original-preview",
      url: "exp://127.0.0.1:8081",
      installExpoGo: false,
    },
  ],
] as const)(
  "keeps superseded %s effects unknown without disclosing or repeating them",
  async (method, params) => {
    for (const outcome of ["success", "failure"] as const) {
      adoptRemoteMachineInventory([
        machine,
        { ...machine, id: "issuer", environmentId: "issuer-env" },
      ]);
      const issuerGeneration = readRemoteLifecycle("issuer-env").generation;
      let finish!: (value: unknown) => void;
      let fail!: (reason: unknown) => void;
      invoke.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            finish = resolve;
            fail = reject;
          }),
      );
      const pending = remoteRequest("m1", method, params).catch((error: unknown) => error);
      const sends = invoke.mock.calls.filter(([command]) => command === "remote_request").length;
      adoptRemoteMachineInventory([
        { ...machine, ssh: { ...machine.ssh, target: "me@replacement" } },
        { ...machine, id: "issuer", environmentId: "issuer-env" },
      ]);
      if (outcome === "success")
        finish({ frame: { base64: "private-frame" }, result: "old-device-result" });
      else
        fail(
          new NativeHostConnectionError({
            code: "RPC_WS_DISCONNECTED",
            message: "Possibly accepted device reply was lost",
            generation: 41,
            requestId: "rpc-original",
            commandId: null,
            uncertain: true,
            unsupported: false,
          }),
        );
      const error = await pending;
      expect(error).toMatchObject({
        name: "NativeHostConnectionError",
        code: "RPC_WS_ROUTE_RETIRED",
        method,
        uncertain: true,
        unsupported: false,
        retry: "never",
        commandId: null,
        requestId: outcome === "failure" ? "rpc-original" : null,
        generation: outcome === "failure" ? 41 : null,
      });
      if (method === "devices.preview" || method === "devices.preview.mobile.start")
        expect(error).toHaveProperty("previewRequestId", "original-preview");
      else expect(error).not.toHaveProperty("previewRequestId");
      expect(String(error)).toContain("outcome is unknown");
      expect(String(error)).toContain("Do not repeat");
      expect(error).not.toHaveProperty("result");
      expect(error).not.toHaveProperty("frame");
      expect(String(error)).not.toContain("private-frame");
      expect(invoke.mock.calls.filter(([command]) => command === "remote_request")).toHaveLength(
        sends,
      );
      expect(readRemoteLifecycle("issuer-env").generation).toBe(issuerGeneration);
    }
  },
);

it.each([
  [
    "devices.preview.mobile.status",
    { projectId: "project", requestId: "original-preview", includeFrame: true },
  ],
  ["devices.preview.impact", { projectId: "project" }],
] as const)("keeps stale %s reads as ordinary superseded queries", async (method, params) => {
  for (const outcome of ["success", "failure"] as const) {
    adoptRemoteMachineInventory([machine]);
    let finish!: (value: unknown) => void;
    let fail!: (reason: unknown) => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
    );
    const pending = remoteRequest("m1", method, params).catch((error: unknown) => error);
    adoptRemoteMachineInventory([
      { ...machine, ssh: { ...machine.ssh, target: "me@replacement" } },
    ]);
    if (outcome === "success") finish({ frame: { base64: "private-frame" } });
    else fail(new Error("Read reply was lost"));
    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(NativeHostConnectionError);
    expect(String(error)).toContain("Connection changed while the request was running");
    expect(error).not.toHaveProperty("uncertain");
    expect(error).not.toHaveProperty("previewRequestId");
    expect(error).not.toHaveProperty("frame");
  }
});

it.each(["success", "failure"])(
  "rejects an old route's late %s without overwriting feature health",
  async (outcome) => {
    adoptRemoteMachineInventory([machine]);
    let finish!: (value: unknown) => void;
    let fail!: (reason: unknown) => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
    );
    const old = remoteRequest("m1", "files.list");
    const rejected = expect(old).rejects.toThrow(
      "Connection changed while the request was running",
    );
    adoptRemoteMachineInventory([
      { ...machine, ssh: { ...machine.ssh, target: "me@replacement" } },
    ]);
    if (outcome === "success") finish({ old: true });
    else fail(new Error("Machine is unreachable"));
    await rejected;
    expect(readRemoteLifecycle("env").features.files).toBeUndefined();
  },
);

it("returns a host receipt even when the connection changed while it was in flight", async () => {
  adoptRemoteMachineInventory([machine]);
  let finish!: (value: unknown) => void;
  invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const create = remoteRequest("m1", "commands.dispatch", { type: "create" });
  adoptRemoteMachineInventory([{ ...machine, ssh: { ...machine.ssh, target: "me@replacement" } }]);
  finish({ sessionId: "host-1", revision: 1 });
  await expect(create).resolves.toEqual({ sessionId: "host-1", revision: 1 });
});

it("still reports a dispatch that failed after the connection changed as superseded", async () => {
  adoptRemoteMachineInventory([machine]);
  let fail!: (reason: unknown) => void;
  invoke.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  const create = remoteRequest("m1", "commands.dispatch", { type: "create" });
  const rejected = expect(create).rejects.toThrow(
    "Connection changed while the request was running",
  );
  adoptRemoteMachineInventory([{ ...machine, ssh: { ...machine.ssh, target: "me@replacement" } }]);
  fail(new Error("Machine is unreachable"));
  await rejected;
});

it("does not trust a receipt from a machine that is no longer the same environment", async () => {
  adoptRemoteMachineInventory([machine]);
  let finish!: (value: unknown) => void;
  invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const create = remoteRequest("m1", "commands.dispatch", { type: "create" });
  const rejected = expect(create).rejects.toThrow(
    "Connection changed while the request was running",
  );
  adoptRemoteMachineInventory([{ ...machine, environmentId: "other-env" }]);
  finish({ sessionId: "host-1" });
  await rejected;
});

it("does not interrupt a valid request when many other peers report health", async () => {
  adoptRemoteMachineInventory([machine]);
  let finish!: (value: unknown) => void;
  invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const old = remoteRequest("m1", "files.list");
  for (let index = 0; index < 129; index++) recordFeatureHealth(`peer-${index}`, "host", true);
  recordFeatureHealth("env", "host", true);
  finish({ current: true });
  await expect(old).resolves.toEqual({ current: true });
  expect(readRemoteLifecycle("env").features.files?.status).toBe("ready");
});

beforeEach(async () => {
  localStorage.clear();
  resetRemoteHealth();
  invoke.mockReset();
  invoke.mockImplementation(async (command: string) =>
    command === "remote_machines" ? [machine] : {},
  );
  await remoteMachineFor("env"); // fills the machine list the gate reads
  invoke.mockClear();
});

const sent = () => invoke.mock.calls.find((call) => call[0] === "remote_request")?.[1];

describe("which requests may start an SSH tunnel", () => {
  it("does not let ordinary pollers restart a cancelled recovery", () => {
    pauseConnectionRecovery("env");
    expect(mayStartTunnel("m1", false, false)).toBe(false);
    expect(mayStartTunnel("m1", false, true)).toBe(true);
    beginConnectionAttempt("env");
    expect(mayStartTunnel("m1", false, false)).toBe(true);
  });
  it("allows everything while automatic reconnecting is on", async () => {
    recordRemoteConnection("env", down);
    await remoteRequest("m1", "sessions.list");
    expect(sent()).not.toHaveProperty("allowConnect");
  });

  it("stops background polls of a machine known to be down when it is off", async () => {
    saveRemoteAutoReconnect(false);
    recordRemoteConnection("env", down);
    await remoteRequest("m1", "sessions.list");
    expect(sent()).toMatchObject({ allowConnect: false });
  });

  it("lets what the user did connect, and a machine not known to be down", async () => {
    saveRemoteAutoReconnect(false);
    recordRemoteConnection("env", down);
    expect(mayStartTunnel("m1", true, false)).toBe(true); // Reconnect
    expect(mayStartTunnel("m1", false, true)).toBe(true); // Send, open a project
    resetRemoteHealth(); // nothing has failed yet, as at startup
    expect(mayStartTunnel("m1", false, false)).toBe(true);
    recordRemoteConnection("env");
    expect(mayStartTunnel("m1", false, false)).toBe(true);
  });

  it("treats a machine waiting for sign-in like one that is down", () => {
    saveRemoteAutoReconnect(false);
    recordRemoteConnection("env", "SSH connection failed: Permission denied (publickey).");
    expect(mayStartTunnel("m1", false, false)).toBe(false);
  });
});
