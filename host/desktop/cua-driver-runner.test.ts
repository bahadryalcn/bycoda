import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "../store";
import { HostDesktopControl } from "./desktop-control-host";
import type { CuaDriverClient, CuaToolResult } from "./cua-driver-client";
import { createCuaDriverRunner, cuaActionEnvelope, cuaKeys, cuaTree } from "./cua-driver-runner";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const notepad = {
  window_id: 42,
  pid: 7,
  app_name: "notepad.exe",
  title: "Untitled - Notepad",
  minimized: false,
  is_on_screen: true,
  z_index: 3,
};
const elements = [
  {
    element_token: "s0000000a:0",
    depth: 1,
    role: "Edit",
    label: "Text editor",
    actions: ["set_value"],
  },
  { element_token: "s0000000a:1", depth: 1, role: "Button", label: "Save", enabled: false },
  {
    element_token: "s0000000a:2",
    depth: 2,
    role: "MenuItem",
    label: "Save as",
    actions: ["invoke"],
  },
];

function fakeClient(
  responses: Record<string, (args: Record<string, unknown>) => CuaToolResult> = {},
) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client = {
    generation: 1,
    calls,
    async call(_binary: string, name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (responses[name]) return responses[name](args);
      if (name === "list_windows")
        return {
          structuredContent: {
            windows: [
              notepad,
              { ...notepad, window_id: 43, title: "" },
              { ...notepad, window_id: 44, pid: 9, app_name: "notepad++.exe", title: "x" },
            ],
          },
        };
      if (name === "get_window_state")
        return {
          structuredContent: {
            snapshot_id: "s0000000a",
            elements,
            elements_complete: true,
            window_title: notepad.title,
          },
        };
      return {
        structuredContent: { effect: "confirmed" },
        content: [{ type: "text", text: "ok" }],
      };
    },
    close() {},
  };
  return client;
}
const run = (client: ReturnType<typeof fakeClient>, args: string[]) =>
  createCuaDriverRunner(client as unknown as CuaDriverClient, "win32")(
    "C:\\cua-driver.exe",
    ["--session", "ns", ...args],
    {
      signal: new AbortController().signal,
      timeoutMs: 5000,
      maxBuffer: 1024 * 1024,
      env: {},
    },
  ).then((result) => ({ ...result, envelope: JSON.parse(result.stdout) }));

it("lists only the exact app's titled windows and one app per process", async () => {
  const client = fakeClient();
  const apps = await run(client, ["list-apps", "--app", "notepad"]);
  expect(apps.envelope).toMatchObject({
    ok: true,
    command: "list-apps",
    data: { apps: [{ name: "notepad", pid: 7 }] },
  });
  const windows = await run(client, ["list-windows", "--app=notepad"]);
  expect(windows.envelope.data).toEqual([
    { id: "42", title: "Untitled - Notepad", app_name: "notepad.exe", pid: 7 },
  ]);
});

it("renders a nested snapshot whose refs carry the driver generation", async () => {
  const client = fakeClient();
  const { envelope } = await run(client, ["snapshot", "--app", "notepad", "-i", "--compact"]);
  expect(envelope.data.snapshot_id).toBe("c1-s0000000a");
  expect(envelope.data.window).toEqual({ id: "42" });
  const tree = envelope.data.tree;
  expect(tree.children[1]).toMatchObject({ ref_id: "@c1-s0000000a:1", states: ["disabled"] });
  expect(tree.children[1].children[0]).toMatchObject({
    ref_id: "@c1-s0000000a:2",
    name: "Save as",
  });
  expect(client.calls.at(-1)).toMatchObject({
    name: "get_window_state",
    args: { pid: 7, window_id: 42, include_screenshot: false },
  });
});

it("acts on the driver token and refuses refs from an earlier driver run", async () => {
  const client = fakeClient();
  const typed = await run(client, [
    "type",
    "--timeout-ms",
    "5000",
    "--",
    "@c1-s0000000a:0",
    "hello",
  ]);
  expect(client.calls.at(-1)).toEqual({
    name: "type_text",
    args: { element_token: "s0000000a:0", text: "hello" },
  });
  expect(typed.envelope.data.disposition).toEqual({
    delivery: "delivered_verified",
    retry: "unsafe",
  });
  await run(client, ["--headed", "double-click", "--timeout-ms", "5000", "--", "@c1-s0000000a:2"]);
  expect(client.calls.at(-1)).toEqual({
    name: "click",
    args: { element_token: "s0000000a:2", count: 2, delivery_mode: "foreground" },
  });
  client.generation = 2;
  const calls = client.calls.length;
  const stale = await run(client, ["click", "--timeout-ms", "5000", "--", "@c1-s0000000a:2"]);
  expect(client.calls).toHaveLength(calls);
  expect(stale.exitCode).toBe(1);
  expect(stale.envelope.error).toMatchObject({
    code: "stale_element_token",
    disposition: { delivery: "not_delivered", retry: "safe" },
  });
});

it("refuses unmapped actions without dispatching anything", async () => {
  const client = fakeClient();
  const { envelope } = await run(client, [
    "--headed",
    "hover",
    "--timeout-ms",
    "5000",
    "--",
    "@c1-s0000000a:0",
  ]);
  expect(client.calls).toHaveLength(0);
  expect(envelope.error).toMatchObject({
    code: "unsupported_action",
    disposition: { delivery: "not_delivered" },
  });
});

