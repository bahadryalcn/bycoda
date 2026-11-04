import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { deviceCommand } from "./device-process";
import type { DeviceAction } from "../../src/shared/model/host-contracts/native-devices";

const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const SERIAL = /^[A-Za-z0-9_.:-]{1,200}$/;
const MAX_XML_BYTES = 512 * 1024;
export function androidSnapshotNodes(xml: string) {
  // Comments and CDATA are not actionable UIAutomator nodes.
  const markup = xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  const decode = (value: string) =>
    value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[0-9a-fA-F]+);/g, (entity) => {
      const known: Record<string, string> = {
        "&amp;": "&",
        "&quot;": '"',
        "&apos;": "'",
        "&lt;": "<",
        "&gt;": ">",
      };
      if (known[entity]) return known[entity];
      const hex = entity.startsWith("&#x");
      const code = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : "\ufffd";
    });
  return [...markup.matchAll(/<node\s+((?:[^>"']|"[^"]*"|'[^']*')*)\s*\/?\s*>/g)].map((match) => {
    const attrs = Object.fromEntries(
      [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((attr) => [attr[1], decode(attr[2])]),
    );
    return {
      label: attrs.text || attrs["content-desc"],
      enabled: attrs.enabled !== "false",
      bounds: attrs.bounds,
      resourceId: attrs["resource-id"] || "",
      className: attrs.class || "",
      contentDescription: attrs["content-desc"] || "",
      text: attrs.text || "",
      clickable: attrs.clickable === "true",
    };
  });
}

/** adb shell joins argv into a remote shell command; quote even literal text. */
export function quoteAndroidShell(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
export function androidTextArgument(text: string) {
  if (
    typeof text !== "string" ||
    !text ||
    text.length > 4096 ||
    !/^[\x20-\x7e]+$/.test(text) ||
    text.includes("%s")
  )
    throw new Error(
      "Windows Android typing supports printable ASCII only; control characters, Unicode and literal %s are unsupported. Enter this text on the device instead.",
    );
  return quoteAndroidShell(text.replaceAll(" ", "%s"));
}
export function androidPackageTarget(app: string) {
  if (typeof app !== "string") throw new Error("Enter an Android package ID or Settings.");
  const value = app.trim();
  const target = value.toLowerCase() === "settings" ? "com.android.settings" : value;
  if (target.length > 256 || !PACKAGE.test(target))
    throw new Error("Enter an Android package ID such as com.example.app, or Settings.");
  return target;
}
function coordinate(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 20000)
    throw new Error("Invalid device coordinate");
  return String(value);
}
function successful(output: string) {
  if (/Error:|Exception:|unable to resolve Intent|does not exist/i.test(output))
    throw new Error(`Android device command failed: ${output.slice(-2000)}`);
}

/** SDK-native Windows control. No daemon or user-supplied shell program. */
export async function androidDeviceControl(
  adbPath: string,
  serial: string,
  action: DeviceAction,
  options: {
    env?: NodeJS.ProcessEnv;
    command?: typeof deviceCommand;
    authorize?: () => Promise<void>;
    track?: <T>(work: Promise<T>) => Promise<T>;
    /** Shared monotonic deadline for nested operations. */
    deadline?: number;
  } = {},
): Promise<string> {
  if (typeof serial !== "string" || !SERIAL.test(serial) || serial.startsWith("-"))
    throw new Error("Invalid Android device serial");
  const command = options.command ?? deviceCommand;
  const physical = new Set<Promise<unknown>>();
  let snapshotStarted = false;
  const deadline =
    action.type === "waitForText"
      ? Math.min(options.deadline ?? Infinity, performance.now() + (action.timeoutMs ?? 30_000))
      : options.deadline;
  const timeout = () =>
    new Error(
      "DEVICE_EXPECTATION_TIMEOUT: The expected text did not appear. Inspect the app before repeating actions.",
    );
  const remaining = () =>
    deadline === undefined ? 30_000 : Math.min(30_000, Math.floor(deadline - performance.now()));
  const bounded = async <T>(work: Promise<T>): Promise<T> => {
    if (deadline === undefined) return work;
    const ms = remaining();
    if (ms <= 0) throw timeout();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(timeout()), ms);
        }),
      ]);
      if (remaining() <= 0) throw timeout();
      return result;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const run = async (args: string[], inspectErrors = true, cleanup = false) => {
    if (!cleanup) await bounded(Promise.resolve().then(() => options.authorize?.()));
    const ms = remaining();
    if (ms <= 0) throw timeout();
    const work = command(adbPath, ["-s", serial, "shell", ...args], {
        env: options.env,
        timeoutMs: ms,
      });
    if (args[0] === "uiautomator" && args[1] === "dump") snapshotStarted = true;
    physical.add(work);
    void work.then(() => physical.delete(work), () => physical.delete(work));
    const output = await bounded(options.track ? options.track(work) : work);
    if (inspectErrors) successful(output);
    return output;
  };
  let data: Record<string, unknown> = { action: action.type };
  switch (action.type) {
    case "home":
      await run(["input", "keyevent", "KEYCODE_HOME"]);
      break;
    case "press":
      await run(["input", "tap", coordinate(action.x), coordinate(action.y)]);
      break;
    case "swipe":
      await run([
        "input",
        "swipe",
        coordinate(action.x),
        coordinate(action.y),
        coordinate(action.endX),
        coordinate(action.endY),
      ]);
      break;
    case "type":
      await run(["input", "text", androidTextArgument(action.text)]);
      break;
    case "openApp": {
      const target = androidPackageTarget(action.app);
      const resolved = await run([
        "cmd",
        "package",
        "resolve-activity",
        "--brief",
        "-a",
        "android.intent.action.MAIN",
        "-c",
        "android.intent.category.LAUNCHER",
        "-p",
        target,
      ]);
      const component = resolved.trim().split(/\r?\n/).at(-1) ?? "";
      const prefix = `${target}/`;
      if (
        !component.startsWith(prefix) ||
        !/^\.?[A-Za-z_$][A-Za-z0-9_.$]*$/.test(component.slice(prefix.length))
      )
        throw new Error("The Android package has no available launcher activity.");
      await run(["am", "start", "-W", "-n", quoteAndroidShell(component)]);
      data = { action: action.type, appPackage: target, component };
      break;
    }
    case "snapshot": {
      const path = `/data/local/tmp/bycoda-ui-${randomUUID()}.xml`;
      try {
        await run(["uiautomator", "dump", "--compressed", path]);
        const xml = await run(["cat", path], false);
        if (Buffer.byteLength(xml, "utf8") > MAX_XML_BYTES)
          throw new Error("Android accessibility snapshot exceeds 512 KiB.");
        if (
          !xml.trim().startsWith("<?xml") ||
          !/<hierarchy(?:\s|>)/.test(xml) ||
          !/<\/hierarchy>\s*$/.test(xml)
        )
          throw new Error("Android accessibility snapshot returned invalid XML.");
        data = { action: action.type, xml };
      } finally {
        if (!/^\/data\/local\/tmp\/bycoda-ui-[0-9a-f-]{36}\.xml$/.test(path))
          throw new Error("Invalid owned Android snapshot path.");
        // Revocation must not strand the exact temporary file this operation
        // already created. Cleanup cannot issue input or choose another path.
        if (snapshotStarted && remaining() > 0 && physical.size === 0) await run(["rm", "-f", path], true, true);
        else if (snapshotStarted) {
          // A timed-out observer may leave adb running. Wait for this exact
          // snapshot's physical work before deleting its exact temporary file.
          const cleanup = Promise.allSettled([...physical]).then(async () => {
            const work = command(adbPath, ["-s", serial, "shell", "rm", "-f", path], {
              env: options.env,
              timeoutMs: 5_000,
            });
            successful(await work);
          });
          const tracked = options.track ? options.track(cleanup) : cleanup;
          void tracked.catch(() => {});
        }
      }
      break;
    }
    case "pressElement": {
      const snapshot = JSON.parse(
        await androidDeviceControl(adbPath, serial, { type: "snapshot" }, options),
      );
      const nodes = androidSnapshotNodes(snapshot.data.xml).filter(
        (node) => node.enabled && node.label === action.label,
      );
      if (nodes.length !== 1)
        throw new Error(
          nodes.length
            ? "DEVICE_ELEMENT_AMBIGUOUS: Several controls have this label."
            : "DEVICE_ELEMENT_NOT_FOUND: No enabled control has this label.",
        );
      const bounds = nodes[0].bounds?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
      if (
        !bounds ||
        Number(bounds[3]) <= Number(bounds[1]) ||
        Number(bounds[4]) <= Number(bounds[2])
      )
        throw new Error("DEVICE_ELEMENT_BOUNDS_INVALID: Inspect the selected screen.");
      await run([
        "input",
        "tap",
        coordinate(Math.round((Number(bounds[1]) + Number(bounds[3])) / 2)),
        coordinate(Math.round((Number(bounds[2]) + Number(bounds[4])) / 2)),
      ]);
      data = { action: action.type, matchedLabel: action.label };
      break;
    }
    case "waitForText": {
      for (;;) {
        const snapshot = JSON.parse(
          await androidDeviceControl(
            adbPath,
            serial,
            { type: "snapshot" },
            { ...options, deadline },
          ),
        );
        if (
          androidSnapshotNodes(snapshot.data.xml).some((node) => node.label?.includes(action.text))
        ) {
          data = { action: action.type, matchedText: action.text };
          break;
        }
        if (remaining() <= 0) throw timeout();
        await bounded(new Promise((resolve) => setTimeout(resolve, Math.min(500, remaining()))));
      }
      break;
    }
    default:
      throw new Error("Unsupported device action");
  }
  await bounded(Promise.resolve().then(() => options.authorize?.()));
  return JSON.stringify({ success: true, data });
}
