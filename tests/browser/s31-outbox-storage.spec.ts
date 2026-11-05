import { expect, test } from "@playwright/test";

test("two pages serialize admission and preserve the winner through reload", async ({
  page,
  context,
}) => {
  const second = await context.newPage();
  await Promise.all([
    page.goto("/tests/browser/s31-outbox-storage.html"),
    second.goto("/tests/browser/s31-outbox-storage.html"),
  ]);
  const attempt = async (index: number) => {
    const { outbox } = (window as any).outboxRegression;
    try {
      await outbox.admitDurableRemoteCommand("p", "env", {
        type: "send",
        commandId: `cmd-${index}`,
        sessionId: "same-session",
        text: "hello",
      });
      return "accepted";
    } catch {
      return "held";
    }
  };
  const results = await Promise.all([page.evaluate(attempt, 1), second.evaluate(attempt, 2)]);
  expect(results.sort()).toEqual(["accepted", "held"]);
  await page.reload();
  const retained = await page.evaluate(
    async () =>
      (
        await (window as any).outboxRegression.outbox.readDurableRemoteCommand(
          "p",
          "env",
          "same-session",
        )
      ).command,
  );
  expect(["cmd-1", "cmd-2"]).toContain(retained.commandId);
  await page.evaluate(
    async (command) =>
      (window as any).outboxRegression.outbox.settleDurableRemoteCommand("p", "env", command),
    retained,
  );
  const settled = await second.evaluate(async (command) => {
    const { outbox, database } = (window as any).outboxRegression;
    const key = `bycoda.remote-command.v1:${JSON.stringify(["p", "env"])}:${command.commandId}`;
    const fence = await database.readOutboxDatabaseRecord(key);
    const request = indexedDB.open("bycoda-remote-outbox", 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rawRequest = db.transaction("settlements").objectStore("settlements").get(key);
    const stored = await new Promise<any>((resolve, reject) => {
      rawRequest.onsuccess = () => resolve(rawRequest.result);
      rawRequest.onerror = () => reject(rawRequest.error);
    });
    db.close();
    let replayed = false;
    try {
      await outbox.admitDurableRemoteCommand("p", "env", command);
      replayed = true;
    } catch {
      /* resolved */
    }
    return { fence, replayed, stored };
  }, retained);
  expect(settled.replayed).toBe(false);
  expect(settled.fence).toMatchObject({ resolved: true, settlement: undefined });
  expect(settled.stored).toMatchObject({ raw: "", modern: true });
});

test("quota abort preserves original and follow-up settlement is atomic", async ({ page }) => {
  await page.goto("/tests/browser/s31-outbox-storage.html");
  const result = await page.evaluate(async () => {
    const { database } = (window as any).outboxRegression;
    await database.changeOutboxDatabase("create", null, "original");
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === "settlements") throw new DOMException("quota", "QuotaExceededError");
      return put.call(this, value, key);
    };
    let rejected = false;
    try {
      await database.settleOutboxDatabase("create", "original", "legacy");
    } catch {
      rejected = true;
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    const retained = await database.readOutboxDatabaseRecord("create");
    await database.settleOutboxDatabase("create", "original", "legacy", {
      key: "followup",
      raw: "next",
    });
    return {
      rejected,
      retained,
      original: await database.readOutboxDatabaseRecord("create"),
      followup: await database.readOutboxDatabaseRecord("followup"),
    };
  });
  expect(result.rejected).toBe(true);
  expect(result.retained.entry).toBe("original");
  expect(result.original).toMatchObject({ entry: undefined, settlement: "legacy" });
  expect(result.followup.entry).toBe("next");
});

test("legacy raw remains recoverable, changed bytes reopen recovery, and scans page by scope", async ({
  page,
}) => {
  await page.goto("/tests/browser/s31-outbox-storage.html");
  const result = await page.evaluate(async () => {
    const { outbox, database } = (window as any).outboxRegression;
    const key = `bycoda.remote-command.v1:${JSON.stringify(["p", "env"])}:bad`;
    localStorage.setItem(key, "{unreadable");
    const before = await outbox.durableRemoteOutboxIssues("p", "env");
    await outbox.archiveDurableRemoteOutboxIssue(key);
    const preserved = localStorage.getItem(key);
    const open = indexedDB.open("bycoda-remote-outbox", 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const request = db.transaction("quarantine").objectStore("quarantine").getAll();
    const quarantine = await new Promise<any[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    const after = await outbox.durableRemoteOutboxIssues("p", "env");
    localStorage.setItem(key, "{changed");
    const changed = await outbox.durableRemoteOutboxIssues("p", "env");
    for (let i = 0; i < 260; i++)
      await database.changeOutboxDatabase(`scope:${String(i).padStart(3, "0")}`, null, String(i));
    const first = await database.readOutboxDatabasePage("entries", "scope:");
    const second = await database.readOutboxDatabasePage("entries", "scope:", first.next);
    const third = await database.readOutboxDatabasePage("entries", "scope:", second.next);
    await database.changeOutboxDatabase("scope:new", null, "new");
    let staleRejected = false;
    try {
      await database.changeOutboxDatabase("other", null, "value", undefined, first.revision);
    } catch {
      staleRejected = true;
    }
    return {
      before: before.length,
      after: after.length,
      changed: changed.length,
      preserved,
      quarantined: quarantine.some((row) => row.key === key && row.raw === "{unreadable"),
      counts: [first.values.length, second.values.length, third.values.length],
      staleRejected,
    };
  });
  expect(result).toMatchObject({
    before: 1,
    after: 0,
    changed: 1,
    preserved: "{unreadable",
    quarantined: true,
    counts: [128, 128, 4],
    staleRejected: true,
  });
});
