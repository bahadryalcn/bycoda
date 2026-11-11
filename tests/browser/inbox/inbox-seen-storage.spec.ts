import { expect, test } from "@playwright/test";

test("1100 mounted row hooks settle and refresh after a committed change", async ({ page }) => {
  await page.goto("/tests/browser/inbox/inbox-seen-storage.html", {
    waitUntil: "domcontentloaded",
  });
  await page.evaluate(async () => {
    await (window as any).inboxSeen.seedInboxSeenIfNeeded(
      Array.from({ length: 1100 }, (_, i) => ({
        key: `probe:${i}`,
        updatedAt: new Date(100).toISOString(),
      })),
    );
    (window as any).reads = 0;
    const original = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (...args) {
      (window as any).reads++;
      return original.apply(this, args);
    };
    (window as any).unmountProbes = (window as any).mountProbes(1100);
  });
  await expect
    .poll(() => page.locator('[data-unseen="yes"]').count(), { timeout: 30000 })
    .toBe(1100);
  const reads = await page.evaluate(() => (window as any).reads);
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => (window as any).reads)).toBe(reads);
  await page.evaluate(() =>
    (window as any).inboxSeen.markInboxItemSeen({
      key: "probe:0",
      updatedAt: new Date(200).toISOString(),
    }),
  );
  await expect.poll(() => page.locator('[data-unseen="no"]').count(), { timeout: 30000 }).toBe(1);
  await page.evaluate(() => (window as any).unmountProbes());
});

test("corrupt timestamp rejects a write and preserves original evidence", async ({ page }) => {
  await page.goto("/tests/browser/inbox/inbox-seen-storage.html", {
    waitUntil: "domcontentloaded",
  });
  const result = await page.evaluate(async () => {
    const storage = (window as any).inboxSeenStorage;
    await storage.mergeInboxSeenStorage({ seeded: true, items: {} });
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("bycoda-inbox-seen-v1");
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("items", "readwrite");
      tx.objectStore("items").put("corrupt", "broken");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    const saved = await (window as any).inboxSeen.markInboxItemSeen({
      key: "broken",
      updatedAt: new Date(500).toISOString(),
    });
    const original = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction("items").objectStore("items").get("broken");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return { saved, original, state: (window as any).inboxSeen.inboxSeenStatus().state };
  });
  expect(result).toEqual({ saved: false, original: "corrupt", state: "error" });
});

test("large unread aggregate settles without repeating reads", async ({ page }) => {
  await page.goto("/tests/browser/inbox/inbox-seen-storage.html", {
    waitUntil: "domcontentloaded",
  });
  const result = await page.evaluate(async () => {
    const api = (window as any).inboxSeen;
    const entries = Array.from({ length: 1500 }, (_, i) => ({
      key: `large:${i}`,
      updatedAt: new Date(100).toISOString(),
    }));
    await api.seedInboxSeenIfNeeded(entries);
    let notifications = 0;
    const other = entries.slice(0, 1200);
    const unsubscribe = api.subscribeInboxSeen(() => {
      notifications++;
      api.inboxHasUnseenItems(entries);
      api.inboxHasUnseenItems(other);
    });
    api.inboxHasUnseenItems(entries);
    api.inboxHasUnseenItems(other);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const first = notifications;
    await new Promise((resolve) => setTimeout(resolve, 500));
    unsubscribe();
    return { first, final: notifications, unseen: api.inboxHasUnseenItems(entries) };
  });
  expect(result.unseen).toBe(false);
  expect(result.first).toBeGreaterThan(0);
  expect(result.final).toBe(result.first);
});

