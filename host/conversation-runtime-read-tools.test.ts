import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "./store";
import { attachmentPath, writeAttachmentChunk } from "./attachments";
import { ConversationRuntimeReadTools } from "./conversation-runtime-read-tools";

const closes: (() => void)[] = [];
afterEach(() => {
  for (const close of closes.splice(0)) close();
});
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-runtime-read-"));
  const store = new HostStore(join(directory, "host.db"));
  closes.push(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const project = store.addProject(directory, "Project");
  const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const foreignId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const bytes = Buffer.from("abcdefghijklmnopqrstuvwxyz");
  await writeAttachmentChunk(store, {
    id,
    offset: 0,
    size: bytes.length,
    data: bytes.toString("base64"),
  });
  await writeAttachmentChunk(store, {
    id: foreignId,
    offset: 0,
    size: 7,
    data: Buffer.from("private").toString("base64"),
  });
  const session = {
    projectId: project.id,
    session: {
      blocks: [
        {
          id: "message",
          attachments: [
            {
              id,
              name: "C:\\private\\upload.txt",
              mimeType: "text/plain",
              kind: "file",
              size: bytes.length,
              path: "C:\\private\\upload.txt",
              data: "private-inline",
              browserAnnotation: { secret: "private" },
            },
          ],
        },
        {
          id: "generated",
          image: {
            path: attachmentPath(store, id),
            name: "Generated.png",
            mimeType: "image/png",
            size: bytes.length,
            data: "private-inline",
          },
        },
        {
          id: "local",
          attachments: [
            {
              id: "local-ref",
              name: "local.png",
              mimeType: "image/png",
              kind: "image",
              size: 3,
              path: "C:\\private\\local.png",
            },
          ],
        },
      ],
    },
  };
  vi.spyOn(store, "session").mockImplementation((sessionId) => {
    if (sessionId !== "caller") throw new Error("Other-session lookup forbidden");
    return session as ReturnType<HostStore["session"]>;
  });
  const limits = {
    state: vi.fn(() => ({
      maxRunningTasks: 2,
      dailyAgentMinutes: 60,
      usedMinutes: 30,
      limitReached: false,
      credentials: "private",
    })),
  };
  const shells = vi.fn(() => ({
    profiles: [
      {
        id: "shell",
        name: "Shell",
        kind: "bash",
        path: "C:\\private\\shell.exe",
        credentials: "private",
      },
    ],
    defaultId: "shell",
    chosenId: "shell",
  }));
  const tools = new ConversationRuntimeReadTools(store, limits, shells);
  const principal = {
    kind: "session" as const,
    projectId: project.id,
    sessionId: "caller",
    provider: "codex",
  };
  let authorized = true;
  return {
    tools,
    principal,
    session,
    store,
    id,
    foreignId,
    bytes,
    limits,
    shells,
    call: (action: Parameters<typeof tools.call>[0], input: Record<string, unknown> = {}) =>
      tools.call(action, input, principal, () => authorized),
    revoke: () => {
      authorized = false;
    },
  };
}

describe("runtime read conversation tools", () => {
  it("does not advertise missing host attachment bytes as readable", async () => {
    const { call, store, id } = await setup();
    unlinkSync(attachmentPath(store, id));
    const list = (await call("attachments.list")) as { items: { readable: boolean }[] };
    expect(list.items).toHaveLength(3);
    expect(list.items.every((item) => !item.readable)).toBe(true);
  });
  it("returns only aggregate allowlisted host limits and public shell metadata", async () => {
    const { call } = await setup();
    expect(await call("host.limits.status")).toEqual({
      scope: "host-scheduler",
      maxRunningTasks: 2,
      dailyAgentMinutes: 60,
      usedMinutes: 30,
      limitReached: false,
    });
    expect(await call("shell.profiles")).toEqual({
      profiles: [{ id: "shell", name: "Shell", kind: "bash" }],
      defaultId: "shell",
      chosenId: "shell",
    });
  });

  it("lists only transcript metadata and never emits raw paths, annotations or inline bytes", async () => {
    const { call } = await setup();
    const list = await call("attachments.list", { limit: 1 });
    expect(list).toMatchObject({
      total: 3,
      nextOffset: 1,
      items: [{ name: "upload.txt", readable: true }],
    });
    expect(JSON.stringify(list)).not.toContain("private");
    expect(await call("attachments.list", { offset: 2 })).toMatchObject({
      items: [{ id: "local-ref", readable: false }],
    });
  });

  it("reuses accepted-session attachment reads with bounded exact byte pagination", async () => {
    const { call, id, bytes } = await setup();
    const first = (await call("attachments.read", { id, maxBytes: 6 })) as {
      data: string;
      nextOffset: number;
    };
    expect(Buffer.from(first.data, "base64")).toEqual(bytes.subarray(0, 6));
    expect(first.nextOffset).toBe(6);
    const last = await call("attachments.read", { id, offset: 24, maxBytes: 6 });
    expect(last).toMatchObject({
      data: bytes.subarray(24).toString("base64"),
      nextOffset: null,
      size: bytes.length,
    });
    expect(await call("attachments.read", { id: "generated", maxBytes: 3 })).toMatchObject({
      data: bytes.subarray(0, 3).toString("base64"),
    });
  });

  it("rejects other-session IDs, session/path overrides, project mismatch and revoked authority", async () => {
    const { call, id, foreignId, session, revoke, limits } = await setup();
    await expect(call("attachments.read", { id: foreignId })).rejects.toThrow("not found");
    await expect(call("attachments.read", { id, sessionId: "other" })).rejects.toThrow("protected");
    await expect(call("attachments.read", { id, path: "C:\\private" })).rejects.toThrow(
      "protected",
    );
    session.projectId = "other";
    await expect(call("attachments.list")).rejects.toThrow("another project");
    revoke();
    await expect(call("host.limits.status")).rejects.toThrow("revoked");
    expect(limits.state).not.toHaveBeenCalled();
  });

  it("rechecks authority after asynchronous attachment reads", async () => {
    const { store, principal } = await setup();
    let authorized = true;
    const read = vi.fn(async () => {
      authorized = false;
      return { data: "YWJj", offset: 3, size: 3 };
    });
    const tools = new ConversationRuntimeReadTools(store, { state: vi.fn() }, undefined, read);
    await expect(
      tools.call("attachments.read", { id: "attachment" }, principal, () => authorized),
    ).rejects.toThrow("revoked");
  });
});
