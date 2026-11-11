import { expect, test } from "@playwright/test";

test("owner hydration fences unknown absence and preserves changed legacy evidence", async ({
  page,
}) => {
  await page.goto("/tests/browser/sessions/s31-outbox-storage.html");
  const result = await page.evaluate(async () => {
    const { bindings, bindingDatabase } = (window as any).outboxRegression;
    const key = "bycoda.host-session-binding.v1:shell";
    const binding = {
      kind: "local-host",
      machineId: "m",
      environmentId: "env",
      projectId: "p",
      sessionId: "host",
      authorityGeneration: null,
      created: false,
    };
    const raw = JSON.stringify({
      binding,
      shell: { id: "shell", cwd: "p", blocks: [] },
      createdAt: 1,
      updatedAt: 1,
    });
    localStorage.setItem(key, raw);
    let unhydrated = false;
    try {
      bindings.hostSessionBinding({ id: "unknown" });
    } catch {
      unhydrated = true;
    }
    await bindings.flushHostSessionBindings();
    const owner = bindings.hostSessionBinding({ id: "shell" });
    const absent = bindings.hostSessionBinding({ id: "unknown" }) === undefined;
    let objectHeld = false;
    try {
      bindings.hostSessionBinding({ id: "unrecorded", hostBinding: binding });
    } catch {
      objectHeld = true;
    }
    const rows = await bindingDatabase.readBindingEvidencePage();
    localStorage.setItem(key, "{changed-legacy");
    let conflict = false;
    try {
      bindings.hostSessionBinding({ id: "shell" });
    } catch {
      conflict = true;
    }
    return {
      unhydrated,
      absent,
      objectHeld,
      owner,
      conflict,
      retained: rows[0].raw === raw,
      legacy: localStorage.getItem(key),
    };
  });
  expect(result).toMatchObject({
    unhydrated: true,
    absent: true,
    objectHeld: true,
    conflict: true,
    retained: true,
    legacy: "{changed-legacy",
    owner: { sessionId: "host" },
  });
  await page.reload();
  expect(
    await page.evaluate(async () => {
      const { bindings } = (window as any).outboxRegression;
      await bindings.flushHostSessionBindings();
      try {
        bindings.hostSessionBinding({ id: "shell" });
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
});

test("binding publication persists original identity and rejects stale-window overwrite", async ({
  page,
  context,
}) => {
  await page.goto("/tests/browser/sessions/s31-outbox-storage.html");
  const second = await context.newPage();
  await second.goto("/tests/browser/sessions/s31-outbox-storage.html");
  const publish = async (suffix: string) => {
    const { bindingDatabase } = (window as any).outboxRegression;
    try {
      await bindingDatabase.writeBindingEvidence(undefined, {
        shellId: "shell",
        raw: suffix,
        legacyRaw: null,
      });
      return "saved";
    } catch {
      return "held";
    }
  };
  expect(
    (await Promise.all([page.evaluate(publish, "one"), second.evaluate(publish, "two")])).sort(),
  ).toEqual(["held", "saved"]);
  expect(
    await page.evaluate(async () => {
      const { bindingDatabase } = (window as any).outboxRegression;
      return (await bindingDatabase.readBindingEvidencePage()).length;
    }),
  ).toBe(1);
});

test("reserved owner persists before admission and deletion retains routing fence", async ({
  page,
}) => {
  await page.goto("/tests/browser/sessions/s31-outbox-storage.html");
  expect(
    await page.evaluate(async () => {
      const { bindings, bindingDatabase } = (window as any).outboxRegression;
      await bindings.flushHostSessionBindings();
      const binding = {
        kind: "local-host",
        machineId: "m",
        environmentId: "env",
        projectId: "p",
        sessionId: "host",
        authorityGeneration: null,
        created: false,
      };
      const shell = bindings.saveHostSessionBinding({ id: "shell", cwd: "p", blocks: [] }, binding);
      await bindings.flushHostSessionBindings();
      bindings.acknowledgeHostSessionBinding(shell, "host", 1);
      await bindings.flushHostSessionBindings();
      bindings.forgetHostSessionShell("shell");
      await bindings.flushHostSessionBindings();
      const rows = await bindingDatabase.readBindingEvidencePage();
      return {
        fenced: bindings.hasHostSessionOwnerFence("shell"),
        deleted: JSON.parse(rows[0].raw).deleted,
        created: JSON.parse(rows[0].raw).binding.created,
        summaries: bindings.hostSessionShellSummaries().length,
      };
    }),
  ).toEqual({ fenced: true, deleted: true, created: true, summaries: 0 });
});

test("binding quota retains compatibility owner and retries original evidence", async ({
  page,
}) => {
  await page.goto("/tests/browser/sessions/s31-outbox-storage.html");
  expect(
    await page.evaluate(async () => {
      const { bindings, bindingDatabase } = (window as any).outboxRegression;
      await bindings.flushHostSessionBindings();
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value: any, ...args: any[]) {
        if (this.name === "owners") throw new DOMException("owner quota", "QuotaExceededError");
        return put.call(this, value, ...(args as []));
      };
      let held = false;
      const binding = {
        kind: "local-host",
        machineId: "m",
        environmentId: "env",
        projectId: "p",
        sessionId: "exact-host",
        authorityGeneration: null,
        created: false,
      };
      bindings.saveHostSessionBinding({ id: "shell", cwd: "p", blocks: [] }, binding);
      try {
        await bindings.flushHostSessionBindings();
      } catch {
        held = true;
      }
      const retained = localStorage.getItem("bycoda.host-session-binding.v1:shell");
      const before = (await bindingDatabase.readBindingEvidencePage()).length;
      IDBObjectStore.prototype.put = put;
      await bindings.flushHostSessionBindings();
      const after = await bindingDatabase.readBindingEvidencePage();
      return {
        held,
        before,
        retained: !!retained,
        exact: after[0].raw === retained,
        sessionId: JSON.parse(after[0].raw).binding.sessionId,
      };
    }),
  ).toEqual({ held: true, before: 0, retained: true, exact: true, sessionId: "exact-host" });
});

test("unavailable owner storage never proves a shell unowned", async ({ page }) => {
  await page.goto("/tests/browser/sessions/s31-outbox-storage.html");
  expect(
    await page.evaluate(async () => {
      const { bindings } = (window as any).outboxRegression;
      const open = indexedDB.open.bind(indexedDB);
      indexedDB.open = () => {
        throw new DOMException("blocked storage", "SecurityError");
      };
      let held = false;
      try {
        await bindings.flushHostSessionBindings();
      } catch {
        held = true;
      }
      let unknown = false;
      try {
        bindings.hostSessionBinding({ id: "missing" });
      } catch {
        unknown = true;
      }
      indexedDB.open = open;
      await bindings.flushHostSessionBindings();
      return {
        held,
        unknown,
        recovered: bindings.hostSessionBinding({ id: "missing" }) === undefined,
      };
    }),
  ).toEqual({ held: true, unknown: true, recovered: true });
});
