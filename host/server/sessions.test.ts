import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostDomainRefusalError } from "../domains/context";
import { HostStore } from "../store";
import type { ServerBindings } from "./bindings";
import { createSessionsRuntime } from "./sessions";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-sessions-runtime-"));
  const store = new HostStore(join(directory, "host.db"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  cleanup.push(() => store.close());
  await store.ready;
  await store.addProject(directory, "Fixture");
  const desktop = {
    samePath: (a: string, b: string) => a === b,
    metadataAsync: async (id: string) =>
      id === "desktop-only" ? { cwd: directory, harness: "codex", running: true } : undefined,
  };
  const runtime = await createSessionsRuntime(
    {
      engine: { store },
      desktop,
      providers: ["codex"],
      assertHostMayRun: async () => {},
      refresh: async () => {},
    } as unknown as Pick<
      ServerBindings,
      "engine" | "desktop" | "assertHostMayRun" | "providers" | "refresh"
    >,
    () => {},
  );
  return runtime;
}

it("refuses a queue existence check for a session nobody stores as not sent", async () => {
  const runtime = await fixture();
  expect(await runtime.queueSessionKnown("desktop-only")).toBe("running");
  for (const running of [false, true]) {
    const error = await runtime.queueSessionKnown("missing", running).catch((cause) => cause);
    expect(error).toBeInstanceOf(HostDomainRefusalError);
    expect(error).toMatchObject({
      message: "Session not found on this machine",
      category: "validation",
      retryable: false,
      delivery: "not-sent",
    });
  }
});
