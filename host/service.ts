import { execFileAsync as exec } from "../src/shared/lib/processExecution.node";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { runPowerShell, windowsTaskScript, windowsUninstallScript } from "./windows";
import { preparePosixNode } from "./node-engine";

const LABEL = "com.bycoda.host";
type ServiceOptions = {
  directory: string;
  port: number;
  executable: string;
  entry: string;
};

export async function connectionInfo(
  directory: string,
  expectedRuntime?: string,
): Promise<{ port: number; pid: number }> {
  const state = JSON.parse(await readFile(join(directory, "running.json"), "utf8"));
  if (
    !Number.isInteger(state.port) ||
    state.port < 1 ||
    state.port > 65535 ||
    typeof state.secret !== "string" ||
    !/^[\w-]{43}$/.test(state.secret)
  ) {
    throw new Error("Invalid host state");
  }
  const response = await fetch(`http://127.0.0.1:${state.port}/lifecycle`, {
    method: "POST",
    headers: { Authorization: `Bearer ${state.secret}` },
    body: JSON.stringify({ action: "status" }),
    signal: AbortSignal.timeout(2000),
  });
  if (!response.ok) throw new Error("Host is not ready");
  if (expectedRuntime) {
    const status = (await response.json()) as { pid?: number; runtime?: string };
    if (status.pid !== state.pid || status.runtime !== expectedRuntime) {
      throw new Error("The installed host runtime is not the one serving requests");
    }
  }
  return { port: state.port, pid: state.pid };
}

