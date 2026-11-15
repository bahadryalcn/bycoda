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
  bounds?: Frame;
};
type Frame = { x: number; y: number; width?: number; height?: number; w?: number; h?: number };
type Element = {
  element_token?: string;
  element_index?: number;
  depth?: number;
  role?: string;
  label?: string;
  value?: string;
  enabled?: boolean;
  selected?: boolean;
  actions?: string[];
  frame?: Frame | null;
};
/** What an earlier snapshot saw, so ref actions can read state without a new read (which would retire its tokens). */
type SeenSnapshot = { pid: number; windowId: number; bounds?: Frame; rows: Map<string, Element> };

const SNAPSHOT_MAX_ELEMENTS = 600;
const SCREENSHOT_MAX_DIMENSION = 1280;
const SEEN_SNAPSHOTS = 16;
/** cua-driver 0.49.11 has no Windows primitive for these: SetFocus is a no-op, `click action` only knows "expand", and scroll-into-view is internal. */
const UNSUPPORTED: Record<string, string> = {
  focus: "cua-driver cannot move keyboard focus on Windows yet; click a text field instead.",
  collapse: "cua-driver can only expand; press Escape or click the control to close it.",
  "scroll-to":
    "cua-driver scrolls an element into view on its own when acting on it; use scroll for manual scrolling.",
};
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
  const seen = new Map<string, SeenSnapshot>();
  const remember = (id: string, window: Window, bounds: unknown, elements: Element[]) => {
    seen.delete(id);
    seen.set(id, {
      pid: window.pid,
      windowId: window.window_id,
      bounds: (bounds as Frame | undefined) ?? window.bounds,
      rows: new Map(
        elements.flatMap((element) => {
          const row = element.element_token?.split(":")[1];
          return row ? [[row, element] as const] : [];
        }),
      ),
    });
    for (const key of seen.keys()) if (seen.size > SEEN_SNAPSHOTS) seen.delete(key);
  };
  /** The element and window a ref came from; refs are only granted from snapshots this runner served. */
  const located = (ref: string) => {
    const element_token = token(ref);
    const [snapshot, row] = ref.slice(1).split(":");
    const state = seen.get(snapshot);
    const element = state?.rows.get(row);
    if (!state || !element)
      throw new CommandError("stale_element_token", "Take a fresh snapshot before this action.");
    return { element_token, element, row: Number(row), ...state };
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
        bounds: content.window_bounds,
      };
    };
    /** Bounded predicate check on the element a ref names; reads state without retiring tokens. */
    const verify = async (
      target: ReturnType<typeof located>,
      expect: Record<string, boolean>,
      timeoutMs: number,
    ) => {
      const result = await observe("verify_state", {
        pid: target.pid,
        window_id: target.windowId,
        timeout_ms: timeoutMs,
        stable_samples: 1,
        expect: [
          {
            element: {
              selector: {
                ...(target.element.role ? { role: target.element.role } : {}),
                ...(target.element.label ? { label_contains: target.element.label } : {}),
              },
              ...expect,
            },
          },
        ],
      });
      const predicate = (
        result.structuredContent?.predicates as { observed_json?: string }[] | undefined
      )?.[0];
      let index: number | undefined;
      try {
        index = (JSON.parse(predicate?.observed_json ?? "{}") as Element).element_index;
      } catch {
        index = undefined;
      }
      return { status: String(result.structuredContent?.status ?? "unknown"), index };
    };
    /** Screen point at the element's centre, only while its window has not moved and on a 1x primary display. */
    const screenPoint = async (target: ReturnType<typeof located>) => {
      const frame = target.element.frame;
      const bounds = target.bounds;
      const current = (await windowsOfPid(target.pid)).find(
        (window) => window.window_id === target.windowId,
      )?.bounds;
      if (!frame || !bounds || !current)
        throw new CommandError("element_not_located", "The element has no screen position.");
      if (current.x !== bounds.x || current.y !== bounds.y)
        throw new CommandError("stale_element_token", "The window moved; take a fresh snapshot.");
      const x = Math.round(frame.x + (frame.w ?? 0) / 2);
      const y = Math.round(frame.y + (frame.h ?? 0) / 2);
      const screen = (await observe("get_screen_size", {})).structuredContent ?? {};
      // shortcut: frames are verified in physical pixels on a 1x primary display only; map scaled or secondary displays when a probe proves their coordinate space.
      const inside = (left: number, top: number, width: number, height: number) =>
        x >= left && y >= top && x < left + width && y < top + height;
      if (
        screen.scale_factor !== 1 ||
        !inside(bounds.x, bounds.y, bounds.width ?? 0, bounds.height ?? 0) ||
        !inside(0, 0, Number(screen.width), Number(screen.height))
      )
        throw new CommandError(
          "element_not_located",
          "The element is not on the primary 100% scaled display.",
        );
      return { x, y };
    };
    const windowsOfPid = async (pid: number) =>
      ((await observe("list_windows", { pid })).structuredContent?.windows ?? []) as Window[];

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
          remember(id, window, state.bounds, state.elements);
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
          remember(id, window, state.bounds, state.elements);
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
        case "wait": {
          const target = located(flag(rest, "element") ?? "");
          const predicate = flag(rest, "predicate");
          // shortcut: the driver has no on-screen predicate, so "visible" waits for existence; add one when verify_state gains it.
          const expect: Record<string, boolean> =
            predicate === "enabled" ? { enabled: true } : { exists: true };
          const timeout = Math.min(10000, Math.max(0, Number(flag(rest, "timeout")) || 0));
          const { status } = await verify(target, expect, timeout);
          if (status !== "satisfied")
            throw new CommandError(
              "timeout",
              `The element did not become ${predicate} within ${timeout} ms (${status}).`,
            );
          return envelope({ found: true, predicate });
        }
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
      if (UNSUPPORTED[command]) throw new CommandError("unsupported_action", UNSUPPORTED[command]);
      const mode = headed ? { delivery_mode: "foreground" } : {};
      if (command === "drag") {
        const from = located(flag(rest, "from") ?? "");
        const to = located(flag(rest, "to") ?? "");
        if (from.pid !== to.pid || from.windowId !== to.windowId)
          throw new CommandError("cross_window_drag", "Both drag ends must be in one window.");
        const [start, end] = [await screenPoint(from), await screenPoint(to)];
        const front = await call("bring_to_front", { pid: from.pid, window_id: from.windowId });
        if (front.isError) return cuaActionEnvelope(command, front);
        return cuaActionEnvelope(
          command,
          await call("drag", {
            scope: "desktop",
            from_x: start.x,
            from_y: start.y,
            to_x: end.x,
            to_y: end.y,
            delivery_mode: "foreground",
          }),
        );
      }
      const [ref, value] = positional(rest);
      const element_token = token(ref);
      switch (command) {
        case "hover": {
          const target = located(ref);
          const point = await screenPoint(target);
          const front = await call("bring_to_front", {
            pid: target.pid,
            window_id: target.windowId,
          });
          if (front.isError) return cuaActionEnvelope(command, front);
          return cuaActionEnvelope(
            command,
            await call("move_cursor", { scope: "desktop", ...point }),
          );
        }
        case "check":
        case "uncheck": {
          const target = located(ref);
          if (!target.element.actions?.includes("toggle"))
            throw new CommandError("not_toggleable", "The element is not a checkbox or toggle.");
          const wanted = { selected: command === "check" };
          const before = await verify(target, wanted, 0);
          // The selector matches by role and label; act only when it resolved to this exact row.
          if (before.index !== target.row || before.status === "unknown")
            throw new CommandError(
              "state_unknown",
              "The toggle state could not be read for this exact element.",
            );
          if (before.status === "satisfied")
            return envelope({
              summary: `Already ${command === "check" ? "checked" : "unchecked"}.`,
              disposition: { delivery: "not_delivered", retry: "safe" },
            });
          const clicked = cuaActionEnvelope(
            command,
            await call("click", { element_token, ...mode }),
          );
          if (!clicked.ok) return clicked;
          const after = await verify(target, wanted, 3000);
          return after.status === "satisfied" && after.index === target.row
            ? envelope({
                summary: command === "check" ? "Checked." : "Unchecked.",
                disposition: { delivery: "delivered_verified", retry: "unsafe" },
              })
            : clicked;
        }
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
