import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostStore } from "../store";
import { HostAssistant } from "../assistant/service";
import { desktopOperationAuditId, type DesktopOperationAudit } from "./desktop-control-audit";
import type { AssistantNote } from "../../src/shared/model/host-contracts/assistant";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
const event = (state: "unknown" | "settled" = "settled"): DesktopOperationAudit => {
  const principal = { kind: "assistant" as const, id: "stable-thread-source" };
  const requestId = "exact-request";
  return {
    id: desktopOperationAuditId(principal, requestId, state),
    at: 1000,
    principal,
    app: "Notepad",
    action: "set-value",
    headed: false,
    operation: {
      requestId,
      state,
      ok: state === "settled",
      delivery: state === "settled" ? "delivered_verified" : "unknown",
      retry: state === "settled" ? "unsafe" : "unknown",
    },
  };
};
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-desktop-audit-"));
  const store = new HostStore(join(directory, "host.db"));
  const notes: AssistantNote[] = [];
  let unavailable = false;
  const save = vi.fn(
    async (input: { id?: string; title: string; body: string; expectedUpdatedAt?: number }) => {
      if (unavailable) throw new Error("Temporary note conflict");
      const old = notes.find((note) => note.id === input.id);
      const next = {
        id: input.id ?? "daily",
        title: input.title,
        body: input.body,
        createdAt: old?.createdAt ?? 1000,
        updatedAt: (old?.updatedAt ?? 0) + 1,
        tags: ["assistant"],
      };
      if (old) notes.splice(notes.indexOf(old), 1, next);
      else notes.push(next);
      return next;
    },
  );
  const core = new HostAssistant(store, {
    listNotes: async () => notes,
    saveNote: save,
    now: () => 86401000,
  });
  await core.ready;
  cleanups.push(async () => {
    await core.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await core.request(
    { op: "profile.update", expectedVersion: 0, patch: { name: "Arif" } },
    "owner",
  );
  return {
    core,
    store,
    notes,
    save,
    setUnavailable(value: boolean) {
      unavailable = value;
    },
  };
}
it("records one stable History event and one daily note line on repeated audit delivery", async () => {
  const f = await fixture();
  await f.core.recordDesktopOperation(event());
  await f.core.recordDesktopOperation(event());
  const snapshot = (await f.core.request({ op: "snapshot" }, "owner")).snapshot!;
  expect(snapshot.activity.filter((item) => item.kind === "desktop.settled")).toHaveLength(1);
  expect(f.notes).toHaveLength(1);
  expect(f.notes[0].title).toBe("Arif · 1970-01-01");
  expect(f.notes[0].body.split("assistant-event:")).toHaveLength(2);
  expect(f.notes[0].body).toContain("Notepad · set-value · delivered verified");
  expect(f.save).toHaveBeenCalledOnce();
});
it.each(["launch", "clipboard-get", "clipboard-set", "clipboard-clear"] as const)(
  "records metadata-only %s in durable History and daily notes without raw clipboard fields",
  async (action) => {
    const f = await fixture();
    const operation = {
      ...event(),
      action,
      app: action === "launch" ? "Notepad" : "Global clipboard",
    };
    await f.core.recordDesktopOperation(operation);
    await f.core.recordDesktopOperation(operation);
    expect(
      (await f.core.request({ op: "snapshot" }, "owner")).snapshot!.activity.filter(
        (item) => item.kind === "desktop.settled",
      ),
    ).toHaveLength(1);
    expect(f.notes[0].body).toContain(action);
    expect(f.save).toHaveBeenCalledOnce();
    expect(() =>
      f.core.recordDesktopOperation({
        ...operation,
        text: "PRIVATE CLIPBOARD",
      } as typeof operation),
    ).toThrow();
    expect(f.notes[0].body).not.toContain("PRIVATE CLIPBOARD");
  },
);
it("retries a failed note append without duplicating already durable History", async () => {
  const f = await fixture();
  f.setUnavailable(true);
  await expect(f.core.recordDesktopOperation(event())).rejects.toThrow("Temporary note conflict");
  expect(
    (await f.core.request({ op: "snapshot" }, "owner")).snapshot!.activity.filter(
      (item) => item.kind === "desktop.settled",
    ),
  ).toHaveLength(1);
  f.setUnavailable(false);
  await f.core.recordDesktopOperation(event());
  expect(
    (await f.core.request({ op: "snapshot" }, "owner")).snapshot!.activity.filter(
      (item) => item.kind === "desktop.settled",
    ),
  ).toHaveLength(1);
  expect(f.notes[0].body.match(/assistant-event:/g)).toHaveLength(1);
});
it("does not accept raw input, snapshot content or changed metadata under an existing receipt identity", async () => {
  const f = await fixture();
  expect(() =>
    f.core.recordDesktopOperation({ ...event(), text: "NEVER LOG" } as DesktopOperationAudit),
  ).toThrow();
  await f.core.recordDesktopOperation(event());
  await expect(f.core.recordDesktopOperation({ ...event(), app: "Changed app" })).rejects.toThrow(
    "metadata changed",
  );
  expect(f.notes[0].body).not.toContain("NEVER LOG");
});
