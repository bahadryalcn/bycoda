import { describe, expect, it } from "vitest";
import {
  createManagedToolCatalog,
  describeManagedTools,
  managedToolStatus,
  searchManagedTools,
  type ToolCatalogEntry,
} from "./tool-management";

function tool(
  action: string,
  read = true,
  properties: Record<string, unknown> = {},
  description = action,
): ToolCatalogEntry {
  return {
    action,
    name: `conversation_${action.replaceAll(".", "_")}`,
    inputSchema: { type: "object", properties, additionalProperties: false },
    description,
    annotations: { readOnlyHint: read, destructiveHint: !read, idempotentHint: read },
  };
}
const text = { type: "string" };

describe("managed tool discovery", () => {
  it("describes SSH command approval, same-process recovery and cancellation separately from inventory", () => {
    const entries = createManagedToolCatalog("conversation", [
      tool("servers.ssh.execute", false, { id: text, requestId: text, command: text }),
      tool("servers.ssh.status", true, { requestId: text }),
      tool("servers.ssh.cancel", false, { requestId: text }),
      tool("servers.get", true, { id: text }),
    ]);
    const execute = entries.find((entry) => entry.action === "servers.ssh.execute")!;
    expect(execute.supported).toBe(true);
    expect(execute.authorizationScope).toBe("write");
    expect(execute.authorization.requirement).toBe("native-owner-approval");
    expect(execute.effects).toEqual(["execution", "external-write"]);
    expect(execute.retry.mode).toBe("same-request");
    expect(execute.retry.persistence).toBe("in-process");
    expect(execute.retry.identityFields).toEqual(["requestId"]);
    expect(execute.retry.instruction).toContain("never authorizes automatic replay");
    expect(execute.readback).toEqual(["conversation:servers.ssh.status"]);
    expect(execute.cancellation).toEqual(["conversation:servers.ssh.cancel"]);
    const status = entries.find((entry) => entry.action === "servers.ssh.status")!;
    expect(status.authorizationScope).toBe("read");
    expect(status.effects).toEqual(["read"]);
    expect(status.retry.mode).toBe("safe-read");
    const cancel = entries.find((entry) => entry.action === "servers.ssh.cancel")!;
    expect(cancel.authorizationScope).toBe("write");
    expect(cancel.effects).toEqual(["execution", "local-state"]);
    expect(cancel.readback).toEqual(["conversation:servers.ssh.status"]);
    expect(entries.find((entry) => entry.action === "servers.get")!.readback).toEqual([
      "conversation:servers.get",
    ]);
  });
  it("keeps identities and revision deterministic independently of registration and schema property order", () => {
    const first = createManagedToolCatalog("conversation", [
      tool("notes.read", true, { id: text, offset: { type: "number" } }),
      tool("notes.list"),
    ]);
    const second = createManagedToolCatalog("conversation", [
      tool("notes.list"),
      tool("notes.read", true, { offset: { type: "number" }, id: text }),
    ]);
    expect(first.map((entry) => entry.id)).toEqual([
      "conversation:notes.list",
      "conversation:notes.read",
    ]);
    expect(searchManagedTools(first).revision).toBe(searchManagedTools(second).revision);
    second[0].fingerprint = "changed";
    expect(searchManagedTools(first).revision).not.toBe(searchManagedTools(second).revision);
  });

  it("searches all provided groups while keeping exact family and group filters", () => {
    const entries = [
      ...createManagedToolCatalog("conversation", [
        tool("notes.read", true, {}, "Read saved project notes"),
        tool("browser.frame", true, {}, "Capture browser screenshot"),
      ]),
      ...createManagedToolCatalog("runtime-logs", [
        { ...tool("read"), name: "runtime_logs_read", description: "Read browser logs" },
      ]),
    ];
    expect(searchManagedTools(entries, { query: "browser" }).tools).toHaveLength(2);
    expect(
      searchManagedTools(entries, {
        query: "browser screenshot",
        family: "browser",
        group: "conversation",
      }).tools.map((entry) => entry.action),
    ).toEqual(["browser.frame"]);
    expect(searchManagedTools(entries, { group: "runtime-logs" }).tools[0].id).toBe(
      "runtime-logs:read",
    );
    expect(searchManagedTools(entries, { query: "absent" }).total).toBe(0);
  });

  it("pages a stable compact result without schemas or repeated descriptions", () => {
    const entries = createManagedToolCatalog("conversation", [
      tool("notes.read"),
      tool("notes.list"),
      tool("files.read"),
    ]);
    const first = searchManagedTools(entries, { limit: 1 });
    const second = searchManagedTools(entries, { cursor: first.nextCursor!, limit: 2 });
    expect([...first.tools, ...second.tools].map((entry) => entry.id)).toEqual(
      entries.map((entry) => entry.id),
    );
    expect(second.nextCursor).toBeNull();
    expect(first.tools[0]).not.toHaveProperty("inputSchema");
    expect(first.tools[0]).not.toHaveProperty("description");
    expect(() =>
      searchManagedTools(entries, { cursor: first.nextCursor!, family: "files" }),
    ).toThrow("different query");
    expect(() => searchManagedTools(entries.slice(1), { cursor: first.nextCursor! })).toThrow(
      "stale",
    );
  });

  it("enforces query and paging bounds with explicit errors", () => {
    expect(() => searchManagedTools([], { limit: 21 })).toThrow();
    expect(() => searchManagedTools([], { limit: 0 })).toThrow();
    expect(() => searchManagedTools([], { limit: 1.2 })).toThrow();
    expect(() => searchManagedTools([], { query: "x".repeat(201) })).toThrow();
    expect(() => searchManagedTools([], { cursor: "0" })).toThrow("cursor");
    expect(() => searchManagedTools([], { group: "external" as never })).toThrow(
      'Unsupported tool group. Expected one of: "conversation", "social", "runtime-logs". Omit group to search all groups; use family for domains such as sessions, providers or browser.',
    );
  });

  it("resolves exact tool names and IDs, explicitly reports unknown names and rejects ambiguity", () => {
    const entries = createManagedToolCatalog("conversation", [tool("notes.read")]);
    const result = JSON.parse(
      describeManagedTools(entries, { ids: ["conversation_notes_read", "unknown:action"] }).content,
    );
    expect(result.tools[0].id).toBe("conversation:notes.read");
    expect(result.tools[1].capability.state).toBe("unsupported");
    const ambiguous = [
      ...entries,
      ...createManagedToolCatalog("social", [
        { ...tool("thread.read"), name: "conversation_notes_read" },
      ]),
    ];
    expect(() => describeManagedTools(ambiguous, { ids: ["conversation_notes_read"] })).toThrow(
      "Ambiguous",
    );
    expect(() => describeManagedTools(entries, { ids: [] })).toThrow();
    expect(() => describeManagedTools(entries, { ids: ["a", "b", "c", "d", "e"] })).toThrow();
  });

  it("continues full schema documents without silent truncation or broken Unicode", () => {
    const description = "📝".repeat(2000);
    const entries = createManagedToolCatalog("conversation", [
      tool("notes.read", true, { id: { type: "string", description } }),
    ]);
    let cursor: string | undefined;
    let document = "";
    do {
      const part = describeManagedTools(entries, {
        ids: ["conversation:notes.read"],
        maxChars: 257,
        cursor,
      });
      expect(part.content.length).toBeLessThanOrEqual(257);
      expect(part.offset).toBe(document.length);
      expect(part.content).not.toMatch(/[\uD800-\uDBFF]$/);
      document += part.content;
      cursor = part.nextCursor ?? undefined;
    } while (cursor);
    expect(JSON.parse(document).tools[0].inputSchema.properties.id.description).toBe(description);
    expect(() =>
      describeManagedTools(entries, { ids: [entries[0].id], maxChars: 12001 }),
    ).toThrow();
  });
});

