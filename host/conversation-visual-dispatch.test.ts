import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { HostStore } from "./store";
import { HostEngine } from "./engine";
import { createHostServer } from "./server";
import { HOST_PROTOCOL_VERSION } from "../src/features/connections/model/protocol";

it("routes authenticated visual publication through the real scoped Host dispatcher", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bycoda-visual-dispatch-"));
  const store = new HostStore(join(dir, "host.db"));
  // No provider is run. These lifecycle hooks cannot create a simulated answer.
  const engine = new HostEngine(store, { codex: {
    send: async () => { throw Error("Provider execution forbidden in this test"); },
    stop: async () => {}, cancel: async () => {}, bind: () => {}, approve: () => {}, answer: () => {},
  } });
  const server = await createHostServer(engine, []);
  try {
    await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
    const project = await store.addProject(dir, "Inline test data");
    const session = await engine.command({ type: "create", workspaceMode: "current", commandId: "inline-visual-create", projectId: project.id, harness: "codex", model: "test", runtimeMode: "supervised" });
    const grant = await server.conversationAccess.issueSessionGrant(session.sessionId);
    const html = `<h2>Native sandbox check</h2><button id="count" onclick="this.textContent=Number(this.textContent)+1">0</button><pre id="security"></pre><script>(async()=>{let p='denied';try{void parent.document.body;p='EXPOSED'}catch{};let n='denied';try{await fetch('https://example.invalid/bycoda-inline-probe');n='EXPOSED'}catch{};document.querySelector('#security').textContent=JSON.stringify({parent:p,network:n,native:typeof window.__TAURI_INTERNALS__,height:innerHeight})})()</script><iframe src="https://example.invalid/frame"></iframe>`;
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/rpc`, { method: "POST", headers: { Authorization: `Bearer ${grant.token}` }, body: JSON.stringify({ version: HOST_PROTOCOL_VERSION, environmentId: store.environmentId, method: "conversation.tools.call", params: { action: "visuals.render", input: { title: "Native inline visual", html, height: 400 } } }) });
    const value = await response.json() as any;
    expect(value.error).toBeUndefined();
    expect(value.result.bycodaInlineVisual.html).toBe(html);
    const out = resolve("temp/verification/2026-10-29-redesign-remainder/inline");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "host-published.json"), JSON.stringify({ evidence: "real-authenticated-host-dispatch; no provider execution", result: value.result }, null, 2));
  } finally {
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
    await server.closeResources(); await engine.close(); await store.close();
    if (!dir.startsWith(join(tmpdir(), "bycoda-visual-dispatch-"))) throw Error("Unsafe test cleanup");
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);
