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
