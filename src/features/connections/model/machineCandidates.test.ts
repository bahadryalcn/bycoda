import type { Computer } from "@bycoda/account-contracts";
import { expect, it } from "vitest";
import {
  accountPairPlan,
  candidateFromComputer,
  hostOf,
  mergeMachineCandidates,
  sshAddPlan,
  type MachineCandidate,
} from "./machineCandidates";
import type { RemoteMachine } from "./protocol";

const NOW = Date.parse("2026-11-15T12:00:00Z");
const computer = (patch: Partial<Computer> = {}): Computer => ({
  deviceId: "d1",
  name: "Studio",
  platform: "macos",
  environmentId: "env-1",
  routes: [{ endpoint: "https://abc.trycloudflare.com" }],
  lastSeenAt: "2026-11-15T11:55:00Z",
  updatedAt: "2026-11-15T11:55:00Z",
  ...patch,
});
const native = (patch: Partial<MachineCandidate> = {}): MachineCandidate => ({
  key: "ssh:box",
  name: "box",
  sources: ["ssh-config"],
  routes: [{ address: "box", kind: "name" }],
  alreadyAdded: false,
  ...patch,
});
const saved = (patch: Partial<RemoteMachine> = {}): RemoteMachine => ({
  id: "m1",
  name: "Saved",
  endpoint: "ssh://me@elsewhere",
  environmentId: "env-saved",
  ...patch,
});

it("reads hosts from urls, ssh targets and bracketed addresses", () => {
  expect(hostOf("https://ABC.trycloudflare.com:443/x")).toBe("abc.trycloudflare.com");
  expect(hostOf("me@Box.local:22")).toBe("box.local");
  expect(hostOf("[fe80::1]:22")).toBe("fe80::1");
  expect(hostOf("me@100.64.0.5")).toBe("100.64.0.5");
});

it("turns an account computer into a candidate with classified routes and online state", () => {
  const candidate = candidateFromComputer(
    computer({
      routes: [
        { endpoint: "http://192.168.1.20:3776", lanKey: "a".repeat(43) },
        { endpoint: "http://100.101.2.3:3776" },
        { endpoint: "https://abc.trycloudflare.com" },
      ],
    }),
    NOW,
  );
  expect(candidate.routes.map((route) => route.kind)).toEqual(["lan", "tailscale", "tunnel"]);
  expect(candidate.online).toBe(true);
  expect(candidate.os).toBe("macos");
  expect(candidateFromComputer(computer({ lastSeenAt: "2026-11-15T10:00:00Z" }), NOW).online).toBe(
    false,
  );
  expect(candidateFromComputer(computer({ platform: "android" }), NOW)).toMatchObject({
    group: "mobile",
    os: undefined,
  });
});

it("merges one machine seen by account and tailscale by environment id, then address", () => {
  const account = candidateFromComputer(
    computer({ routes: [{ endpoint: "http://100.101.2.3:3776" }] }),
    NOW,
  );
  const peer = native({
    key: "ts:studio",
    name: "studio",
    sources: ["tailscale"],
    routes: [{ address: "100.101.2.3", kind: "tailscale" }],
    online: true,
  });
  const merged = mergeMachineCandidates({ account: [account], native: [peer], saved: [] });
  expect(merged).toHaveLength(1);
  expect(merged[0]).toMatchObject({ name: "Studio", environmentId: "env-1", online: true });
  expect(merged[0]?.sources).toEqual(["account", "tailscale"]);
  expect(merged[0]?.routes).toHaveLength(1);
});

it("does not merge machines with different environment ids that share an address", () => {
  const a = candidateFromComputer(
    computer({ routes: [{ endpoint: "http://100.101.2.3:3776" }] }),
    NOW,
  );
  const b = native({
    key: "servers:x",
    name: "other",
    sources: ["servers"],
    environmentId: "env-2",
    routes: [{ address: "100.101.2.3", kind: "tailscale" }],
  });
  expect(mergeMachineCandidates({ account: [a], native: [b], saved: [] })).toHaveLength(2);
});

it("merges by ssh host when there is no stronger identity", () => {
  const merged = mergeMachineCandidates({
    account: [],
    native: [
      native(),
      native({
        key: "kh:box",
        sources: ["known-hosts"],
        routes: [{ address: "BOX", kind: "name" }],
      }),
    ],
    saved: [],
  });
  expect(merged).toHaveLength(1);
  expect(merged[0]?.sources).toEqual(["ssh-config", "known-hosts"]);
});

