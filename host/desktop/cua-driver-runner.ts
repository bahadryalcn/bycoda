import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { AGENT_DESKTOP_PROTOCOL } from "../../src/shared/model/host-contracts/desktop-control";
import type { DesktopRunner } from "./desktop-control-runner";
import { sameDesktopApp } from "./desktop-control-permission";
import type { CuaDriverClient, CuaToolResult } from "./cua-driver-client";

/**
 * Serves the agent-desktop command lines HostDesktopControl builds through cua-driver's MCP tools
 * and answers in the same envelope, so every gate, receipt, ref grant and Stop path stays shared.
 * Refs are `@c<generation>-<snapshot>:<row>`; a driver restart makes earlier refs foreign.
 */
type Envelope = {
  version: string;
  ok: boolean;
  command: string;
  data?: unknown;
  error?: {
    code: string;
    message?: string;
    disposition?: { delivery: string; retry: string };
  };
};
type Window = {
  window_id: number;
  pid: number;
  app_name: string;
  title: string;
  minimized?: boolean;
  is_on_screen?: boolean;
  z_index?: number | null;
};
type Element = {
  element_token?: string;
  depth?: number;
  role?: string;
  label?: string;
  value?: string;
  enabled?: boolean;
  selected?: boolean;
  actions?: string[];
};

const SNAPSHOT_MAX_ELEMENTS = 600;
const SCREENSHOT_MAX_DIMENSION = 1280;
const UNSUPPORTED = new Set([
  "check",
  "uncheck",
  "collapse",
  "scroll-to",
  "focus",
  "hover",
  "drag",
]);
const KEY_ALIASES: Record<string, string> = {
  enter: "return",
  esc: "escape",
  control: "ctrl",
  cmd: "win",
  command: "win",
  meta: "win",
  super: "win",
  windows: "win",
  option: "alt",
  del: "delete",
  pgup: "pageup",
  pgdn: "pagedown",
  spacebar: "space",
};

class CommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const text = (result: CuaToolResult) =>
  (result.content ?? [])
    .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
    .join("\n")
    .slice(0, 300);

function flag(args: string[], name: string) {
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--") break;
    if (args[index].startsWith(`--${name}=`)) return args[index].slice(name.length + 3);
    if (args[index] === `--${name}`) return args[index + 1];
  }
  return undefined;
}
const positional = (args: string[]) => {
  const split = args.indexOf("--");
  return split < 0 ? [] : args.slice(split + 1);
};

