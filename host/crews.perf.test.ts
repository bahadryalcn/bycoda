import { afterEach, describe, expect, it, vi } from "vitest";
import { HostStore } from "./store";
import { HostCrews } from "./crews";
import type { HostTasks } from "./tasks";
import type { HostEngine } from "./engine";

// An idle host (no crew runs) must not spend CPU on the crew tick.

const stores: HostStore[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  stores.splice(0).forEach((store) => store.close());
});

function setup() {
  const store = new HostStore(":memory:");
  stores.push(store);
  store.addProject("/crew-idle", "Idle");
  const tasks = { list: () => [], tick: vi.fn() };
  const engine = { command: vi.fn(), updateSession: vi.fn() };
  const crews = new HostCrews(
    store,
    engine as unknown as HostEngine,
    tasks as unknown as HostTasks,
    async () => ({ models: { codex: [], claude: [] }, errors: {} }),
    () => 1000,
  );
  return { store, crews, engine };
}

describe("host crews idle tick (perf)", () => {
  // perf P15: skip the crew-state SELECT + JSON.parse when there are no runs (cache or revision check); remove .fails when fixed.
  it.fails("does not query the database for crew state when there are no runs", async () => {
    const { store, crews, engine } = setup();
    // Whatever the first tick needs to learn that nothing is running.
    await crews.tick();
    const prepare = vi.spyOn(store.db, "prepare");
    for (let i = 0; i < 5; i++) await crews.tick();
    expect(prepare).not.toHaveBeenCalled();
    expect(engine.command).not.toHaveBeenCalled();
  });

  it("still ticks cleanly with no runs and sends nothing", async () => {
    const { crews, engine } = setup();
    await expect(crews.tick()).resolves.toBeUndefined();
    expect(engine.command).not.toHaveBeenCalled();
  });
});
