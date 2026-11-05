// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withQueryClient } from "../../../../tests/browser/queryTest";
import type { RemoteMachine } from "../../connections/model/protocol";
import type { Automation } from "../model/automations";
import type { MachineResult } from "../model/machineResults";
import { useHostAutomations } from "./useHostAutomations";

const client = vi.hoisted(() => ({ probe: vi.fn(), list: vi.fn() }));
vi.mock("../model/hostAutomationClient", () => ({
  probeMachines: client.probe,
  listHostAutomationResults: client.list,
}));

type Hook = ReturnType<typeof useHostAutomations>;
let latest: Hook;
function Probe({ enabled }: { enabled: boolean }) {
  const probed = useHostAutomations(enabled);
  // Publish the committed value to the test after render, not during it.
  useLayoutEffect(() => {
    latest = probed;
  });
  return null;
}
const Harness = withQueryClient(Probe);

let container: HTMLDivElement;
let root: Root;

const machine = (id: string): RemoteMachine =>
  ({
    id,
    name: `Host ${id}`,
    endpoint: `https://${id}.test`,
    environmentId: `env-${id}`,
  }) as RemoteMachine;

const automation = (id: string, machineId = "a"): Automation =>
  ({
    id,
    name: `Automation ${id}`,
    host: { machineId, machineName: `Host ${machineId}`, projectId: "project" },
  }) as Automation;

const ok = (machineId: string, data: Automation[]): MachineResult<Automation> => ({
  machineId,
  machineName: `Host ${machineId}`,
  status: "ok",
  data,
  stale: false,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

const ids = () => latest.automations.map((entry) => entry.id).sort();
const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));

