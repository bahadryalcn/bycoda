import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { HostStore } from "../store";
import { HostEngine } from "../engine";
import { createHostServer } from "../server";

it("hides and rejects Room-only tools for real Session and voice Session HTTP sources", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-room-catalog-"));
  const store = new HostStore(join(directory, "host.db"));
  const engine = new HostEngine(store, {
    codex: {
      send: async () => {},
      stop: async () => {},
      cancel: async () => {},
      bind: () => {},
      approve: () => {},
      answer: () => {},
    },
  });
  const project = await engine.openProject(directory);
  const server = await createHostServer(engine, ["codex"]);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const owner = await store.issueDevice("fixture");
    const created = await engine.command({
      type: "create",
      workspaceMode: "current",
      commandId: "catalog-fixture",
      projectId: project.id,
      harness: "codex",
      model: "gpt",
      runtimeMode: "supervised",
    });
    const grant = await server.conversationAccess.issueSessionGrant(created.sessionId!);
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`;
    const call = async (method: string, params: object, token: string) =>
      (await (
        await fetch(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({ version: 1, environmentId: store.environmentId, method, params }),
        })
      ).json()) as { result?: any; error?: string };
    const direct = await call(
      "conversation.tools.call",
      { action: "tools.list", input: {} },
      grant.token,
    );
    expect(
      direct.result.tools.some(
        (tool: { action: string }) => tool.action === "workspace.projects.select",
      ),
    ).toBe(false);
    expect(
      direct.result.tools.some((tool: { action: string }) => tool.action === "files.read"),
    ).toBe(true);
    const denied = await call(
      "conversation.tools.call",
      { action: "workspace.projects.select", input: { requestId: "x" } },
      grant.token,
    );
    expect(denied.error).toContain("Room source");
    const voice = await call(
      "voice.tools.list",
      { projectId: project.id, sessionId: created.sessionId },
      owner.token,
    );
    expect(
      voice.result.tools.some(
        (tool: { family: string; action: string }) =>
          tool.family === "conversation" && tool.action === "workspace.projects.select",
      ),
    ).toBe(false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await server.closeResources();
    await engine.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