function pngSize(data: string) {
  const bytes = Buffer.from(data, "base64");
  if (bytes.length < 24 || bytes.toString("ascii", 12, 16) !== "IHDR")
    throw new CommandError("invalid_image", "cua-driver returned an invalid screenshot.");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** `ctrl+shift+s` → `["ctrl","shift","s"]`, with common aliases mapped to cua-driver names. */
export function cuaKeys(combo: string) {
  return combo
    .toLowerCase()
    .split(/\s*\+\s*/)
    .filter(Boolean)
    .map((key) => KEY_ALIASES[key] ?? key);
}

/** Converts a delivered or refused cua-driver action into the agent-desktop disposition. */
export function cuaActionEnvelope(command: string, result: CuaToolResult): Envelope {
  const content = result.structuredContent ?? {};
  if (result.isError) {
    const refusal = content.refusal as { code?: string } | undefined;
    const refused = content.status === "refused";
    return {
      version: AGENT_DESKTOP_PROTOCOL,
      ok: false,
      command,
      error: {
        code: refusal?.code ?? (refused ? "refused" : "action_failed"),
        message: text(result),
        disposition: refused
          ? { delivery: "not_delivered", retry: "safe" }
          : { delivery: "delivery_uncertain", retry: "unsafe" },
      },
    };
  }
  // The driver sent input but saw no effect and asks for foreground (physical) delivery.
  const escalation = content.escalation as { reason?: unknown } | undefined;
  if (typeof escalation?.reason === "string")
    return {
      version: AGENT_DESKTOP_PROTOCOL,
      ok: false,
      command,
      error: {
        code: escalation.reason,
        message: `${text(result)} Take a fresh snapshot before retrying; physical input can deliver it in the foreground.`,
        disposition: { delivery: "delivery_uncertain", retry: "unsafe" },
      },
    };
  const effect = typeof content.effect === "string" ? content.effect : undefined;
  const verified = effect === "confirmed" || effect === "verified";
  return {
    version: AGENT_DESKTOP_PROTOCOL,
    ok: true,
    command,
    data: {
      ...(effect ? { effect } : {}),
      summary: text(result),
      disposition: {
        delivery: verified ? "delivered_verified" : "delivered_unverified",
        retry: "unsafe",
      },
    },
  };
}

/** Elements arrive depth-first with a `depth`; the shared renderer expects nested children. */
export function cuaTree(elements: Element[], publicId: string, title: string) {
  const root: Record<string, unknown> & { children: unknown[] } = {
    role: "window",
    name: title,
    children: [],
  };
  const stack: { depth: number; node: { children: unknown[] } }[] = [{ depth: -1, node: root }];
  for (const element of elements) {
    const row = element.element_token?.split(":")[1];
    const states = [
      ...(element.enabled === false ? ["disabled"] : []),
      ...(element.selected ? ["selected"] : []),
    ];
    const node = {
      ...(row ? { ref_id: `@${publicId}:${row}` } : {}),
      role: element.role ?? "unknown",
      ...(element.label ? { name: element.label } : {}),
      ...(element.value !== undefined && element.value !== null ? { value: element.value } : {}),
      ...(states.length ? { states } : {}),
      children: [] as unknown[],
    };
    const depth = element.depth ?? 0;
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
    stack[stack.length - 1].node.children.push(node);
    stack.push({ depth, node });
  }
  return root;
}

export function createCuaDriverRunner(
  client: CuaDriverClient,
  platform: NodeJS.Platform = process.platform,
): DesktopRunner {
  const publicId = (snapshotId: string) => `c${client.generation}-${snapshotId}`;
  /** `@c2-s0000000a:7` → `s0000000a:7`, only for refs minted by the running process. */
  const token = (ref: string) => {
    const match = /^@c(\d+)-(s[0-9a-f]{8}):(\d+)$/.exec(ref);
    if (!match || Number(match[1]) !== client.generation)
      throw new CommandError(
        "stale_element_token",
        "The desktop ref came from an earlier driver run; take a fresh snapshot.",
      );
    return `${match[2]}:${match[3]}`;
  };

  return async (binary, rawArgs, options) => {
    const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]);
    const call = async (name: string, input: Record<string, unknown>) =>
      client.call(binary, name, input, { signal });
    const observe = async (name: string, input: Record<string, unknown>) => {
      const result = await call(name, input);
      if (result.isError)
        throw new CommandError("observation_failed", text(result) || `${name} failed.`);
      return result;
    };
    // The driver's `app` filter matches localized display names; match the executable here.
    const windowsOf = async (app: string) => {
      const result = await observe("list_windows", {});
      return ((result.structuredContent?.windows ?? []) as Window[]).filter(
        (window) => sameDesktopApp(window.app_name, app, platform) && window.title.trim() !== "",
      );
    };
    /** The driver resolves a bare name fuzzily ("notepad" can open Notepad++); require an exact app. */
    const launchTarget = async (name: string): Promise<Record<string, string>> => {
      const executable = /\.exe$/i.test(name) ? name : `${name}.exe`;
      const windows = process.env.SystemRoot ?? "C:\\Windows";
      for (const path of [join(windows, "System32", executable), join(windows, executable)])
        if (
          await stat(path).then(
            (entry) => entry.isFile(),
            () => false,
          )
        )
          return { path };
      const result = await observe("list_apps", {});
      const apps = (result.structuredContent?.apps ?? []) as {
        name?: string;
        bundle_id?: string | null;
        launch_path?: string | null;
      }[];
      const exe = (value?: string | null) =>
        value ? basename(/^"([^"]+)"/.exec(value)?.[1] ?? value.split(/\s+--?/)[0]) : "";
      const paths = new Set(
        apps
          .filter(
            (app) =>
              !!app.launch_path &&
              ((!!app.name && sameDesktopApp(app.name, name, platform)) ||
                sameDesktopApp(exe(app.bundle_id), executable, platform) ||
                sameDesktopApp(exe(app.launch_path), executable, platform)),
          )
          .map((app) => app.launch_path!),
      );
      if (paths.size !== 1)
        throw new CommandError(
          paths.size ? "ambiguous_app" : "app_not_found",
          paths.size
            ? `More than one installed app matches "${name}".`
            : `No installed app is named "${name}".`,
        );
      return { launch_path: [...paths][0] };
    };
    const windowOf = async (app: string, windowId?: string) => {
      const windows = await windowsOf(app);
      if (windowId) {
        const window = windows.find((item) => String(item.window_id) === windowId);
        if (!window)
          throw new CommandError("window_not_found", "The selected desktop window is unavailable.");
        return window;
      }
      const visible = windows.filter(
        (window) => !window.minimized && window.is_on_screen !== false,
      );
      const ranked = (visible.length ? visible : windows).sort(
        (a, b) => (b.z_index ?? -1) - (a.z_index ?? -1),
      );
      if (!ranked[0]) throw new CommandError("window_not_found", "The app has no open window.");
      return ranked[0];
    };
    const elementsOf = async (window: Window, query?: string) => {
      const result = await observe("get_window_state", {
        pid: window.pid,
        window_id: window.window_id,
        tree_format: "elements",
        include_screenshot: false,
        max_elements: SNAPSHOT_MAX_ELEMENTS,
        ...(query ? { query } : {}),
      });
      const content = result.structuredContent ?? {};
      return {
        snapshotId: String(content.snapshot_id ?? ""),
        elements: (content.elements ?? []) as Element[],
        complete: content.elements_complete === true && content.truncated !== true,
        title: String(content.window_title ?? window.title),
      };
    };

    const args = rawArgs[0] === "--session" ? rawArgs.slice(2) : rawArgs;
    const headed = args[0] === "--headed";
    const rest = headed ? args.slice(1) : args;
    const command = rest[0];
    const envelope = (data: unknown): Envelope => ({
      version: AGENT_DESKTOP_PROTOCOL,
      ok: true,
      command,
      data,
    });
    const run = async (): Promise<Envelope> => {
      switch (command) {
        case "list-apps": {
          const app = flag(rest, "app")!;
          const pids = [...new Set((await windowsOf(app)).map((window) => window.pid))];
          return envelope({ apps: pids.map((pid) => ({ name: app, pid })) });
        }
        case "list-windows": {
          const windows = await windowsOf(flag(rest, "app")!);
          return envelope(
            windows.map((window) => ({
              id: String(window.window_id),
              title: window.title,
              app_name: window.app_name,
              pid: window.pid,
            })),
          );
        }
        case "snapshot": {
          const window = await windowOf(flag(rest, "app")!, flag(rest, "window-id"));
          const state = await elementsOf(window);
          const id = publicId(state.snapshotId);
          return envelope({
            app: window.app_name,
            window: { id: String(window.window_id) },
            snapshot_id: id,
            complete: state.complete,
            tree: cuaTree(state.elements, id, state.title),
          });
        }
        case "find": {
          const window = await windowOf(flag(rest, "app")!, flag(rest, "window-id"));
          const role = flag(rest, "role")?.toLowerCase();
          const name = flag(rest, "name");
          const search = flag(rest, "text");
          const exact = rest.includes("--exact");
          const same = (value: string | undefined, wanted: string) =>
            !!value &&
            (exact ? value === wanted : value.toLowerCase().includes(wanted.toLowerCase()));
          const state = await elementsOf(window, name ?? search);
          const id = publicId(state.snapshotId);
          const matches = state.elements.filter(
            (element) =>
              (!role || element.role?.toLowerCase() === role) &&
              (!name || same(element.label, name)) &&
              (!search || same(element.label, search) || same(element.value, search)),
          );
          return envelope({
            snapshot_id: id,
            matches: matches.slice(0, 50).map((element) => {
              const row = element.element_token?.split(":")[1];
              return {
                ref_id: row ? `@${id}:${row}` : null,
                role: element.role ?? "unknown",
                ...(element.label ? { name: element.label.slice(0, 4000) } : {}),
                value: element.value?.slice(0, 16000) ?? null,
                states: [
                  ...(element.enabled === false ? ["disabled"] : []),
                  ...(element.selected ? ["selected"] : []),
                ],
                interactive: (element.actions?.length ?? 0) > 0,
              };
            }),
            truncated: matches.length > 50 || !state.complete,
          });
        }
        case "screenshot": {
          const window = await windowOf(flag(rest, "app")!, flag(rest, "window-id"));
          const result = await observe("get_window_state", {
            pid: window.pid,
            window_id: window.window_id,
            include_accessibility_tree: false,
            display_only: true,
            max_image_dimension: SCREENSHOT_MAX_DIMENSION,
          });
          const image = result.content?.find((part) => part.type === "image" && part.data);
          if (!image?.data || image.mimeType !== "image/png")
            throw new CommandError("invalid_image", "cua-driver returned no PNG screenshot.");
          return envelope({ data: image.data, format: "png", ...pngSize(image.data) });
        }
        case "wait":
          throw new CommandError(
            "unsupported",
            "Waiting on an element is not available with cua-driver; take a fresh snapshot instead.",
          );
        case "launch": {
          const target = positional(rest)[0];
          const absolute = /^[a-z]:[\\/]/i.test(target) || target.startsWith("\\\\");
          return cuaActionEnvelope(
            command,
            await call("launch_app", absolute ? { path: target } : await launchTarget(target)),
          );
        }
        case "clipboard-get": {
          const result = await observe("clipboard_read", { include_text: true });
          const value = result.structuredContent?.text;
          return envelope(
            typeof value === "string" && value !== ""
              ? { type: "text", text: value.slice(0, 10000) }
              : { type: "text", found: false },
          );
        }
        case "clipboard-set":
          return cuaActionEnvelope(
            command,
            await call("clipboard_write", { text: positional(rest)[0] }),
          );
        case "clipboard-clear":
          return cuaActionEnvelope(command, await call("clipboard_write", { text: "" }));
        case "press": {
          const window = await windowOf(flag(rest, "app")!, flag(rest, "window-id"));
          const keys = cuaKeys(positional(rest)[0] ?? "");
          if (!keys.length) throw new CommandError("invalid_key", "No key was given.");
          const target = { pid: window.pid, window_id: window.window_id };
          const mode = headed ? { delivery_mode: "foreground" } : {};
          return cuaActionEnvelope(
            command,
            await (keys.length === 1
              ? call("press_key", { ...target, key: keys[0], ...mode })
              : call("hotkey", { ...target, keys, ...mode })),
          );
        }
        case "focus-window": {
          const window = await windowOf(flag(rest, "app")!, flag(rest, "window-id"));
          return cuaActionEnvelope(
            command,
            await call("bring_to_front", { pid: window.pid, window_id: window.window_id }),
          );
        }
      }
      if (UNSUPPORTED.has(command))
        throw new CommandError(
          "unsupported_action",
          `"${command}" is not available with cua-driver.`,
        );
      const [ref, value] = positional(rest);
      const element_token = token(ref);
      const mode = headed ? { delivery_mode: "foreground" } : {};
      switch (command) {
        case "click":
        case "toggle":
          return cuaActionEnvelope(command, await call("click", { element_token, ...mode }));
        case "double-click":
          return cuaActionEnvelope(
            command,
            await call("click", { element_token, count: 2, ...mode }),
          );
        case "right-click":
          return cuaActionEnvelope(
            command,
            await call("click", { element_token, button: "right", ...mode }),
          );
        case "expand":
          return cuaActionEnvelope(
            command,
            await call("click", { element_token, action: "expand", ...mode }),
          );
        case "set-value":
        case "select":
          return cuaActionEnvelope(
            command,
            await call("set_value", { element_token, value, ...mode }),
          );
        case "clear":
          return cuaActionEnvelope(
            command,
            await call("set_value", { element_token, value: "", ...mode }),
          );
        case "type":
          return cuaActionEnvelope(
            command,
            await call("type_text", { element_token, text: value, ...mode }),
          );
        case "scroll": {
          const amount = flag(rest, "amount");
          return cuaActionEnvelope(
            command,
            await call("scroll", {
              element_token,
              direction: flag(rest, "direction"),
              ...(amount ? { amount: Number(amount) } : {}),
              ...mode,
            }),
          );
        }
      }
      throw new CommandError(
        "unsupported_action",
        `"${command}" is not available with cua-driver.`,
      );
    };
    let result: Envelope;
    try {
      result = await run();
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
      result = {
        version: AGENT_DESKTOP_PROTOCOL,
        ok: false,
        command,
        error: {
          code: error.code,
          message: error.message,
          disposition: { delivery: "not_delivered", retry: "safe" },
        },
      };
    }
    return { stdout: JSON.stringify(result), exitCode: result.ok ? 0 : 1 };
  };
}
