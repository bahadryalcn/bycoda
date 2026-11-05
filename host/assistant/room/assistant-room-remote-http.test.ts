import { expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

const fixture = vi.hoisted(() => ({ replies: [] as string[], prompts: [] as string[] }));
vi.mock("../core/assistant-text", async (original) => ({
  ...(await original<typeof import("../core/assistant-text")>()),
  assistantText: () => async (_profile: unknown, prompt: string) => {
    fixture.prompts.push(prompt);
    return {
      text: fixture.replies.shift() ?? JSON.stringify({ type: "final", text: "Finished" }),
      tokens: 20,
    };
  },
}));
import { HostStore } from "../../store";
import { HostEngine } from "../../engine";
import { createHostServer } from "../../server";

it("routes a projectless Global Room remote operation through the original Native relay and retains uncertain identity", async () => {
  const directory = mkdtempSync(join(tmpdir(), "room-remote-http-"));
  const store = new HostStore(join(directory, "host.db"));
  const engine = new HostEngine(store, {});
  const server = await createHostServer(engine, ["codex"]);
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const device = await store.issueDevice("Fixture owner"),
      endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
    const rpc = async (method: string, params: Record<string, unknown>) =>
      (await (
        await fetch(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${device.token}` },
          body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }),
        })
      ).json()) as { result?: any; error?: unknown };
    const snapshot = (await rpc("assistant.request", { op: "snapshot" })).result.snapshot;
    expect(
      (
        await rpc("assistant.request", {
          op: "profile.update",
          expectedVersion: snapshot.profile.version,
          patch: {
            name: "Assistant",
            enabled: true,
            setupComplete: true,
            autonomy: "report",
            dailyTokenBudget: 100000,
            execution: {
              harness: "codex",
              model: "fixture",
              modelSettings: {},
              runtimeMode: "supervised",
              maxRunMinutes: 60,
            },
          },
        })
      ).error,
    ).toBeUndefined();
    const threadId = (await rpc("assistant.request", { op: "threads.open" })).result.thread.id;
    fixture.replies = [
      JSON.stringify({
        type: "tool",
        family: "conversation",
        action: "remote.call",
        input: {
          grantId: "fixture-grant",
          requestId: "ignored",
          action: "tasks.update",
          input: { taskId: "fixture-task", title: "Reviewed" },
        },
      }),
    ];
    await rpc("conversation.desktop.take", {});
    const turn = rpc("assistant.request", {
      op: "threads.send",
      threadId,
      via: "text",
      text: "Update the remote task",
      idempotencyKey: "remote-turn",
    }).catch((error) => ({ error }));
    let requests: any[] = [];
    for (let attempt = 0; attempt < 300 && !requests.length; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      requests = (await rpc("conversation.desktop.take", {})).result ?? [];
    }
    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request).toMatchObject({
      action: "delegation.call",
      threadId,
      environmentId: store.environmentId,
      input: {
        grantId: "fixture-grant",
        action: "tasks.update",
        input: { taskId: "fixture-task", title: "Reviewed" },
      },
    });
    expect(request).not.toHaveProperty("sessionId");
    expect(request).not.toHaveProperty("projectId");
    expect(request).not.toHaveProperty("targetProjectCwd");
    const authorization = await rpc("native.services.conversation.desktop.authorize", {
      id: request.id,
      action: request.action,
    });
    expect(authorization).toMatchObject({ result: { authorized: true } });
    const original = request.input.requestId;
    expect(
      (
        await rpc("conversation.desktop.finish", {
          id: request.id,
          error: "Fixture acknowledgement lost",
        })
      ).error,
    ).toBeUndefined();
    const result = await turn;
    expect(String(result.error)).toContain(original);
    fixture.replies = [
      JSON.stringify({
        type: "tool",
        family: "conversation",
        action: "remote.result",
        input: { requestId: original },
      }),
      JSON.stringify({ type: "final", text: "Outcome uncertain." }),
    ];
    const recovery = await rpc("assistant.request", {
      op: "threads.send",
      threadId,
      via: "text",
      text: "Inspect that original request",
      idempotencyKey: "remote-recovery",
    });
    expect(recovery.error).toBeUndefined();
    expect(recovery.result.messages.at(-1).text).toBe("Outcome uncertain.");
    expect(fixture.prompts.at(-1)).toContain('"state":"uncertain"');
    expect(fixture.prompts.at(-1)).toContain(original);
    expect((await rpc("conversation.desktop.take", {})).result ?? []).toHaveLength(0);
    const rows = await store.db
      .prepare("SELECT value FROM metadata WHERE key LIKE 'room-remote:%'")
      .all();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(String(rows[0].value))).toMatchObject({ state: "uncertain" });
    expect(String(rows[0].value)).not.toContain("fixture-task");
    fixture.prompts = [];
    fixture.replies = [
      JSON.stringify({
        type: "tool",
        family: "conversation",
        action: "remote.call",
        input: {
          grantId: "fixture-grant",
          requestId: "placeholder",
          action: "tasks.get",
          input: { taskId: "second" },
        },
      }),
    ];
    const readTurn = rpc("assistant.request", {
      op: "threads.send",
      threadId,
      via: "text",
      text: "Read the remote task",
      idempotencyKey: "remote-read",
    }).catch((error) => ({ error }));
    let readRequests: any[] = [];
    for (let attempt = 0; attempt < 300 && !readRequests.length; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      readRequests = (await rpc("conversation.desktop.take", {})).result ?? [];
    }
    expect(readRequests).toHaveLength(1);
    const readRequest = readRequests[0];
    expect(readRequest).toMatchObject({
      action: "delegation.call",
      threadId,
      environmentId: store.environmentId,
    });
    fixture.replies = [JSON.stringify({ type: "final", text: "Read completed." })];
    expect(
      (
        await rpc("conversation.desktop.finish", {
          id: readRequest.id,
          result: {
            value: { title: "PRIVATE-REMOTE-FIXTURE" },
            targetEnvironmentId: "target",
            projectId: "target-project",
            observedAt: 1,
            remoteContext: "unverified",
          },
        })
      ).error,
    ).toBeUndefined();
    const readResult = await readTurn;
    expect(readResult.error).toBeUndefined();
    fixture.prompts = [];
    fixture.replies = [
      JSON.stringify({
        type: "tool",
        family: "conversation",
        action: "remote.result",
        input: { requestId: readRequest.input.requestId },
      }),
      JSON.stringify({ type: "final", text: "Receipt inspected." }),
    ];
    const inspect = await rpc("assistant.request", {
      op: "threads.send",
      threadId,
      via: "text",
      text: "Inspect that receipt",
      idempotencyKey: "remote-read-recovery",
    });
    expect(inspect.error).toBeUndefined();
    expect(fixture.prompts.at(-1)).toContain('"resultRetained":false');
    expect(fixture.prompts.at(-1)).not.toContain("PRIVATE-REMOTE-FIXTURE");
  } finally {
    fixture.replies = [];
    fixture.prompts = [];
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await server.closeResources();
    await engine.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  }
}, 30000);
