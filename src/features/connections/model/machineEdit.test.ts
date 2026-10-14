import { expect, it } from "vitest";
import {
  draftFromMachine,
  editImpact,
  hostnameSuggestion,
  isRawIpAddress,
  parseMachineDraft,
  sshHost,
} from "./machineEdit";
import type { RemoteMachine } from "./protocol";

const machine: RemoteMachine = {
  id: "m1",
  name: "Home Mac",
  endpoint: "ssh://me@192.168.1.5",
  environmentId: "env",
  ssh: { target: "me@192.168.1.5", port: 2222, remotePort: 3774 },
};

it("shows the saved values and parses them back unchanged", () => {
  const draft = draftFromMachine(machine);
  expect(draft).toEqual({
    name: "Home Mac",
    target: "me@192.168.1.5",
    port: "2222",
    remotePort: "3774",
    alternate: "",
  });
  const parsed = parseMachineDraft(draft);
  expect(parsed).toEqual({
    ok: true,
    value: {
      name: "Home Mac",
      target: "me@192.168.1.5",
      port: 2222,
      remotePort: 3774,
      alternate: null,
    },
  });
  expect(editImpact(machine, (parsed as { value: never }).value)).toEqual({
    changed: false,
    reconnect: false,
  });
});

it("rejects addresses ssh could read as options and ports out of range", () => {
  const bad = (target: string, port = "") => parseMachineDraft({ name: "", target, port }).ok;
  expect(bad("")).toBe(false);
  expect(bad("-oProxyCommand=x")).toBe(false);
  expect(bad("me@host name")).toBe(false);
  expect(bad("a@b@c")).toBe(false);
  expect(bad("me@host", "0")).toBe(false);
  expect(bad("me@host", "70000")).toBe(false);
  expect(bad("me@host", "22.5")).toBe(false);
  expect(bad("me@host", "22")).toBe(true);
  expect(bad("me@[fe80::1]")).toBe(true);
  expect(bad("alias")).toBe(true);
});

it("trims the address and treats an empty port as the SSH config default", () => {
  expect(parseMachineDraft({ name: " Mac ", target: " me@new ", port: " " })).toEqual({
    ok: true,
    value: { name: "Mac", target: "me@new", port: null, alternate: null },
  });
});

it("reconnects only when the way in changes", () => {
  const impact = (patch: Partial<{ name: string; target: string; port: number | null }>) =>
    editImpact(machine, { name: "Home Mac", target: "me@192.168.1.5", port: 2222, ...patch });
  expect(impact({ name: "Office Mac" })).toEqual({ changed: true, reconnect: false });
  expect(impact({ name: "" })).toEqual({ changed: false, reconnect: false });
  expect(impact({ target: "me@192.168.1.9" })).toEqual({ changed: true, reconnect: true });
  expect(impact({ port: null })).toEqual({ changed: true, reconnect: true });
  expect(
    editImpact(
      { ...machine, ssh: { target: "me@h", remotePort: 1 } },
      { name: "", target: "me@h", port: null },
    ),
  ).toEqual({ changed: false, reconnect: false });
});

it("tells a raw IP from a name", () => {
  expect(sshHost("me@[fe80::1]")).toBe("fe80::1");
  expect(sshHost("10.0.0.2")).toBe("10.0.0.2");
  expect(isRawIpAddress("me@192.168.1.5")).toBe(true);
  expect(isRawIpAddress("10.0.0.2")).toBe(true);
  expect(isRawIpAddress("me@[fe80::1]")).toBe(true);
  expect(isRawIpAddress("me@999.1.1.1")).toBe(false);
  expect(isRawIpAddress("me@my-mac.local")).toBe(false);
  expect(isRawIpAddress("alias")).toBe(false);
});

it("Host portunu SSH portundan bağımsız doğrular ve değişince yeniden bağlanır", () => {
  for (const remotePort of ["", "0", "65536", "22.5", "invalid"])
    expect(parseMachineDraft({ ...draftFromMachine(machine), remotePort }).ok).toBe(false);
  const parsed = parseMachineDraft({ ...draftFromMachine(machine), remotePort: " 3776 " });
  if (!parsed.ok) throw new Error("unreachable");
  expect(parsed.value).toMatchObject({ port: 2222, remotePort: 3776 });
  expect(editImpact(machine, parsed.value)).toEqual({ changed: true, reconnect: true });
});

it("suggests the host's own name only for a raw IP and a hostname-shaped name", () => {
  expect(hostnameSuggestion("me@192.168.1.5", "Alex-MacBook-Pro.local")).toBe(
    "me@Alex-MacBook-Pro.local",
  );
  expect(hostnameSuggestion("192.168.1.5", "mini.local")).toBe("mini.local");
  expect(hostnameSuggestion("me@mini.local", "other.local")).toBeUndefined();
  expect(hostnameSuggestion("me@192.168.1.5", "Home Mac")).toBeUndefined();
  expect(hostnameSuggestion("me@192.168.1.5", "ubuntu")).toBeUndefined();
  expect(hostnameSuggestion("me@192.168.1.5", "-x.local")).toBeUndefined();
  expect(hostnameSuggestion("me@192.168.1.5", "")).toBeUndefined();
});

it("keeps a second address for the same machine and reconnects when it changes", () => {
  const parse = (alternate: string) =>
    parseMachineDraft({ ...draftFromMachine(machine), alternate });
  const tailscale = parse(" me@100.64.0.5 ");
  expect(tailscale).toMatchObject({ ok: true, value: { alternate: "me@100.64.0.5" } });
  if (!tailscale.ok) throw new Error("unreachable");
  expect(editImpact(machine, tailscale.value)).toEqual({ changed: true, reconnect: true });

  // Blank, or the same as the first address, means none.
  expect(parse("  ")).toMatchObject({ ok: true, value: { alternate: null } });
  expect(parse(machine.ssh!.target)).toMatchObject({ ok: true, value: { alternate: null } });
  expect(parse("-oProxyCommand=x")).toMatchObject({ ok: false });

  const saved = { ...machine, ssh: { ...machine.ssh!, alternate: "me@100.64.0.5" } };
  expect(draftFromMachine(saved).alternate).toBe("me@100.64.0.5");
  const unchanged = parseMachineDraft(draftFromMachine(saved));
  if (!unchanged.ok) throw new Error("unreachable");
  expect(editImpact(saved, unchanged.value)).toEqual({ changed: false, reconnect: false });
});