it("sends key chords to the exact window", async () => {
  const client = fakeClient();
  await run(client, [
    "press",
    "--timeout-ms",
    "5000",
    "--app",
    "notepad",
    "--window-id",
    "42",
    "--",
    "Ctrl+Shift+S",
  ]);
  expect(client.calls.at(-1)).toEqual({
    name: "hotkey",
    args: { pid: 7, window_id: 42, keys: ["ctrl", "shift", "s"] },
  });
  await run(client, ["press", "--app", "notepad", "--window-id", "42", "--", "Enter"]);
  expect(client.calls.at(-1)).toEqual({
    name: "press_key",
    args: { pid: 7, window_id: 42, key: "return" },
  });
  expect(cuaKeys("cmd + esc")).toEqual(["win", "escape"]);
});

it("maps refused and failed driver results to safe and uncertain dispositions", () => {
  expect(
    cuaActionEnvelope("click", {
      isError: true,
      structuredContent: { status: "refused", refusal: { code: "background_unavailable" } },
    }).error,
  ).toMatchObject({
    code: "background_unavailable",
    disposition: { delivery: "not_delivered", retry: "safe" },
  });
  expect(cuaActionEnvelope("click", { isError: true }).error?.disposition).toEqual({
    delivery: "delivery_uncertain",
    retry: "unsafe",
  });
  expect(cuaActionEnvelope("click", {}).data).toMatchObject({
    disposition: { delivery: "delivered_unverified", retry: "unsafe" },
  });
  expect(
    cuaActionEnvelope("type", {
      structuredContent: {
        effect: "unverifiable",
        escalation: { reason: "delivery_failed", target: "foreground" },
      },
    }).error,
  ).toMatchObject({
    code: "delivery_failed",
    disposition: { delivery: "delivery_uncertain", retry: "unsafe" },
  });
  expect(cuaTree([], "c1-s1", "Empty")).toEqual({ role: "window", name: "Empty", children: [] });
});

it("routes HostDesktopControl through cua-driver when the owner selects it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-cua-driver-"));
  const binary = join(dir, "cua-driver.exe");
  writeFileSync(binary, "fixture, never executable");
  const digest = createHash("sha256").update("fixture, never executable").digest("hex");
  const store = new HostStore(join(dir, "host.db"));
  const client = fakeClient();
  const control = new HostDesktopControl(store, {
    presence: async () => ({ supported: true, locked: false }),
    run: async () => {
      throw new Error("agent-desktop must not run");
    },
    cuaRun: createCuaDriverRunner(client as unknown as CuaDriverClient, "win32"),
    platform: "win32",
  });
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  cleanups.push(() => store.close());
  cleanups.push(() => control.close());
  await control.ready;
  const owner = { kind: "owner" as const, id: "owner-1" };
  const configured = await control.request(
    {
      op: "configure",
      expectedVersion: 0,
      configuration: {
        enabled: true,
        binaryPath: binary,
        binarySha256: digest,
        allowedApps: ["notepad"],
        allowPhysicalInput: false,
        driver: "cua-driver",
      },
    },
    owner,
  );
  expect(configured.configuration?.driver).toBe("cua-driver");
  const status = await control.request({ op: "status" }, owner);
  expect(status.status).toMatchObject({
    protocol: "mcp",
    permissions: { source: "cua-driver", accessibility: "not-required" },
  });
  const agent = { kind: "assistant" as const, id: "assistant-1" };
  const snapshot = await control.request({ op: "snapshot", app: "notepad" }, agent);
  expect(snapshot.snapshot).toMatchObject({ snapshotId: "c1-s0000000a", windowId: "42" });
  const acted = await control.request(
    {
      op: "act",
      requestId: "r1",
      snapshotId: "c1-s0000000a",
      ref: "@c1-s0000000a:0",
      action: "set-value",
      text: "hi",
    },
    agent,
  );
  expect(acted.operation).toMatchObject({
    state: "settled",
    ok: true,
    delivery: "delivered_verified",
  });
  expect(
    client.calls.some(
      (call) => call.name === "set_value" && call.args.element_token === "s0000000a:0",
    ),
  ).toBe(true);
});

it("launches a bare name only when exactly one installed app matches it", async () => {
  const brave = "C:\\Program Files\\Brave\\brave.exe";
  const client = fakeClient({
    list_apps: () => ({
      structuredContent: {
        apps: [
          {
            name: "Brave",
            bundle_id: brave,
            launch_path: `"${brave}" --source-shortcut-location=start-menu`,
          },
          {
            name: "Notepad++",
            bundle_id: "C:\\npp\\notepad++.exe",
            launch_path: "C:\\npp\\notepad++.exe",
          },
        ],
      },
    }),
  });
  await run(client, ["launch", "--timeout", "10000", "--", "brave"]);
  expect(client.calls.at(-1)).toEqual({
    name: "launch_app",
    args: { launch_path: `"${brave}" --source-shortcut-location=start-menu` },
  });
  const missing = await run(client, ["launch", "--timeout", "10000", "--", "npp-like-unknown"]);
  expect(client.calls.at(-1)?.name).toBe("list_apps");
  expect(missing.envelope.error).toMatchObject({
    code: "app_not_found",
    disposition: { delivery: "not_delivered" },
  });
});
