import { expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SendTurnInput } from "../../src/integrations/harness/core/types";
import type { HostProvider } from "../providers/providers";
import { HostEngine, type ManagedTurnHistoryAdapter } from "../engine";
import type { TurnGitRecord, TurnGitSnapshot } from "../workspaces/workspace-contracts";
import { HostStore } from "../store";
import {
  REMOTE_PROVIDERS,
  type RemoteProvider,
} from "../../src/features/connections/model/protocol";

/** Engine test fixtures shared by the engine test files. Each file drains `cleanups` in its own afterEach. */
export const cleanups: Array<() => Promise<void> | void> = [];

export async function setup(
  harness: RemoteProvider = "codex",
  overrides: Partial<Record<RemoteProvider, HostProvider>> = {},
  managedTurns?: ManagedTurnHistoryAdapter,
  shell?: ConstructorParameters<typeof HostEngine>[2],
) {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-engine-test-"));
  const store = new HostStore(join(directory, "host.db"));
  const project = await store.addProject(directory, "Test");
  const turns: Array<{ input: SendTurnInput; finish: () => void }> = [];
  const starts = new Map<number, { promise: Promise<void>; resolve: () => void }>();
  // A durable command receipt precedes real file-history/Git preparation. Wait
  // on the fake provider's actual admission, under the unchanged test timeout.
  const waitForTurnStart = (count = 1): Promise<void> => {
    if (turns.length >= count) return Promise.resolve();
    let signal = starts.get(count);
    if (!signal) {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      starts.set(count, (signal = { promise, resolve }));
    }
    return signal.promise;
  };
  const provider: HostProvider = {
    send: vi.fn(
      (input) =>
        new Promise<void>((resolve) => {
          turns.push({ input, finish: resolve });
          starts.get(turns.length)?.resolve();
          starts.delete(turns.length);
        }),
    ),
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
  provider.retireOriginal = provider.stop;
  const engine = new HostEngine(
    store,
    Object.fromEntries(REMOTE_PROVIDERS.map((id) => [id, overrides[id] ?? provider])),
    shell,
    managedTurns,
  );
  let expectedShutdownFailure: unknown;
  await engine.ready;
  const created = await engine.command({
    type: "create",
    commandId: "create",
    workspaceMode: "current",
    projectId: project.id,
    harness,
    model: `${harness}:test`,
    runtimeMode: "supervised",
  });
  cleanups.push(async () => {
    let failure: unknown;
    try {
      await engine.close();
    } catch (error) {
      if (error !== expectedShutdownFailure) failure = error;
    }
    await store.close();
    rmSync(directory, { recursive: true, force: true });
    if (failure) throw failure;
  });
  return {
    directory,
    store,
    provider,
    project,
    engine,
    turns,
    waitForTurnStart,
    observeExpectedShutdownFailure: async () => {
      const result = await engine.close().then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(result).toBeInstanceOf(AggregateError);
      expectedShutdownFailure = result;
      return result;
    },
    id: created.sessionId,
  };
}

export function managedHistory() {
  const records = new Map<string, TurnGitRecord>();
  const snapshot: TurnGitSnapshot = {
    head: "a".repeat(40),
    index: "b".repeat(40),
    worktree: "c".repeat(40),
    indexMetadataId: "metadata",
    paths: [],
    capturedAt: 1,
  };
  const adapter: ManagedTurnHistoryAdapter = {
    exactGitRewindEnabled: () => true,
    workspaceForSession: vi.fn(async () => ({ workspaceId: "managed" })),
    assertWritable: vi.fn(async () => {}),
    history: {
      begin: vi.fn(async (request) => {
        const record: TurnGitRecord = {
          ...request,
          branchRef: "refs/heads/bycoda/s/test",
          before: { status: "complete", snapshot },
        };
        records.set(request.userBlockId, record);
        return record;
      }),
      end: vi.fn(async (request) => {
        const record = records.get(request.userBlockId)!;
        record.after = { status: "complete", snapshot };
        return record;
      }),
      get: vi.fn(async (_workspace, turn) => records.get(turn) ?? null),
      list: vi.fn(async () => [...records.values()]),
    },
  };
  return { adapter, records };
}