const xml = (value: string) =>
  value.replace(
    /[<>&"']/g,
    (char) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[char]!,
  );

export function launchAgent(options: ServiceOptions, path: string): string {
  const args = [
    options.executable,
    options.entry,
    "serve",
    "--data-dir",
    options.directory,
    "--port",
    String(options.port),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array>${args.map((arg) => `<string>${xml(arg)}</string>`).join("")}</array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>10</integer>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path)}</string></dict>
<key>StandardOutPath</key><string>${xml(join(options.directory, "host.log"))}</string>
<key>StandardErrorPath</key><string>${xml(join(options.directory, "host.log"))}</string>
</dict></plist>\n`;
}

// systemd expands % specifiers in both settings; $ variables only in ExecStart.
const unitQuote = (value: string) =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%").replaceAll("\n", "\\n")}"`;
export function systemdUnit(options: ServiceOptions, path: string): string {
  return `[Unit]
Description=Bycoda Host
After=network.target

[Service]
ExecStart=${[options.executable, options.entry, "serve", "--data-dir", options.directory, "--port", String(options.port)].map((value) => unitQuote(value.replaceAll("$", () => "$$"))).join(" ")}
Environment=${unitQuote(`PATH=${path}`)}
Restart=on-failure
RestartSec=5
UMask=0077
KillMode=control-group
TimeoutStopSec=20

[Install]
WantedBy=default.target
`;
}

// SSH sessions may lack the user bus variables systemctl --user needs.
const systemdEnvironment = (uid: number): NodeJS.ProcessEnv => {
  const runtime = process.env.XDG_RUNTIME_DIR ?? `/run/user/${uid}`;
  return {
    ...process.env,
    XDG_RUNTIME_DIR: runtime,
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS ?? `unix:path=${runtime}/bus`,
  };
};

type Run = (command: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<unknown>;

/** Only a confirmed exited PID can bypass an unavailable shutdown endpoint. */
export async function stopWindowsHostForUninstall(
  pid: number,
  stop: () => Promise<void>,
  probe: (pid: number) => unknown = (id) => process.kill(id, 0),
): Promise<boolean> {
  try {
    await stop();
    return true;
  } catch (cause) {
    try {
      probe(pid);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    }
    throw cause;
  }
}

const commandOutput = (result: unknown): string =>
  typeof result === "object" && result !== null && "stdout" in result ? String(result.stdout) : "";

// Only launchd's explicit missing-job response proves absence. Missing domains,
// permissions, transport errors and timeouts must remain actionable failures.
const missingLaunchAgent = (error: unknown): boolean => {
  const details = error as { message?: string; stderr?: string } | undefined;
  return /Could not find service ["']com\.bycoda\.host["'] in domain/.test(
    `${details?.message ?? ""}\n${details?.stderr ?? ""}`,
  );
};

/** The callback resolves after graceful work drain, before unloading launchd. */
export async function stopHostWithServicePolicy(
  pid: number,
  stop: () => Promise<void>,
  system: { platform?: NodeJS.Platform; uid?: number; run?: Run } = {},
): Promise<void> {
  if ((system.platform ?? process.platform) !== "darwin") return stop();
  const run: Run =
    system.run ??
    ((command, args) => exec(command, args, { timeout: 30_000, maxBuffer: 128 * 1024 }));
  const target = `gui/${system.uid ?? process.getuid?.() ?? userInfo().uid}/${LABEL}`;
  let job: string;
  try {
    job = commandOutput(await run("launchctl", ["print", target]));
  } catch (error) {
    if (!missingLaunchAgent(error)) throw error;
    return stop();
  }
  // A manually started host must not disable another host's registered job.
  if (Number(job.match(/^\s*pid = (\d+)\s*$/m)?.[1]) !== pid) return stop();
  await run("launchctl", ["disable", target]);
  try {
    await stop();
  } catch (cause) {
    // If graceful shutdown was rejected, retain the job's crash recovery.
    await run("launchctl", ["enable", target]);
    throw cause;
  }
  // Disable alone does not unload an already registered KeepAlive job. The host
  // has drained its work now, so bootout cannot interrupt active turns.
  let bootoutError: unknown;
  try {
    await run("launchctl", ["bootout", target]);
  } catch (error) {
    bootoutError = error;
  }
  try {
    await run("launchctl", ["print", target]);
  } catch (error) {
    if (missingLaunchAgent(error)) return;
    throw error;
  }
  throw bootoutError ?? new Error("launchd still has the stopped host registered; retry stop");
}

/**
 * Removes the login service or scheduled task so the host no longer starts
 * automatically, stopping it where the service manager owns the process.
 * Never deletes the data directory: sessions, logs and device credentials stay
 * until the user removes them explicitly. Returns follow-up notes.
 */
export async function uninstallService(
  system: {
    platform?: NodeJS.Platform;
    home?: string;
    uid?: number;
    run?: Run;
    powershell?: (script: string) => Promise<unknown>;
  } = {},
): Promise<string[]> {
  const platform = system.platform ?? process.platform;
  const home = system.home ?? homedir();
  const run: Run =
    system.run ??
    ((command, args, env = process.env) =>
      exec(command, args, { env, timeout: 30_000, maxBuffer: 128 * 1024 }));
  if (platform === "darwin") {
    const target = `gui/${system.uid ?? process.getuid?.() ?? userInfo().uid}/${LABEL}`;
    try {
      let bootoutError: unknown;
      try {
        await run("launchctl", ["bootout", target]);
      } catch (error) {
        bootoutError = error;
      }
      try {
        await run("launchctl", ["print", target]);
      } catch (error) {
        if (!missingLaunchAgent(error)) throw error;
        // A failed bootout is safe only once launchd confirms this job is absent.
        await rm(join(home, "Library/LaunchAgents", `${LABEL}.plist`), { force: true });
        return [];
      }
      throw bootoutError ?? new Error("launchd still has the host registered");
    } catch (cause) {
      throw new Error(
        "Could not verify LaunchAgent removal; its definition was preserved. Check launchctl and retry service uninstall.",
        { cause },
      );
    }
  }
  if (platform === "linux") {
    const user = userInfo();
    const env = systemdEnvironment(system.uid ?? user.uid);
    const file = join(home, ".config/systemd/user/bycoda-host.service");
    const definition = await readFile(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return undefined;
    });
    const inspect = async () => {
      const output = commandOutput(
        await run(
          "systemctl",
          [
            "--user",
            "show",
            "bycoda-host.service",
            "--property=LoadState",
            "--property=ActiveState",
            "--property=UnitFileState",
          ],
          env,
        ),
      );
      const values = Object.fromEntries(
        output
          .trim()
          .split(/\r?\n/)
          .map((line) => line.split("=")),
      );
      if (values.ActiveState !== "inactive" && values.ActiveState !== "failed")
        throw new Error("systemd did not confirm the host is stopped");
      if (values.LoadState !== "not-found" && values.UnitFileState !== "disabled")
        throw new Error("systemd did not confirm the host is disabled");
      return values;
    };
    let removed = false;
    try {
      try {
        await run("systemctl", ["--user", "disable", "--now", "bycoda-host.service"], env);
      } catch (error) {
        // An already-absent unit is harmless only when the manager confirms it.
        if ((await inspect()).LoadState !== "not-found") throw error;
      }
      await inspect();
      await rm(file, { force: true });
      removed = true;
      await run("systemctl", ["--user", "daemon-reload"], env);
      if ((await inspect()).LoadState !== "not-found")
        throw new Error("systemd still has the host registered");
    } catch (cause) {
      if (removed && definition !== undefined) {
        await writeFile(file, definition, { mode: 0o600 });
      }
      throw new Error(
        "Could not verify systemd service removal; its definition was preserved. Check the user bus and systemctl, then retry service uninstall.",
        { cause },
      );
    }
    return [
      `Lingering is still enabled for ${user.username}; other user services may rely on it. To turn it off: loginctl disable-linger ${user.username}`,
    ];
  }
  if (platform === "win32") {
    await (system.powershell ?? runPowerShell)(windowsUninstallScript());
    return [];
  }
  throw new Error("bycoda Host supports Windows, Linux and macOS");
}

export async function installService(
  options: ServiceOptions,
): Promise<{ port: number; pid: number }> {
  // Never replace a running host: connecting must not interrupt agent turns.
  try {
    return await connectionInfo(options.directory);
  } catch {
    /* install/start */
  }
  const path = [
    ...new Set([
      process.env.PATH ?? "",
      join(homedir(), ".local/bin"),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    ]),
  ].join(":");
  const run = async (command: string, args: string[], env = process.env) =>
    exec(command, args, { env, timeout: 15_000, maxBuffer: 128 * 1024 });
  if (process.platform === "darwin") {
    const domain = `gui/${process.getuid!()}`;
    try {
      await run("launchctl", ["print", domain]);
    } catch {
      throw new Error(
        "Sign in at the Mac's desktop once, then reconnect. bycoda Host runs as a login service; keep the Mac signed in and awake.",
      );
    }
    const folder = join(homedir(), "Library/LaunchAgents");
    const file = join(folder, `${LABEL}.plist`);
    await mkdir(folder, { recursive: true });
    let loaded = false;
    try {
      await run("launchctl", ["print", `${domain}/${LABEL}`]);
      loaded = true;
    } catch {
      /* first install */
    }
    if (loaded) {
      // A loaded service already has an owner and executable. Start it without
      // rewriting its configuration or sending a kill/restart command.
      await run("launchctl", ["enable", `${domain}/${LABEL}`]);
      await run("launchctl", ["kickstart", `${domain}/${LABEL}`]);
    } else {
      const executable = await preparePosixNode(options.executable, options.directory);
      await writeFile(file, launchAgent({ ...options, executable }, path), { mode: 0o600 });
      await run("launchctl", ["enable", `${domain}/${LABEL}`]);
      await run("launchctl", ["bootstrap", domain, file]);
    }
  } else if (process.platform === "linux") {
    const user = userInfo();
    const env = systemdEnvironment(user.uid);
    try {
      await run("loginctl", ["enable-linger", user.username, "--no-ask-password"], env);
      const linger = await run(
        "loginctl",
        ["show-user", user.username, "--property=Linger", "--value"],
        env,
      );
      if (linger.stdout.trim() !== "yes") throw new Error("linger disabled");
    } catch {
      throw new Error(
        `This host needs systemd user services and lingering to keep sessions running after SSH disconnects. An administrator can enable it with: sudo loginctl enable-linger ${user.username}`,
      );
    }
    const folder = join(homedir(), ".config/systemd/user");
    await mkdir(folder, { recursive: true });
    const file = join(folder, "bycoda-host.service");
    try {
      await readFile(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const executable = await preparePosixNode(options.executable, options.directory);
      await writeFile(file, systemdUnit({ ...options, executable }, path), { mode: 0o600 });
    }
    await run("systemctl", ["--user", "daemon-reload"], env);
    await run("systemctl", ["--user", "enable", "--now", "bycoda-host.service"], env);
  } else if (process.platform === "win32") {
    await runPowerShell(windowsTaskScript(options, process.env.PATH ?? ""));
  } else {
    throw new Error("bycoda Host supports Windows, Linux and macOS");
  }
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      return await connectionInfo(options.directory);
    } catch {
      /* starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    process.platform === "win32"
      ? `The host task did not start. Sign in to the Windows desktop as the SSH user and keep that account signed in (locking is fine), then reconnect. Check Task Scheduler and ${join(options.directory, "host.log")}.`
      : `The host service was installed but did not start. Check ${join(options.directory, "host.log")}.`,
  );
}