test("legacy seeded migration preserves staged seed generation on reload", async ({ page }) => {
  await page.goto("/tests/browser/inbox/inbox-seen-storage.html", {
    waitUntil: "domcontentloaded",
  });
  await page.evaluate(async () => {
    await (window as any).inboxSeenStorage.seedInboxSeenStorage(
      Object.fromEntries(Array.from({ length: 700 }, (_, i) => [`staged:${i}`, 100])),
    );
    localStorage.setItem(
      "bycoda.inboxSeen",
      JSON.stringify({ seeded: true, items: { legacy: 200 } }),
    );
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect
    .poll(() => page.evaluate(() => (window as any).inboxSeen.inboxSeenIsSeeded()))
    .toBe(true);
  const values = await page.evaluate(async () =>
    Object.fromEntries(
      (await (window as any).inboxSeenStorage.readInboxSeenStorage(["staged:699", "legacy"])).items,
    ),
  );
  expect(values).toEqual({ "staged:699": 100, legacy: 200 });
});

test("an interrupted legacy migration keeps its source and resumes on reload", async ({ page }) => {
  await page.goto("/tests/browser/inbox/inbox-seen-storage.html", {
    waitUntil: "domcontentloaded",
  });
  const before = await page.evaluate(async () => {
    const items = Object.fromEntries(Array.from({ length: 1200 }, (_, i) => [`legacy:${i}`, 100]));
    const raw = JSON.stringify({ seeded: true, items });
    localStorage.setItem("bycoda.inboxSeen", raw);
    const original = IDBObjectStore.prototype.put;
    let count = 0;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "items" && ++count === 600)
        throw new DOMException("injected quota", "QuotaExceededError");
      return original.apply(this, args as [any, any]);
    };
    try {
      return {
        saved: await (window as any).inboxSeen.markInboxItemSeen({
          key: "new",
          updatedAt: new Date(200).toISOString(),
        }),
        intact: localStorage.getItem("bycoda.inboxSeen") === raw,
      };
    } finally {
      IDBObjectStore.prototype.put = original;
    }
  });
  expect(before).toEqual({ saved: false, intact: true });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect
    .poll(() => page.evaluate(() => (window as any).inboxSeen.inboxSeenIsSeeded()))
    .toBe(true);
  expect(
    await page.evaluate(async () =>
      (await (window as any).inboxSeenStorage.readInboxSeenStorage(["legacy:1199"])).items.get(
        "legacy:1199",
      ),
    ),
  ).toBe(100);
});

