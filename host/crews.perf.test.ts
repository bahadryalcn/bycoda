import { forEachAsync } from "./async-collections";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostStore } from "./store";
import { HostCrews } from "./crews";
import type { HostTasks } from "./tasks";
import type { HostEngine } from "./engine";
// An idle host (no crew runs) must not spend CPU on the crew tick.
const stores: HostStore[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await await forEachAsync(await stores.splice(0), async (store) => await store.close());
});
async function setup() {
  const store = new HostStore(":memory:");
  await stores.push(store);
  await store.addProject("/crew-idle", "Idle");
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
  it("drains a held tick on close and admits no later work", async () => {
    const { crews, engine } = await setup();
    const entered = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    const read = vi.spyOn(crews as any, "read").mockImplementation(async () => {
      entered.resolve();
      await released.promise;
      return { definitions: [], runs: [] };
    });
    const ticking = crews.tick();
    await entered.promise;
    let closed = false;
    const closing = crews.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    released.resolve();
    await Promise.all([ticking, closing]);
    await crews.tick();
    await expect(crews.call("crews.list", {}, "unused")).rejects.toThrow("closing");
    expect(read).toHaveBeenCalledOnce();
    expect(engine.command).not.toHaveBeenCalled();
  });
  // perf P15: skip the crew-state SELECT + JSON.parse when there are no runs.
  it("does not query the database for crew state when there are no runs", async () => {
    const { store, crews, engine } = await setup();
    // Whatever the first tick needs to learn that nothing is running.
    await crews.tick();
    const prepare = vi.spyOn(store.db, "prepare");
    for (let i = 0; i < 5; i++) await crews.tick();
    expect(prepare).not.toHaveBeenCalled();
    expect(engine.command).not.toHaveBeenCalled();
  });
  it("still ticks cleanly with no runs and sends nothing", async () => {
    const { crews, engine } = await setup();
    await expect(crews.tick()).resolves.toBeUndefined();
    expect(engine.command).not.toHaveBeenCalled();
  });
});
