import { afterEach, expect, it } from "vitest";
import { forEachAsync } from "../async-collections";
import { HostStore } from "../store";
import { HostCrews } from "./crews";
import type { HostTasks } from "../tasks/tasks";
import type { HostEngine } from "../engine";
import type { CrewAgent } from "../../src/features/crews/model/crew";

const stores: HostStore[] = [];
afterEach(async () => {
  await forEachAsync(stores.splice(0), async (store) => await store.close());
});
async function setup() {
  const store = new HostStore(":memory:");
  stores.push(store);
  const one = await store.addProject("/identity-one", "One");
  const two = await store.addProject("/identity-two", "Two");
  const service = new HostCrews(
    store,
    {} as HostEngine,
    {} as HostTasks,
    async () => ({ models: {}, errors: {} }),
    () => 1000,
  );
  const agent = (id: string, handle?: string): CrewAgent => ({
    id,
    name: `Member ${id}`,
    role: "specialist",
    instructions: "",
    selection: "fixed",
    candidates: [
      { id: "c", harness: "codex", model: "m", modelSettings: {}, capabilities: {}, cost: 1 },
    ],
    ...(handle ? { handle } : {}),
  });
  const save = async (projectId: string, member: CrewAgent, scope?: string, expected?: number) =>
    await service.call(
      "crews.agent.save",
      {
        agent: { ...member, ...(scope ? { projectId: scope } : {}) },
        expectedUpdatedAt: expected,
      },
      projectId,
    );
  return { one, two, service, agent, save };
}

it("keeps handles unique across the visible library, case-insensitively", async () => {
  const f = await setup();
  await f.save(f.one.id, f.agent("a", "Pixel"));
  await expect(f.save(f.one.id, f.agent("b", "pixel"))).rejects.toThrow(
    "Handle @pixel is already used by Member a",
  );
  await expect(f.save(f.two.id, f.agent("c", "pixel"), f.two.id)).rejects.toThrow("@pixel");
  await expect(f.save(f.one.id, f.agent("d", "other"))).resolves.toMatchObject({ handle: "other" });
});

it("allows the same handle in projects that cannot see each other", async () => {
  const f = await setup();
  await f.save(f.one.id, f.agent("a", "pixel"), f.one.id);
  await f.save(f.two.id, f.agent("b", "pixel"), f.two.id);
  await expect(f.save(f.one.id, f.agent("c", "pixel"))).rejects.toThrow("already used");
  expect((await f.service.list(f.one.id)).agents.map((a) => a.id)).toEqual(["a"]);
});

it("lets a member keep its own handle on resave and frees it on rename", async () => {
  const f = await setup();
  const first = await f.save(f.one.id, f.agent("a", "pixel"));
  const again = (await f.save(
    f.one.id,
    f.agent("a", "pixel"),
    undefined,
    (first as { updatedAt: number }).updatedAt,
  )) as { updatedAt: number };
  await f.save(f.one.id, f.agent("a", "renamed"), undefined, again.updatedAt);
  await expect(f.save(f.one.id, f.agent("b", "pixel"))).resolves.toMatchObject({ id: "b" });
});

it("keeps saved members without identity fields", async () => {
  const f = await setup();
  const saved = await f.save(f.one.id, f.agent("a"));
  expect(saved).not.toHaveProperty("handle");
  expect(saved).not.toHaveProperty("avatar");
});
