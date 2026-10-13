import { randomUUID } from "node:crypto";
import { deviceCommand } from "./device-process";
import type { DeviceAction } from "../src/features/devices/types";

const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const SERIAL = /^[A-Za-z0-9_.:-]{1,200}$/;
const MAX_XML_BYTES = 512 * 1024;

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
      "Windows Android typing supports printable ASCII only; control characters, Unicode and literal %s are unsupported.",
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
  options: { env?: NodeJS.ProcessEnv; command?: typeof deviceCommand } = {},
): Promise<string> {
  if (typeof serial !== "string" || !SERIAL.test(serial) || serial.startsWith("-"))
    throw new Error("Invalid Android device serial");
  const command = options.command ?? deviceCommand;
  const run = async (args: string[], inspectErrors = true) => {
    const output = await command(adbPath, ["-s", serial, "shell", ...args], {
      env: options.env,
      timeoutMs: 30_000,
    });
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
        if (!xml.trim().startsWith("<?xml") || !xml.includes("<hierarchy"))
          throw new Error("Android accessibility snapshot returned invalid XML.");
        data = { action: action.type, xml };
      } finally {
        if (!/^\/data\/local\/tmp\/bycoda-ui-[0-9a-f-]{36}\.xml$/.test(path))
          throw new Error("Invalid owned Android snapshot path.");
        await run(["rm", "-f", path]);
      }
      break;
    }
    default:
      throw new Error("Unsupported device action");
  }
  return JSON.stringify({ success: true, data });
}