/** Queues one poll whose answer the test releases later. */
function pendingPoll() {
  const poll = deferred<MachineResult<Automation>[]>();
  client.list.mockImplementationOnce(() => poll.promise);
  return poll;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  client.probe.mockReset().mockResolvedValue({
    capable: [machine("a")],
    outdated: [],
    unreachable: [],
    unreachableMachines: [],
  });
  client.list.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mountWith(first: MachineResult<Automation>[]) {
  client.list.mockResolvedValueOnce(first);
  await act(async () => root.render(createElement(Harness, { enabled: true })));
  await settle();
  expect(latest.loaded).toBe(true);
}

it("forces a capability probe only for an explicit recovery refresh", async () => {
  await mountWith([]);
  expect(client.probe).toHaveBeenLastCalledWith("automations", false);
  client.list.mockResolvedValue([]);
  await act(async () => latest.refresh(true));
  expect(client.probe).toHaveBeenLastCalledWith("automations", true);
  await act(async () => latest.refresh());
  expect(client.probe).toHaveBeenLastCalledWith("automations", false);
});

/** Starts a refresh that stays in flight until the returned poll is resolved. */
async function startInFlightRefresh() {
  const poll = pendingPoll();
  let refreshed!: Promise<void>;
  await act(async () => {
    refreshed = latest.refresh();
  });
  return {
    resolve: async (results: MachineResult<Automation>[]) => {
      await act(async () => {
        poll.resolve(results);
        await refreshed;
      });
    },
  };
}

describe("useHostAutomations confirmed-mutation ledger", () => {
  it("derives machines, unreachable names and automations from the one query", async () => {
    client.probe.mockResolvedValue({
      capable: [machine("a")],
      outdated: [],
      unreachable: ["Host b"],
      unreachableMachines: [machine("b")],
    });
    await mountWith([
      ok("a", [automation("one")]),
      {
        machineId: "b",
        machineName: "Host b",
        status: "error",
        data: [automation("last-known", "b")],
        stale: true,
        error: "The machine is not reachable.",
      },
    ]);
    expect(latest.machines.map((entry) => entry.id)).toEqual(["a"]);
    expect(latest.unreachable).toEqual(["Host b"]);
    // An unreachable machine keeps its last-known automations.
    expect(ids()).toEqual(["last-known", "one"]);
    expect(client.list).toHaveBeenCalledWith([machine("a")], [machine("b")]);
  });

  it("is not loaded and shows nothing while disabled", async () => {
    await act(async () => root.render(createElement(Harness, { enabled: false })));
    await settle();
    expect(latest.loaded).toBe(false);
    expect(latest.automations).toEqual([]);
    expect(client.list).not.toHaveBeenCalled();
    expect(latest.error).toBeNull();
    expect(latest.fetching).toBe(false);
  });

  it("retains an initial probe error as unavailable rather than a loaded empty collection", async () => {
    client.probe.mockRejectedValueOnce(new Error("Original Host unavailable"));
    await act(async () => root.render(createElement(Harness, { enabled: true })));
    await settle();
    expect(latest.loaded).toBe(false);
    expect(latest.error?.message).toBe("Original Host unavailable");
    expect(latest.fetching).toBe(false);
    expect(client.list).not.toHaveBeenCalled();
  });

  it("keeps a save confirmed while an older poll was in flight, then releases it", async () => {
    await mountWith([ok("a", [automation("old")])]);
    const inFlight = await startInFlightRefresh();
    await act(async () => latest.confirmSaved(automation("x")));
    // Shown at once, without waiting for the poll.
    expect(ids()).toEqual(["old", "x"]);

    // The poll began before the confirmation and does not know x.
    await inFlight.resolve([ok("a", [automation("old")])]);
    expect(ids()).toEqual(["old", "x"]);

    // A poll that began after the confirmation is authoritative: x was deleted elsewhere.
    client.list.mockResolvedValueOnce([ok("a", [automation("old")])]);
    await act(async () => latest.refresh());
    expect(ids()).toEqual(["old"]);

    // The ledger entry was dropped, so a later poll does not re-add x.
    client.list.mockResolvedValueOnce([ok("a", [automation("old")])]);
    await act(async () => latest.refresh());
    expect(ids()).toEqual(["old"]);
  });

  it("replaces the stale copy of a saved automation instead of duplicating it", async () => {
    const before = { ...automation("x"), name: "Before" };
    await mountWith([ok("a", [before])]);
    const inFlight = await startInFlightRefresh();
    await act(async () => latest.confirmSaved({ ...before, name: "After" }));
    expect(latest.automations.map((entry) => entry.name)).toEqual(["After"]);
    await inFlight.resolve([ok("a", [before])]);
    expect(latest.automations.map((entry) => entry.name)).toEqual(["After"]);
  });

  it("does not resurrect a confirmed delete from an older poll", async () => {
    const gone = automation("x");
    await mountWith([ok("a", [automation("keep"), gone])]);
    const inFlight = await startInFlightRefresh();
    await act(async () => latest.confirmDeleted(gone));
    expect(ids()).toEqual(["keep"]);

    // The older poll still lists the deleted automation.
    await inFlight.resolve([ok("a", [automation("keep"), gone])]);
    expect(ids()).toEqual(["keep"]);

    // Once a poll that began after the delete was read, the host is the truth again.
    client.list.mockResolvedValueOnce([ok("a", [automation("keep"), gone])]);
    await act(async () => latest.refresh());
    expect(ids()).toEqual(["keep", "x"]);
  });

  it("keys the ledger by machine so same-id automations on other machines are untouched", async () => {
    const onA = automation("same", "a");
    const onB = automation("same", "b");
    await mountWith([ok("a", [onA]), ok("b", [onB])]);
    const inFlight = await startInFlightRefresh();
    await act(async () => latest.confirmDeleted(onA));
    expect(latest.automations.map((entry) => entry.host?.machineId)).toEqual(["b"]);
    await inFlight.resolve([ok("a", [onA]), ok("b", [onB])]);
    expect(latest.automations.map((entry) => entry.host?.machineId)).toEqual(["b"]);
  });

  it("applies a confirmation made before the first read to that read", async () => {
    const first = deferred<MachineResult<Automation>[]>();
    client.list.mockImplementationOnce(() => first.promise);
    await act(async () => root.render(createElement(Harness, { enabled: true })));
    await settle();
    expect(latest.loaded).toBe(false);
    await act(async () => latest.confirmSaved(automation("early")));
    expect(latest.automations).toEqual([]);
    await act(async () => {
      first.resolve([ok("a", [automation("old")])]);
    });
    await settle();
    expect(ids()).toEqual(["early", "old"]);
  });
});