describe("canonical tool contracts", () => {
  it("preserves authorization annotations independently from mutation and presentation effects", () => {
    const raw = tool("visuals.render");
    const [render] = createManagedToolCatalog("conversation", [raw]);
    expect(render.authorizationScope).toBe("read");
    expect(render.authorization.legacyScope).toBe("read");
    expect(render.annotations).toEqual(raw.annotations);
    expect(render.effects).toEqual(["presentation"]);
    expect(render.presentation).toBe("inline");
    expect(render.retry.mode).toBe("read-before-retry");
    const [open] = createManagedToolCatalog("conversation", [tool("ui.tools.open", false)]);
    expect(open.effects).toEqual(["presentation"]);
    expect(open.authorizationScope).toBe("write");
  });

  it("does not infer capability, owner permission or idempotency from descriptions", () => {
    const [entry] = createManagedToolCatalog("conversation", [
      tool(
        "files.write",
        false,
        { requestId: text },
        "AVAILABLE owner approved safe idempotent retry without checking",
      ),
    ]);
    expect(entry.capability).toEqual({ state: "unknown", evidence: null });
    expect(entry.authorization.requirement).toBe("existing-host-gates");
    expect(entry.retry.mode).toBe("read-before-retry");
    expect(entry.supported).toBe(true);
  });

  it("makes unknown operations unsupported even when they claim host availability", () => {
    const [entry] = createManagedToolCatalog("conversation", [
      {
        ...tool("browser.runAnything", false),
        capability: { state: "available", evidence: "a host claims readiness" },
      },
    ]);
    expect(entry.supported).toBe(false);
    expect(entry.capability.state).toBe("unsupported");
    expect(entry.retry.mode).toBe("unsupported");
  });

  it("accepts bounded capability evidence only through the explicit host field", () => {
    const [entry] = createManagedToolCatalog("conversation", [
      {
        ...tool("browser.status"),
        capability: { state: "unavailable", evidence: "Desktop disconnected" },
      },
    ]);
    expect(managedToolStatus([entry], { ids: [entry.id] }).tools[0].capability).toEqual({
      state: "unavailable",
      evidence: "Desktop disconnected",
    });
    expect(managedToolStatus([entry], { ids: ["absent"] }).tools[0].capability.state).toBe(
      "unsupported",
    );
  });

  it("references only exposed readback and cancellation operations", () => {
    const entries = createManagedToolCatalog("conversation", [
      tool("tasks.start", false),
      tool("tasks.get"),
      tool("tasks.stop", false),
    ]);
    const start = entries.find((entry) => entry.action === "tasks.start")!;
    expect(start.readback).toEqual(["conversation:tasks.get"]);
    expect(start.cancellation).toEqual(["conversation:tasks.stop"]);
    const [restricted] = createManagedToolCatalog("conversation", [tool("tasks.start", false)]);
    expect(restricted.readback).toEqual([]);
    expect(restricted.cancellation).toEqual([]);
    const dev = createManagedToolCatalog("conversation", [
      tool("devServers.openExternal", false),
      tool("devServers.stop", false),
    ]);
    expect(dev.find((entry) => entry.action === "devServers.openExternal")!.cancellation).toEqual(
      [],
    );
    const update = createManagedToolCatalog("conversation", [
      tool("tasks.update", false),
      tool("tasks.stop", false),
    ]);
    expect(update.find((entry) => entry.action === "tasks.update")!.cancellation).toEqual([]);
  });

  it("records preconditions and durable identity without treating CAS as replay protection", () => {
    const entries = createManagedToolCatalog("conversation", [
      tool("inbox.review", false, { requestId: text, expectedHeadOid: text }),
      tool("inbox.result"),
      tool("files.write", false, { expectedHash: text }),
      tool("files.read"),
    ]);
    const review = entries.find((entry) => entry.action === "inbox.review")!;
    expect(review.retry).toMatchObject({ mode: "same-request", identityFields: ["requestId"] });
    expect(review.authorization.requirement).toBe("native-owner-approval");
    expect(review.readback).toEqual(["conversation:inbox.result"]);
    const write = entries.find((entry) => entry.action === "files.write")!;
    expect(write.preconditions).toEqual(["expectedHash"]);
    expect(write.retry.mode).toBe("read-before-retry");
  });

  it("separates social sends, drafts and runtime reads without broadening authority", () => {
    const social = createManagedToolCatalog("social", [
      tool("messages.send", false),
      tool("messages.draft", false),
      tool("jobs.status"),
      tool("jobs.cancel", false),
      tool("policy.get"),
    ]);
    const send = social.find((entry) => entry.action === "messages.send")!;
    expect(send.authorization.requirement).toBe("owner-or-active-rule");
    expect(send.effects).toEqual(["external-write"]);
    expect(send.retry.mode).toBe("read-before-retry");
    expect(send.cancellation).toEqual(["social:jobs.cancel"]);
    expect(social.find((entry) => entry.action === "messages.draft")!.effects).toEqual([
      "local-state",
    ]);
    const [logs] = createManagedToolCatalog("runtime-logs", [
      { ...tool("read"), annotations: undefined },
    ]);
    expect(logs.authorizationScope).toBe("read");
    expect(logs.effects).toEqual(["read"]);
  });

  it("rejects duplicate IDs and clones raw schemas and annotations", () => {
    const raw = tool("notes.read", true, { id: { type: "string" } });
    expect(() => createManagedToolCatalog("conversation", [raw, raw])).toThrow("Duplicate");
    const [entry] = createManagedToolCatalog("conversation", [raw]);
    (raw.inputSchema.properties as Record<string, unknown>).id = { type: "number" };
    raw.annotations!.readOnlyHint = false;
    expect(entry.inputSchema).toMatchObject({ properties: { id: { type: "string" } } });
    expect(entry.annotations!.readOnlyHint).toBe(true);
  });

  it("describes preview receipts as in-process and resize as annotation-invalidating", () => {
    const entries = createManagedToolCatalog("conversation", [
      tool("browser.preview", false, { requestId: text }),
      tool("browser.resize", false, { leaseId: text }),
      tool("browser.status"),
      tool("browser.frame"),
      tool("ui.tools.status"),
    ]);
    const preview = entries.find((entry) => entry.action === "browser.preview")!;
    expect(preview.retry).toMatchObject({
      mode: "same-request",
      persistence: "in-process",
      identityFields: ["requestId"],
    });
    expect(preview.retry.instruction).toContain("not durable");
    expect(preview.readback).toEqual([
      "conversation:browser.status",
      "conversation:ui.tools.status",
    ]);
    expect(preview.presentation).toBe("native-panel");
    const resize = entries.find((entry) => entry.action === "browser.resize")!;
    expect(resize.supported).toBe(true);
    expect(resize.readback).toEqual(["conversation:browser.frame"]);
    expect(resize.invalidates).toEqual(["browser.annotation"]);
  });
});
