import { afterEach, expect, it, vi } from "vitest";
import type { HostSession } from "../../src/features/connections/model/protocol";
import { createSessionViewsRuntime } from "./session-views";

type Deps = Parameters<typeof createSessionViewsRuntime>[0];
const runtime = () => createSessionViewsRuntime({} as Deps);

function block(id: string, text: string) {
  return { id, type: "text", text } as unknown as HostSession["session"]["blocks"][number];
}

function view(revision: number, blocks: ReturnType<typeof block>[]): HostSession {
  return {
    projectId: "p",
    revision,
    session: { id: "s", blocks } as unknown as HostSession["session"],
  } as unknown as HostSession;
}

afterEach(() => vi.restoreAllMocks());

it("re-serializes only the block that changed between desktop syncs", () => {
  const first = block("a", "one");
  const second = block("b", "two");
  const initial = view(1, [first, second, block("c", "three")]);
  const next = view(2, [first, second, block("c", "three!")]);
  const sync = runtime();
  sync.desktopSync(initial);

  const stringify = vi.spyOn(JSON, "stringify");
  const delta = sync.desktopSync(next, 1);

  expect(stringify.mock.calls.map(([value]) => (value as { id: string }).id)).toEqual(["c"]);
  // Full recomputation from scratch, with the same base the watcher holds.
  const fresh = runtime();
  fresh.desktopSync(initial);
  expect(delta).toEqual(fresh.desktopSync(next, 1));
  expect(delta.kind === "delta" && delta.blocks.map((item) => item.id)).toEqual(["c"]);
});

function sessionView(
  id: string,
  revision: number,
  blocks: ReturnType<typeof block>[],
): HostSession {
  return {
    projectId: "p",
    revision,
    session: { id, blocks } as unknown as HostSession["session"],
  } as unknown as HostSession;
}

it("drops removed blocks and keeps the view's byte total equal to a fresh build", () => {
  const kept = block("a", "one");
  const sync = runtime();
  sync.desktopSync(view(1, [kept, block("b", "two")]));
  sync.desktopSync(view(2, [kept, block("c", "three")]));

  const fresh = runtime();
  fresh.desktopSync(view(2, [kept, block("c", "three")]));
  const entry = sync.views.get("s")!;
  expect(entry.bytes).toBe(fresh.views.get("s")!.bytes);
  expect([...entry.json.keys()].sort()).toEqual(["a", "c"]);
  expect([...entry.revs.keys()].sort()).toEqual(["a", "c"]);
});

it("does not count a replaced desktop view twice toward the byte cap", () => {
  const sync = runtime();
  sync.desktopSync(sessionView("first", 1, [block("a", "x".repeat(17_000_000))]));
  sync.desktopSync(sessionView("first", 2, [block("a", "y".repeat(17_000_000))]));
  // One ~34 MB view plus a small one stays under the 64 MiB cap.
  sync.desktopSync(sessionView("second", 1, [block("a", "small")]));
  expect(sync.views.has("first")).toBe(true);
  expect(sync.views.has("second")).toBe(true);
});

it("evicts the oldest desktop view once the running byte total exceeds the cap", () => {
  const sync = runtime();
  sync.desktopSync(sessionView("first", 1, [block("a", "x".repeat(17_000_000))]));
  sync.desktopSync(sessionView("second", 1, [block("a", "y".repeat(17_000_000))]));
  expect(sync.views.has("first")).toBe(false);
  expect(sync.views.has("second")).toBe(true);
});
