import { expect, it } from "vitest";
import { sameMachineRoutes } from "./machineRoute";
import type { RemoteMachine } from "./protocol";

const machine: RemoteMachine = {
  id: "m1",
  name: "Office",
  endpoint: "ssh://owner@office",
  environmentId: "env-1",
  ssh: { target: "owner@office", remotePort: 7000 },
};

it("treats a rename, a copy and a different order as the same routes", () => {
  const other: RemoteMachine = { ...machine, id: "m2", environmentId: "env-2" };
  expect(sameMachineRoutes([machine, other], [{ ...other, name: "Renamed" }, { ...machine }])).toBe(
    true,
  );
});

it("separates machines by id, Host identity, endpoint, SSH route and local pairing", () => {
  const changed: Partial<RemoteMachine>[] = [
    { id: "m3" },
    { environmentId: "env-9" },
    { endpoint: "ssh://owner@elsewhere" },
    { ssh: { target: "owner@office", remotePort: 7001 } },
    { ssh: null },
    { localHost: true },
  ];
  for (const change of changed)
    expect(sameMachineRoutes([machine], [{ ...machine, ...change }])).toBe(false);
  expect(sameMachineRoutes([machine], [])).toBe(false);
});
