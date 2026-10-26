import { createServer, type Server } from "node:net";
import { afterEach, expect, it } from "vitest";
import { DevPortLeases, portLeaseEnvironment } from "./dev-port-leases";

const services: DevPortLeases[] = [];
const sockets: Server[] = [];
const service = () => {
  const leases = new DevPortLeases();
  services.push(leases);
  return leases;
};
const listen = (port = 0) =>
  new Promise<Server>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      sockets.push(server);
      resolve(server);
    });
  });
const port = (server: Server) => (server.address() as { port: number }).port;
afterEach(async () => {
  for (const leases of services.splice(0))
    for (const workspace of ["a", "b"])
      for (const lease of await leases.list(workspace)) await leases.release(lease.id);
  for (const server of sockets.splice(0))
    if (server.listening) await new Promise<void>((done) => server.close(() => done()));
});

it("reserves distinct real ports across concurrent workspaces and rejects an external bind", async () => {
  const leases = service();
  const [a, b] = await Promise.all(
    ["a", "b"].map((workspaceId) =>
      leases.acquire({ workspaceId, runId: "run", kinds: ["vite", "hmr", "host", "cdp"] }),
    ),
  );
  const all = [...Object.values(a.ports), ...Object.values(b.ports)];
  expect(new Set(all).size).toBe(8);
  await expect(listen(a.ports.vite)).rejects.toMatchObject({ code: "EADDRINUSE" });
  expect(portLeaseEnvironment(a)).toMatchObject({
    BYCODA_VITE_PORT: String(a.ports.vite),
    BYCODA_DEV_URL: `http://127.0.0.1:${a.ports.vite}`,
    BYCODA_WEBVIEW_DEBUG_PORT: String(a.ports.cdp),
  });
});

it("skips occupied preferred ports without signalling their owner", async () => {
  const external = await listen();
  const lease = await service().acquire({
    workspaceId: "a",
    runId: "run",
    kinds: ["vite"],
    preferred: { vite: port(external) },
  });
  expect(lease.ports.vite).not.toBe(port(external));
  expect(external.listening).toBe(true);
});

it("hands off only requested sockets while keeping the lease unavailable to another workspace", async () => {
  const leases = service();
  const a = await leases.acquire({ workspaceId: "a", runId: "run", kinds: ["vite", "hmr"] });
  await leases.handoff(a.id, ["vite"]);
  const actual = await listen(a.ports.vite);
  expect(port(actual)).toBe(a.ports.vite);
  await expect(listen(a.ports.hmr)).rejects.toMatchObject({ code: "EADDRINUSE" });
  const b = await leases.acquire({
    workspaceId: "b",
    runId: "run",
    kinds: ["vite"],
    preferred: { vite: a.ports.vite },
  });
  expect(b.ports.vite).not.toBe(a.ports.vite);
  const copy = (await leases.list("a"))[0];
  copy.ports.vite = 1;
  expect((await leases.list("a"))[0].ports.vite).toBe(a.ports.vite);
});

it("reallocates after a real bind race and retains the successful lease", async () => {
  const leases = service();
  let calls = 0;
  let stolen: Server | undefined;
  const result = await leases.launchWithRetry(
    { workspaceId: "a", runId: "run", kinds: ["vite"] },
    async (lease) => {
      calls++;
      if (calls === 1) {
        stolen = await listen(lease.ports.vite);
        await listen(lease.ports.vite);
      }
      return listen(lease.ports.vite);
    },
  );
  expect(calls).toBe(2);
  expect(port(result.value)).toBe(result.lease.ports.vite);
  expect(stolen!.listening).toBe(true);
  expect(await leases.list("a")).toHaveLength(1);
});

it("releases a failed launch and does not retry unrelated failures", async () => {
  const leases = service();
  let calls = 0;
  await expect(
    leases.launchWithRetry({ workspaceId: "a", runId: "run", kinds: ["vite"] }, async () => {
      calls++;
      throw new Error("Compiler failed");
    }),
  ).rejects.toThrow("Compiler failed");
  expect(calls).toBe(1);
  expect(await leases.list("a")).toEqual([]);
});
