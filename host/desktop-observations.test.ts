import { afterEach, expect, it, vi } from "vitest";
import { existsSync,mkdirSync,mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname,join } from "node:path";
import { createHash } from "node:crypto";
import { HostStore } from "./store";
import { HostDesktopControl, type DesktopRunner } from "./desktop-control-host";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const owner = { kind: "owner" as const, id: "owner" },
  agent = { kind: "assistant" as const, id: "conversation-one" };
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-desktop-reads-")),
    binary = join(directory, "helper.exe"),
    bytes = Buffer.from("isolated protocol fixture");
  writeFileSync(binary, bytes);
  const store = new HostStore(join(directory, "host.db"));
  let pid = 123;
  let foreign = false;
  let invalidImage = false;
  let afterShot = false;
  let changedAfterShot = false;
  const calls: string[][] = [];
  const homes:string[]=[];
  const audits = vi.fn(async () => undefined);
  const run: DesktopRunner = async (_binary, args,options) => {
    calls.push(args);
    homes.push(options.env.AGENT_DESKTOP_HOME!);
    const command = args[2];
    let data: unknown;
    if (command === "list-apps") data = { apps: [{ name: "Editor", pid }] };
    else if (command === "list-windows")
      data = [
        {
          id: "window-one",
          title: "Allowed window",
          app_name: foreign ? "Private" : "Editor",
          pid,
        },
      ];
    else if (command === "find")
      data = {
        snapshot_id: "search",
        matches: [
          {
            ref_id: "@search:e1",
            role: "button",
            name: "Save",
            value: null,
            states: [],
            interactive: true,
          },
        ],
        truncated: false,
      };
    else if (command === "screenshot") {
      data = {
        format: "png",
        data: invalidImage ? Buffer.from("not a PNG").toString("base64") : png,
        width: 1,
        height: 1,
      };
      afterShot = true;
    } else if (command === "wait")
      data = { ref_id: "@search:e1", predicate: "visible", matched: true };
    else data = { disposition: { delivery: "delivered_verified", retry: "unsafe" } };
    if (command === "list-apps" && afterShot && changedAfterShot) {
      pid++;
      data = { apps: [{ name: "Editor", pid }] };
    }
    return { stdout: JSON.stringify({ version: "2.5", ok: true, command, data }), exitCode: 0 };
  };
  const control = new HostDesktopControl(store, {
    run,
    presence: async () => ({ supported: true, locked: false }),
    onOperation: audits,
    now: () => 1000,
  });
  await control.ready;
  cleanup.push(async () => {
    await control.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await control.request(
    {
      op: "configure",
      expectedVersion: 0,
      configuration: {
        enabled: true,
        binaryPath: binary,
        binarySha256: createHash("sha256").update(bytes).digest("hex"),
        allowedApps: ["Editor"],
        allowPhysicalInput: false,
      },
    },
    owner,
  );
  return {
    control,
    calls,
    homes,
    audits,
    foreign: () => {
      foreign = true;
    },
    invalidImage: () => {
      invalidImage = true;
    },
    changeAfterShot: () => {
      changedAfterShot = true;
    },
  };
}
it("scopes window inventory and search refs to the exact allowed process/window without action audit", async () => {
  const f = await fixture();
  expect((await f.control.request({ op: "windows.list", app: "Editor" }, agent)).windows).toEqual([
    { id: "window-one", title: "Allowed window", app: "Editor", pid: 123 },
  ]);
  const found = await f.control.request(
    { op: "find", app: "Editor", windowId: "window-one", query: { name: "--force", exact: true } },
    agent,
  );
  expect(found.snapshot?.snapshotId).toBe("search");
  expect(f.calls.find((args) => args[2] === "find")).toEqual(
    expect.arrayContaining(["--name=--force", "--exact", "--window-id=window-one"]),
  );
  await f.control.drainOperationAudits();
  expect(f.audits).not.toHaveBeenCalled();
  await expect(
    f.control.request(
      { op: "wait", snapshotId: "search", ref: "@search:e1", predicate: "visible", timeoutMs: 100 },
      { kind: "assistant", id: "other-conversation" },
    ),
  ).rejects.toThrow("this caller");
  expect(
    (
      await f.control.request(
        {
          op: "wait",
          snapshotId: "search",
          ref: "@search:e1",
          predicate: "visible",
          timeoutMs: 100,
        },
        agent,
      )
    ).dataJson,
  ).toContain('"matched":true');
  expect(
    (
      await f.control.request(
        {
          op: "act",
          requestId: "search-action",
          snapshotId: "search",
          ref: "@search:e1",
          action: "click",
        },
        agent,
      )
    ).operation?.delivery,
  ).toBe("delivered_verified");
});
it("refuses outside apps, foreign inventory and invented window IDs before observing their contents", async () => {
  const f = await fixture();
  await expect(
    f.control.request({ op: "screenshot", app: "Private", windowId: "secret" }, agent),
  ).rejects.toThrow("allowlist");
  expect(f.calls).toHaveLength(0);
  await expect(
    f.control.request(
      { op: "find", app: "Editor", windowId: "other", query: { text: "secret" } },
      agent,
    ),
  ).rejects.toThrow("window");
  expect(f.calls.some((args) => args[2] === "find")).toBe(false);
  f.foreign();
  await expect(f.control.request({ op: "windows.list", app: "Editor" }, agent)).rejects.toThrow(
    "foreign",
  );
});
it("returns only bounded in-memory PNG data and rechecks the window/process after capture", async () => {
  const f = await fixture();
  expect(
    (await f.control.request({ op: "screenshot", app: "Editor", windowId: "window-one" }, agent))
      .screenshot,
  ).toEqual({
    app: "Editor",
    windowId: "window-one",
    mimeType: "image/png",
    data: png,
    width: 1,
    height: 1,
  });
  expect(f.calls.find((args) => args[2] === "screenshot")).toEqual(
    expect.arrayContaining(["--app=Editor", "--window-id=window-one"]),
  );
  f.invalidImage();
  await expect(
    f.control.request({ op: "screenshot", app: "Editor", windowId: "window-one" }, agent),
  ).rejects.toThrow("PNG");
  const drift = await fixture();
  drift.changeAfterShot();
  await expect(
    drift.control.request({ op: "screenshot", app: "Editor", windowId: "window-one" }, agent),
  ).rejects.toThrow("process changed");
});
it("keeps observation limits and final request authority through the actual adapter queue", async () => {
  const f = await fixture();
  await expect(
    f.control.request(
      {
        op: "wait",
        snapshotId: "unknown",
        ref: "@unknown:e1",
        predicate: "exists",
        timeoutMs: 10001,
      },
      agent,
    ),
  ).rejects.toThrow();
  await expect(
    f.control.request({ op: "windows.list", app: "Editor" }, agent, async () => false),
  ).rejects.toThrow("revoked");
  expect(f.calls).toHaveLength(0);
  await f.control.request({ op: "stop" }, owner);
  await expect(f.control.request({ op: "windows.list", app: "Editor" }, agent)).rejects.toThrow(
    "stopped",
  );
  expect(f.calls).toHaveLength(0);
});
it("retires only this instance's temporary accessibility cache after Stop and close",async()=>{
  const f=await fixture();await f.control.request({op:"windows.list",app:"Editor"},agent);
  const first=f.homes[0],other=join(dirname(first),"other-instance");mkdirSync(other);writeFileSync(join(other,"keep"),"other owner");writeFileSync(join(first,"temporary-accessibility.json"),"private cached names and values");
  await f.control.request({op:"stop"},owner);expect(existsSync(first)).toBe(false);expect(existsSync(join(other,"keep"))).toBe(true);
  await f.control.request({op:"resume"},owner);await f.control.request({op:"windows.list",app:"Editor"},agent);
  const second=f.homes.at(-1)!;expect(second).not.toBe(first);expect(existsSync(second)).toBe(true);
  await f.control.close();expect(existsSync(second)).toBe(false);expect(existsSync(join(other,"keep"))).toBe(true);
});
