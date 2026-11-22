import { beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: native.invoke }));

beforeEach(() => {
  vi.resetModules();
  native.invoke.mockReset();
});

const prefix = 'bycoda.remote-command.v1:["project","env"]:';
const command = (commandId: string, sessionId: string) => ({
  type: "send" as const,
  commandId,
  sessionId,
  text: `Message for ${sessionId}`,
  attachments: [
    {
      id: `image-${sessionId}`,
      name: "evidence.png",
      kind: "image" as const,
      mimeType: "image/png",
      size: 12,
    },
  ],
});
const first = command("first", "child-a");
const other = command("other", "child-b");

function nativeListFixture({
  staleEveryTime = false,
  firstError = "CANONICAL_LIST_STALE",
}: { staleEveryTime?: boolean; firstError?: string } = {}) {
  const rows = [first];
  const scans: Array<{ prefix: string; revision: number | null }> = [];
  let revision = 1;
  native.invoke.mockImplementation(async (operation: string, args: Record<string, unknown>) => {
    if (operation === "canonical_store_read") {
      const keys = args.keys as string[];
      return {
        revision,
        entries: keys.includes("migration:complete")
          ? [{ key: "migration:complete", version: 1, value: true }]
          : [],
      };
    }
    if (operation !== "canonical_store_list_bounded")
      throw new Error(`Unexpected operation: ${operation}`);
    scans.push({
      prefix: String(args.prefix).split(":")[0],
      revision: args.expectedRevision as number | null,
    });
    if (String(args.prefix).startsWith("entries:")) {
      return {
        revision,
        entries: rows.map((item) => {
          const key = `${prefix}${item.commandId}`;
          return {
            key: `entries:${key}`,
            version: 1,
            value: { key, raw: JSON.stringify({ v: 1, command: item }) },
          };
        }),
      };
    }
    if (revision === 1 || staleEveryTime) {
      if (revision === 1) rows.push(other);
      revision++;
      return Promise.reject(firstError);
    }
    expect(args.expectedRevision).toBe(revision);
    return { revision, entries: [] };
  });
  return { scans, rows };
}

it("restarts the entire native request scan after a concurrent child changes the revision", async () => {
  const { scans, rows } = nativeListFixture();
  const { readDurableRemoteCommand } = await import("./remoteOutbox");
  const wait = vi.fn(async () => {});
  await expect(
    readDurableRemoteCommand("project", "env", "child-a", undefined, { wait }),
  ).resolves.toEqual({ command: first, revision: 2 });
  await expect(readDurableRemoteCommand("project", "env", "child-b")).resolves.toEqual({
    command: other,
    revision: 2,
  });
  expect(wait).toHaveBeenCalledOnce();
  expect(scans.slice(0, 4)).toEqual([
    { prefix: "entries", revision: null },
    { prefix: "legacy", revision: 1 },
    { prefix: "entries", revision: null },
    { prefix: "legacy", revision: 2 },
  ]);
  expect(rows).toEqual([first, other]);
  expect(
    native.invoke.mock.calls.every(([operation]) => operation !== "canonical_store_transaction"),
  ).toBe(true);
});

it("retries a stale native recovery inventory without dropping the other child's request", async () => {
  const { scans, rows } = nativeListFixture();
  const { durableRemoteOutboxIssues } = await import("./remoteOutbox");
  await expect(durableRemoteOutboxIssues("project", "env")).resolves.toEqual([]);
  expect(scans.filter((scan) => scan.prefix === "entries")).toHaveLength(2);
  expect(rows).toEqual([first, other]);
});

it("retains attachments from both requests when the native inventory is retried", async () => {
  const { scans } = nativeListFixture();
  const { durableRemoteAttachmentIds } = await import("./remoteOutbox");
  await expect(durableRemoteAttachmentIds("env", "project")).resolves.toEqual([
    "image-child-a",
    "image-child-b",
  ]);
  expect(scans.filter((scan) => scan.prefix === "entries")).toHaveLength(2);
});

it("continues to hold saved requests when the native list keeps changing", async () => {
  const { scans } = nativeListFixture({ staleEveryTime: true });
  const { readDurableRemoteCommand } = await import("./remoteOutbox");
  const wait = vi.fn(async () => {});
  await expect(
    readDurableRemoteCommand("project", "env", "child-a", undefined, { wait }),
  ).rejects.toThrow("Pending requests changed; try again.");
  expect(wait).toHaveBeenCalledTimes(4);
  expect(scans.filter((scan) => scan.prefix === "entries")).toHaveLength(5);
});

it("does not retry loss of the original native page authority", async () => {
  const { scans } = nativeListFixture({ firstError: "CANONICAL_PAGE_STALE" });
  const { readDurableRemoteCommand } = await import("./remoteOutbox");
  const wait = vi.fn(async () => {});
  await expect(
    readDurableRemoteCommand("project", "env", "child-a", undefined, { wait }),
  ).rejects.toBe("CANONICAL_PAGE_STALE");
  expect(wait).not.toHaveBeenCalled();
  expect(scans).toHaveLength(2);
});