test("migrates large legacy history and merges exact identities across windows", async ({
  context,
  page,
}) => {
  await page.goto("/tests/browser/inbox/inbox-seen-storage.html", {
    waitUntil: "domcontentloaded",
  });
  await page.evaluate(() => {
    const items: Record<string, number> = {};
    for (let index = 0; index < 50_000; index++) items[`item:${index}`] = 100;
    localStorage.setItem("bycoda.inboxSeen", JSON.stringify({ seeded: true, items }));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  const old = { key: "item:49999", updatedAt: new Date(100).toISOString() };
  await expect
    .poll(() => page.evaluate((entry) => (window as any).inboxSeen.isInboxEntryUnseen(entry), old))
    .toBe(false);
  await expect
    .poll(() => page.evaluate(() => (window as any).inboxSeen.inboxSeenStatus().state), {
      timeout: 90_000,
    })
    .toBe("ready");
  expect(
    await page.evaluate(async () =>
      (await (window as any).inboxSeenStorage.readInboxSeenStorage(["item:49999"])).items.get(
        "item:49999",
      ),
    ),
  ).toBe(100);
  expect(await page.evaluate(() => localStorage.getItem("bycoda.inboxSeen") !== null)).toBe(true);
  const entry = { key: "item:50000", updatedAt: new Date(200).toISOString() };
  expect(
    await page.evaluate(
      async (item) => await (window as any).inboxSeen.markInboxItemSeen(item),
      entry,
    ),
  ).toBe(true);
  const second = await context.newPage();
  await second.goto("/tests/browser/inbox/inbox-seen-storage.html", {
    waitUntil: "domcontentloaded",
  });
  await expect
    .poll(() => second.evaluate(() => (window as any).inboxSeen.inboxSeenIsSeeded()), {
      timeout: 90_000,
    })
    .toBe(true);
  await second.evaluate((item) => (window as any).inboxSeen.isInboxEntryUnseen(item), entry);
  await expect
    .poll(() => second.evaluate(() => (window as any).inboxSeen.inboxSeenStatus().state))
    .toBe("ready");
  expect(
    await second.evaluate((item) => (window as any).inboxSeen.isInboxEntryUnseen(item), entry),
  ).toBe(false);
  const newer = { ...entry, updatedAt: new Date(300).toISOString() };
  await expect
    .poll(() =>
      second.evaluate((item) => (window as any).inboxSeen.isInboxEntryUnseen(item), newer),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      async (item) => await (window as any).inboxSeen.markInboxItemSeen(item),
      newer,
    ),
  ).toBe(true);
  await expect
    .poll(() =>
      second.evaluate((item) => (window as any).inboxSeen.isInboxEntryUnseen(item), newer),
    )
    .toBe(false);
  await expect
    .poll(() => second.evaluate(() => (window as any).inboxSeen.inboxSeenStatus().state))
    .toBe("ready");
  expect(
    await second.evaluate((item) => (window as any).inboxSeen.isInboxEntryUnseen(item), newer),
  ).toBe(false);
  await second.close();
});

test("two large first snapshots choose one complete generation", async ({ context, page }) => {
  await page.goto("/tests/browser/inbox/inbox-seen-storage.html", {
    waitUntil: "domcontentloaded",
  });
  const second = await context.newPage();
  await second.goto("/tests/browser/inbox/inbox-seen-storage.html", {
    waitUntil: "domcontentloaded",
  });
  await Promise.all([
    page.evaluate(() =>
      (window as any).inboxSeenStorage.seedInboxSeenStorage(
        Object.fromEntries(Array.from({ length: 700 }, (_, i) => [`a:${i}`, 100])),
      ),
    ),
    second.evaluate(() =>
      (window as any).inboxSeenStorage.seedInboxSeenStorage(
        Object.fromEntries(Array.from({ length: 700 }, (_, i) => [`b:${i}`, 200])),
      ),
    ),
  ]);
  const result = await page.evaluate(async () =>
    Object.fromEntries(
      (
        await (window as any).inboxSeenStorage.readInboxSeenStorage([
          "a:0",
          "a:699",
          "b:0",
          "b:699",
        ])
      ).items,
    ),
  );
  expect([
    JSON.stringify({ "a:0": 100, "a:699": 100 }),
    JSON.stringify({ "b:0": 200, "b:699": 200 }),
  ]).toContain(JSON.stringify(result));
  await second.close();
});

test("serializes overlapping window writes without losing a newer seen timestamp", async ({
  context,
  page,
}) => {
  await page.goto("/tests/browser/inbox/inbox-seen-storage.html", {
    waitUntil: "domcontentloaded",
  });
  const second = await context.newPage();
  await second.goto("/tests/browser/inbox/inbox-seen-storage.html", {
    waitUntil: "domcontentloaded",
  });
  await Promise.all([
    page.evaluate(() =>
      (window as any).inboxSeenStorage.mergeInboxSeenStorage({
        seeded: true,
        items: { shared: 300, first: 100 },
      }),
    ),
    second.evaluate(() =>
      (window as any).inboxSeenStorage.mergeInboxSeenStorage({
        seeded: true,
        items: { shared: 200, second: 200 },
      }),
    ),
  ]);
  expect(
    await page.evaluate(async () =>
      Object.fromEntries(
        (await (window as any).inboxSeenStorage.readInboxSeenStorage(["shared", "first", "second"]))
          .items,
      ),
    ),
  ).toEqual({ shared: 300, first: 100, second: 200 });
  await second.close();
});

test("an interrupted large first seed is invisible and retried without stale staged identities", async ({
  page,
}) => {
  await page.goto("/tests/browser/inbox/inbox-seen-storage.html", {
    waitUntil: "domcontentloaded",
  });
  const result = await page.evaluate(async () => {
    const storage = (window as any).inboxSeenStorage;
    const original = IDBObjectStore.prototype.put;
    let calls = 0;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "seedItems" && ++calls === 600)
        throw new DOMException("injected quota", "QuotaExceededError");
      return original.apply(this, args as [any, any]);
    };
    let failed = false;
    try {
      await storage.seedInboxSeenStorage(
        Object.fromEntries(Array.from({ length: 700 }, (_, i) => [`old:${i}`, 100])),
      );
    } catch {
      failed = true;
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    const before = await storage.readInboxSeenStorage(["old:0"]);
    await storage.seedInboxSeenStorage(
      Object.fromEntries(Array.from({ length: 700 }, (_, i) => [`new:${i}`, 200])),
    );
    const after = await storage.readInboxSeenStorage(["old:0", "new:0", "new:699"]);
    return {
      failed,
      beforeSeeded: before.seeded,
      before: before.items.get("old:0"),
      seeded: after.seeded,
      old: after.items.get("old:0"),
      first: after.items.get("new:0"),
      last: after.items.get("new:699"),
    };
  });
  expect(result).toEqual({
    failed: true,
    beforeSeeded: false,
    before: undefined,
    seeded: true,
    old: undefined,
    first: 200,
    last: 200,
  });
});

test("quota failure keeps legacy evidence and refuses to claim a read was saved", async ({
  page,
}) => {
  await page.goto("/tests/browser/inbox/inbox-seen-storage.html", {
    waitUntil: "domcontentloaded",
  });
  const result = await page.evaluate(async () => {
    const raw = JSON.stringify({ seeded: true, items: { existing: 100 } });
    localStorage.setItem("bycoda.inboxSeen", raw);
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "bycoda.inboxSeen.indexed.v1")
        throw new DOMException("quota", "QuotaExceededError");
      return original.call(this, key, value);
    };
    try {
      return {
        saved: await (window as any).inboxSeen.markInboxItemSeen({
          key: "new",
          updatedAt: new Date(200).toISOString(),
        }),
        legacy: localStorage.getItem("bycoda.inboxSeen"),
        state: (window as any).inboxSeen.inboxSeenStatus().state,
      };
    } finally {
      Storage.prototype.setItem = original;
    }
  });
  expect(result).toEqual({
    saved: false,
    legacy: JSON.stringify({ seeded: true, items: { existing: 100 } }),
    state: "error",
  });
});
