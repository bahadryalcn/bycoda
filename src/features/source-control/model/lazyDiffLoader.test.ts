import { describe, expect, it } from "vitest";
import { createLazyDiffLoader, type LazyDiffItem } from "./lazyDiffLoader";

function items(count: number, signature = "a"): LazyDiffItem[] {
  return Array.from({ length: count }, (_, index) => ({ id: `f${index}`, signature }));
}

/** Lets every pending load promise settle. */
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function setup(
  options: { concurrency?: number; eagerCount?: number; failing?: ReadonlySet<string> } = {},
) {
  const needed = new Set<string>();
  const started: string[] = [];
  const pending = new Map<string, () => void>();
  const flushes: Array<() => void> = [];
  const snapshots: Array<Map<string, string>> = [];
  const loader = createLazyDiffLoader<LazyDiffItem, string>({
    concurrency: options.concurrency ?? 4,
    eagerCount: options.eagerCount ?? 2,
    needed,
    load: (item, previous) =>
      new Promise<string>((resolve, reject) => {
        started.push(item.id);
        pending.set(item.id, () =>
          options.failing?.has(item.id)
            ? reject(new Error("boom"))
            : resolve(`${item.id}:${item.signature}:${previous ?? "-"}`),
        );
      }),
    failure: (caught) => `error:${(caught as Error).message}`,
    onChange: (loaded) => snapshots.push(loaded),
    schedule: (flush) => {
      flushes.push(flush);
      return () => {
        flushes.splice(flushes.indexOf(flush), 1);
      };
    },
  });
  const finish = async (...ids: string[]) => {
    for (const id of ids) pending.get(id)?.();
    await settle();
  };
  const frame = () => {
    for (const flush of flushes.splice(0)) flush();
  };
  return { loader, needed, started, finish, frame, snapshots, flushes };
}

describe("createLazyDiffLoader", () => {
  it("loads only the eager files of a long list, not every file", async () => {
    const { loader, started } = setup({ concurrency: 4, eagerCount: 2 });
    loader.setItems(items(300));
    await settle();
    expect(started).toEqual(["f0", "f1"]);
  });

  it("loads a file once it is needed and bounds concurrency", async () => {
    const { loader, needed, started } = setup({ concurrency: 2, eagerCount: 0 });
    loader.setItems(items(10));
    for (const id of ["f5", "f6", "f7"]) needed.add(id);
    loader.pump();
    await settle();
    expect(started).toEqual(["f5", "f6"]);
  });

  it("starts the next waiting file when a load finishes", async () => {
    const { loader, needed, started, finish } = setup({ concurrency: 1, eagerCount: 0 });
    loader.setItems(items(5));
    needed.add("f3");
    needed.add("f4");
    loader.pump();
    await finish("f3");
    expect(started).toEqual(["f3", "f4"]);
  });

  it("reports many finished files as one snapshot per frame", async () => {
    const { loader, finish, frame, snapshots, flushes } = setup({ concurrency: 4, eagerCount: 4 });
    loader.setItems(items(4));
    await finish("f0", "f1", "f2", "f3");
    expect(snapshots).toHaveLength(0);
    expect(flushes).toHaveLength(1);
    frame();
    expect(snapshots).toHaveLength(1);
    expect([...snapshots[0].keys()]).toEqual(["f0", "f1", "f2", "f3"]);
  });

  it("loads the focused file before the others that are waiting", async () => {
    const { loader, started } = setup({ concurrency: 1, eagerCount: 1 });
    loader.setItems(items(6));
    loader.setFocus("f4");
    await settle();
    // f0 was already running; nothing else starts until it finishes.
    expect(started).toEqual(["f0"]);
    const second = setup({ concurrency: 1, eagerCount: 1 });
    second.loader.setFocus("f4");
    second.loader.setItems(items(6));
    await settle();
    expect(second.started).toEqual(["f4"]);
  });

  it("keeps a failure as that file's body and does not retry it until the list is set again", async () => {
    const { loader, needed, started, finish, frame, snapshots } = setup({
      concurrency: 1,
      eagerCount: 0,
      failing: new Set(["f1"]),
    });
    loader.setItems(items(3));
    needed.add("f1");
    loader.pump();
    await finish("f1");
    loader.pump();
    await settle();
    expect(started).toEqual(["f1"]);
    frame();
    expect(snapshots[0].get("f1")).toBe("error:boom");
    loader.setItems(items(3));
    await settle();
    expect(started).toEqual(["f1", "f1"]);
  });

  it("does not load a current body again, but loads it when its row changed", async () => {
    const { loader, needed, started, finish } = setup({ concurrency: 4, eagerCount: 0 });
    needed.add("f0");
    loader.setItems(items(2));
    await finish("f0");
    loader.setItems(items(2));
    await settle();
    expect(started).toEqual(["f0"]);
    loader.setItems(items(2, "b"));
    await settle();
    expect(started).toEqual(["f0", "f0"]);
  });

  it("refresh marks loaded bodies stale but fetches only the ones still needed", async () => {
    const { loader, needed, started, finish, frame, snapshots } = setup({
      concurrency: 4,
      eagerCount: 0,
    });
    needed.add("f0");
    needed.add("f1");
    loader.setItems(items(3));
    await finish("f0", "f1");
    frame();
    needed.delete("f1");
    loader.setItems(items(3), { refresh: true });
    await settle();
    expect(started).toEqual(["f0", "f1", "f0"]);
    // The previous body is handed over so the caller can keep its identity.
    await finish("f0");
    frame();
    expect(snapshots.at(-1)?.get("f0")).toBe("f0:a:f0:a:-");
    // The unseen file keeps its stale body until a reader needs it.
    expect(snapshots.at(-1)?.get("f1")).toBe("f1:a:-");
  });

  it("drops bodies of files that left the list and ignores their late results", async () => {
    const { loader, needed, finish, frame, snapshots } = setup({ concurrency: 4, eagerCount: 0 });
    needed.add("f0");
    needed.add("f1");
    loader.setItems(items(2));
    await finish("f0");
    frame();
    loader.setItems(items(2).slice(1));
    frame();
    expect(snapshots.at(-1)?.has("f0")).toBe(false);
    await finish("f1");
    frame();
    expect([...(snapshots.at(-1)?.keys() ?? [])]).toEqual(["f1"]);
  });

  it("stops reporting and loading after dispose", async () => {
    const { loader, started, finish, frame, snapshots } = setup({ concurrency: 1, eagerCount: 3 });
    loader.setItems(items(3));
    loader.dispose();
    await finish("f0");
    frame();
    expect(snapshots).toHaveLength(0);
    expect(started).toEqual(["f0"]);
  });
});