it("sorts online first, then account, tailscale and config-only, then by name", () => {
  const merged = mergeMachineCandidates({
    account: [
      candidateFromComputer(computer({ name: "Zed", environmentId: "e-z" }), NOW),
      candidateFromComputer(
        computer({ name: "Idle", environmentId: "e-i", lastSeenAt: "2026-11-14T00:00:00Z" }),
        NOW,
      ),
    ],
    native: [
      native({ key: "a", name: "alpha", routes: [{ address: "alpha", kind: "name" }] }),
      native({
        key: "ts",
        name: "beta",
        sources: ["tailscale"],
        online: true,
        routes: [{ address: "100.64.0.9", kind: "tailscale" }],
      }),
    ],
    saved: [],
  });
  expect(merged.map((machine) => machine.name)).toEqual(["Zed", "beta", "Idle", "alpha"]);
});

it("marks candidates already saved by environment id or ssh host", () => {
  const merged = mergeMachineCandidates({
    account: [candidateFromComputer(computer(), NOW)],
    native: [native()],
    saved: [
      saved({ environmentId: "env-1" }),
      saved({ id: "m2", environmentId: "e2", ssh: { target: "me@box", remotePort: 3774 } }),
    ],
  });
  expect(merged.map((machine) => machine.alreadyAdded)).toEqual([true, true]);
  expect(
    mergeMachineCandidates({ account: [], native: [native()], saved: [saved()] })[0]?.alreadyAdded,
  ).toBe(false);
});

it("plans an SSH add only from native routes", () => {
  const accountOnly = mergeMachineCandidates({
    account: [
      candidateFromComputer(computer({ routes: [{ endpoint: "http://10.0.0.5:3776" }] }), NOW),
    ],
    native: [],
    saved: [],
  })[0]!;
  expect(sshAddPlan(accountOnly)).toBeNull();
  const both = mergeMachineCandidates({
    account: [],
    native: [
      native({
        sshUser: "me",
        routes: [
          { address: "100.64.0.9", kind: "tailscale" },
          { address: "box", kind: "name" },
        ],
      }),
    ],
    saved: [],
  })[0]!;
  expect(sshAddPlan(both)).toEqual({ target: "me@box", alternate: "me@100.64.0.9", name: "box" });
});

it("joins an account computer with the SSH entry on its home-network address", () => {
  const machines = mergeMachineCandidates({
    account: [
      candidateFromComputer(
        computer({
          name: "bab",
          environmentId: "env-bab",
          routes: [{ endpoint: "http://192.168.2.108:61882", lanKey: "a".repeat(64) }],
        }),
        NOW,
      ),
    ],
    native: [
      native({
        key: "known:192.168.2.108",
        name: "192.168.2.108",
        sources: ["known-hosts", "ssh-config"],
        sshUser: "kraba",
        routes: [{ address: "192.168.2.108", kind: "lan" }],
      }),
    ],
    saved: [],
  });
  expect(machines).toHaveLength(1);
  expect(machines[0]!.sources).toEqual(["account", "known-hosts", "ssh-config"]);
  expect(sshAddPlan(machines[0]!)).toEqual({
    target: "kraba@192.168.2.108",
    alternate: null,
    name: "bab",
    environmentId: "env-bab",
  });
});

it("offers account pairing for an account-only computer with a published https route", () => {
  const [machine] = mergeMachineCandidates({
    account: [
      candidateFromComputer(
        computer({
          deviceId: "dev-1",
          environmentId: "env-1",
          routes: [
            { endpoint: "https://studio.tailnet.ts.net" },
            { endpoint: "http://192.168.1.4:3777", lanKey: "a".repeat(64) },
          ],
        }),
        NOW,
      ),
    ],
    native: [],
    saved: [],
  });
  expect(sshAddPlan(machine!)).toBeNull();
  expect(accountPairPlan(machine!)).toEqual({
    deviceId: "dev-1",
    environmentId: "env-1",
    name: "Studio",
    routes: ["https://studio.tailnet.ts.net"],
  });
  expect(
    accountPairPlan({ ...machine!, accountPair: { deviceId: "dev-1", routes: [] } }),
  ).toBeNull();
});
