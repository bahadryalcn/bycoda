import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { AddRemoteProjectDialog } from "../../../src/features/connections/ui/AddRemoteProjectDialog";
import { ProjectTunnelDialog } from "../../../src/features/connections/ui/ProjectTunnelDialog";
import { AccountPairDialog } from "../../../src/features/connections/ui/AccountPairDialog";
import { accountController } from "../../../src/features/account/model/accountService";
import { isSignedIn } from "../../../src/features/account/model/accountState";
import { useAccountState } from "../../../src/features/account";
import type { AccountPairPlan } from "../../../src/features/connections/model/accountDesktopPairing";
import { applyThemePreference } from "../../../src/features/settings/model/appearance";
import { languageReady } from "../../../src/shared/i18n";
import "../../../src/styles/index.css";

// Synthetic machines, folders and tunnels over a memory-only IPC. Nothing reaches a real Host,
// SSH target or account service. `?dialog=` picks the state; unknown commands answer null.
// The pairing states need the in-memory account server: build with VITE_BYCODA_ACCOUNT_MOCK=1.
localStorage.setItem("bycoda.language", "en");
Object.assign(globalThis, { isTauri: true });
mockWindows("main");
const params = new URLSearchParams(location.search);
applyThemePreference(params.get("theme") === "light" ? "light" : "dark");
const dialog = params.get("dialog") ?? "add-remote";

const studio = {
  id: "fixture-studio",
  name: "Studio PC",
  endpoint: "http://192.168.1.40:3777",
  environmentId: "fixture-env-studio",
};
const buildServer = {
  id: "fixture-build",
  name: "build-server-eu",
  endpoint: "http://127.0.0.1:41000",
  environmentId: "fixture-env-build",
  ssh: { target: "me@build.example.test", remotePort: 3777 },
};
const local = {
  id: "fixture-local",
  name: "This computer",
  localHost: true,
  endpoint: "http://127.0.0.1:3776",
  environmentId: "fixture-env-local",
};
const machines =
  dialog === "add-remote-empty"
    ? []
    : dialog === "add-remote-two"
      ? [studio, buildServer]
      : [studio];

const tunnelId = (n: number) => `00000000-0000-0000-0000-00000000000${n}`;
const tunnelRows = [
  {
    id: tunnelId(1),
    provider: "cloudflare",
    target: "dev-server",
    state: "ready",
    localUrl: "http://127.0.0.1:3000",
    startedAt: Date.now() - 18 * 60_000,
    canStop: true,
    publicUrl: "https://quiet-river-1234.trycloudflare.com",
  },
  {
    id: tunnelId(2),
    provider: "ngrok",
    target: "dev-server",
    state: "starting",
    localUrl: "http://127.0.0.1:5173",
    startedAt: Date.now() - 4_000,
    canStop: true,
  },
  {
    id: tunnelId(3),
    provider: "cloudflare",
    target: "host",
    state: "error",
    localUrl: "http://127.0.0.1:3776",
    startedAt: Date.now() - 3_600_000,
    canStop: false,
    issue: "startup-timeout",
  },
];
const directories: Record<string, { path: string; parent: string | null; entries: string[] }> = {
  "/home/me": {
    path: "/home/me",
    parent: "/home",
    entries: ["code", "Documents", "Downloads", "notes", "projects"],
  },
  "/home/me/code": {
    path: "/home/me/code",
    parent: "/home/me",
    entries: ["bycoda", "dotfiles", "my-app", "website", "scratch"],
  },
};
const dirFor = (path: string) => {
  const entry = directories[path] ?? directories["/home/me"];
  return {
    home: "/home/me",
    roots: [{ name: "/", path: "/" }],
    path: entry.path,
    parent: entry.parent,
    entries: entry.entries.map((name) => ({ name, path: `${entry.path}/${name}` })),
  };
};

mockIPC(
  (command, args) => {
    const call = args as { machineId?: string; method?: string; params?: { path?: string } };
    if (command === "remote_machines") return dialog.startsWith("tunnel-offline") ? [] : machines;
    if (command === "local_host_connect") return dialog === "tunnel-offline" ? null : local;
    if (command !== "remote_request") return null;
    switch (call.method) {
      case "environment.describe":
        return {
          environmentId: call.machineId === local.id ? local.environmentId : studio.environmentId,
          providers: ["codex", "claude"],
          capabilities:
            dialog === "tunnel-update" ? ["workspace.run"] : ["workspace.run", "tunnels.manage"],
        };
      case "projects.list":
        return [{ id: "fixture-app", cwd: "/fixture/app", name: "app" }];
      case "projects.browse":
        if (dialog === "add-remote-error")
          throw "RPC_WS_BLOCKED: Host authentication was refused by build-server-eu";
        return dirFor(call.params?.path ?? "/home/me");
      case "tunnels.status":
        return {
          environmentId: local.environmentId,
          hostLocalUrl: "http://127.0.0.1:3776",
          publicReachability: "unverified",
          providers: [
            { provider: "cloudflare", installed: true, credential: "not-required" },
            { provider: "ngrok", installed: true, credential: "missing" },
            { provider: "tailscale", installed: true, credential: "not-required" },
          ],
          tunnels: dialog === "tunnel-rows" ? tunnelRows : [],
        };
      default:
        return null;
    }
  },
  { shouldMockEvents: true },
);

const plan: AccountPairPlan = {
  deviceId: "dev_fixture_studio",
  environmentId: studio.environmentId,
  name: "Studio PC",
  routes: ["https://studio.example.ts.net"],
};

function Pair() {
  const state = useAccountState();
  const [started, setStarted] = useState(dialog === "pair-signedout");
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- signs the in-memory mock account in once so the pairing request can start.
  useEffect(() => {
    if (dialog === "pair-signedout") return;
    void accountController()
      .start()
      .then(() => accountController().signIn());
  }, []);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- waits for the mock sign-in before mounting the dialog.
  useEffect(() => {
    if (isSignedIn(state)) setStarted(true);
  }, [state]);
  return started ? <AccountPairDialog plan={plan} onClose={() => {}} onPaired={() => {}} /> : null;
}

function Fixture() {
  if (dialog.startsWith("add-remote"))
    return <AddRemoteProjectDialog onCancel={() => {}} onOpen={() => {}} />;
  if (dialog.startsWith("tunnel"))
    return <ProjectTunnelDialog cwd="/fixture/app" localUrl="3000" onClose={() => {}} />;
  return <Pair />;
}

await languageReady;
createRoot(document.getElementById("root")!).render(
  <main className="min-h-dvh bg-background-base text-content">
    <Fixture />
  </main>,
);
