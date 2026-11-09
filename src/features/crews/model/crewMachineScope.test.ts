import { expect, it } from "vitest";
import { crewCwdOn, orderCrewMachines } from "./crewMachineScope";

const local = {
  id: "local",
  name: "This computer (local sync)",
  endpoint: "http://127.0.0.1:3776",
  environmentId: "local-env",
  localHost: true,
};
const mac = {
  id: "mac",
  name: "tailm",
  endpoint: "http://127.0.0.1:61000",
  environmentId: "mac-env",
  ssh: { target: "me@100.64.0.1", remotePort: 3776 },
};
const box = { ...mac, id: "box", name: "build-box", environmentId: "box-env" };

it("puts this computer first, then remote machines by name", () => {
  expect(orderCrewMachines([mac, box, local]).map((m) => m.id)).toEqual(["local", "box", "mac"]);
});

it("keeps the opened project on its own machine", () => {
  expect(crewCwdOn(local, [], "C:/work/game", "local")).toBe("C:/work/game");
});

it("prefers the same project name on another machine, else its first project", () => {
  const projects = [
    { id: "a", name: "other", cwd: "/Users/me/other" },
    { id: "b", name: "Game", cwd: "/Users/me/Game" },
  ];
  expect(crewCwdOn(mac, projects, "C:/work/game", "local")).toMatch(/mac-env\/Users\/me\/Game$/);
  expect(crewCwdOn(mac, projects.slice(0, 1), "C:/work/game", "local")).toMatch(/\/other$/);
  expect(crewCwdOn(mac, [], "C:/work/game", "local")).toBeUndefined();
});
