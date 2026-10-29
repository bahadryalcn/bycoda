import { afterEach, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { HostEngine } from "./engine";
import { HostStore } from "./store";
import type { HostProvider } from "./providers";
import type { SendTurnInput } from "../src/integrations/harness/core/types";
import * as accounts from "./provider-accounts";

const validate = accounts.assertHostProviderAccount;
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-host-account-test-"));
  for (const [provider, id] of [
    ["codex", "account-a"],
    ["codex", "account-b"],
    ["claude", "account-c"],
  ])
    mkdirSync(join(directory, "provider-accounts", provider, id), { recursive: true });
  const validation = vi
    .spyOn(accounts, "assertHostProviderAccount")
    .mockImplementation((provider, id) => validate(provider, id, [directory]));
  const store = new HostStore(join(directory, "host.db"));
  const project = await store.addProject(directory, "Account fixture");
  const turns: { input: SendTurnInput; finish: () => void }[] = [];
  const provider: HostProvider = {
    send: vi.fn((input) => new Promise<void>((finish) => turns.push({ input, finish }))),
    cancel: vi.fn(async () => {
      turns.at(-1)?.finish();
    }),
    stop: vi.fn(async () => {
      turns.at(-1)?.finish();
    }),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  const engine = new HostEngine(store, { codex: provider, claude: provider, pi: provider });
  await engine.ready;
  const created = await engine.command({
    type: "create",
    commandId: "create",
    workspaceMode: "current",
    projectId: project.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  });
  cleanup.push(async () => {
    turns.forEach((turn) => turn.finish());
    await engine.close();
    await store.close();
    expect(resolve(directory).startsWith(resolve(tmpdir()) + sep)).toBe(true);
    rmSync(directory, { recursive: true, force: true });
  });
  const configure = (commandId: string, patch: object = {}) =>
    engine.command({
      type: "configure",
      commandId,
      sessionId: created.sessionId,
      model: "codex:test",
      modelSettings: {},
      runtimeMode: "supervised",
      ...patch,
    });
  return {
    directory,
    engine,
    store,
    id: created.sessionId,
    provider,
    turns,
    validation,
    configure,
  };
}

it("validates a real Host profile, switches, preserves omission and clears to the inherited default", async () => {
  const f = await fixture();
  await f.configure("select-a", { providerAccountId: "account-a" });
  expect((await f.store.session(f.id)).session.providerAccountId).toBe("account-a");
  await f.configure("preserve");
  expect((await f.store.session(f.id)).session.providerAccountId).toBe("account-a");
  await f.configure("select-b", { providerAccountId: "account-b" });
  expect((await f.store.session(f.id)).session.providerAccountId).toBe("account-b");
  await f.configure("clear", { providerAccountId: null });
  expect((await f.store.session(f.id)).session.providerAccountId).toBeUndefined();
  expect(f.provider.send).not.toHaveBeenCalled();
  expect(f.provider.bind).not.toHaveBeenCalled();
  expect(existsSync(join(f.directory, "provider-accounts", "codex", "account-a", "agents"))).toBe(
    false,
  );
});

it("rejects missing, mismatched and unsupported account/provider selections before session/provider effects", async () => {
  const f = await fixture();
  const before = await f.store.session(f.id);
  for (const patch of [
    { providerAccountId: "missing" },
    { providerAccountId: "account-c" },
    { providerAccountId: "../escape" },
    { harness: "pi", model: "pi:test", providerAccountId: "account-a" },
  ]) {
    await expect(f.configure("invalid", patch)).rejects.toThrow(/account/i);
    expect(await f.store.session(f.id)).toEqual(before);
  }
  f.validation.mockRejectedValueOnce(new Error("Account catalog is unavailable"));
  await expect(f.configure("catalog-failed", { providerAccountId: "account-a" })).rejects.toThrow(
    "catalog is unavailable",
  );
  expect(await f.store.session(f.id)).toEqual(before);
  expect(f.provider.send).not.toHaveBeenCalled();
  expect(f.provider.stop).not.toHaveBeenCalled();
  expect(f.provider.bind).not.toHaveBeenCalled();
});

it("binds the account payload to the stable command receipt and does not revalidate an accepted replay", async () => {
  const f = await fixture();
  const receipt = await f.configure("same", { providerAccountId: "account-a" });
  f.validation.mockRejectedValue(new Error("Should not revalidate an accepted command"));
  expect(await f.configure("same", { providerAccountId: "account-a" })).toEqual(receipt);
  await expect(f.configure("same", { providerAccountId: "account-b" })).rejects.toThrow(
    /different|used|payload/i,
  );
  await expect(f.configure("same", { providerAccountId: null })).rejects.toThrow(
    /different|used|payload/i,
  );
  expect((await f.store.session(f.id)).session.providerAccountId).toBe("account-a");
});

it("keeps active-turn configure rejection and passes the selected Host profile to the next actual provider send", async () => {
  const f = await fixture();
  await f.configure("select", { providerAccountId: "account-a" });
  await f.engine.command({ type: "send", commandId: "send", sessionId: f.id, text: "Fixture" });
  await vi.waitFor(() => expect(f.turns).toHaveLength(1));
  expect(f.turns[0].input.providerAccountId).toBe("account-a");
  const before = await f.store.session(f.id);
  const calls = f.validation.mock.calls.length;
  await expect(f.configure("busy", { providerAccountId: "account-b" })).rejects.toThrow(
    "current turn",
  );
  expect(f.validation).toHaveBeenCalledTimes(calls);
  expect((await f.store.session(f.id)).session).toEqual(before.session);
  f.turns[0].finish();
  await vi.waitFor(async () => expect((await f.store.session(f.id)).status).toBe("idle"));
  await f.configure("after-turn", { providerAccountId: "account-b" });
  await f.engine.command({ type: "send", commandId: "send-new", sessionId: f.id, text: "Next" });
  await vi.waitFor(() => expect(f.turns).toHaveLength(2));
  expect(f.turns[1].input.providerAccountId).toBe("account-b");
});

it("preserves existing harness switch/revert identity unless an explicit account overrides it", async () => {
  const f = await fixture();
  await f.configure("select", { providerAccountId: "account-a" });
  const value = await f.store.session(f.id);
  await f.store.save(
    {
      ...value,
      revision: value.revision + 1,
      session: {
        ...value.session,
        providerSessionId: "original-thread",
        blocks: [{ id: "user", role: "user", text: "Keep context" }],
      },
    },
    { type: "fixture" },
  );
  await f.configure("switch", { harness: "claude", model: "claude:test" });
  expect((await f.store.session(f.id)).session.providerAccountId).toBeUndefined();
  await f.configure("revert", { harness: "codex" });
  expect((await f.store.session(f.id)).session).toMatchObject({
    providerAccountId: "account-a",
    providerSessionId: "original-thread",
  });
  await f.configure("switch-again", {
    harness: "claude",
    model: "claude:test",
    providerAccountId: "account-c",
  });
  await f.configure("revert-with-override", { harness: "codex", providerAccountId: "account-b" });
  const final = (await f.store.session(f.id)).session;
  expect(final.providerAccountId).toBe("account-b");
  expect(final.providerSessionId).toBeUndefined();
});
