import { format } from "node:util";
import { createLogger, type Logger } from "./logger";

const NOT_A_TAG = /^(error|warning|warn|info|debug|note|usage|fatal|uncaught)$/i;

/** `[tag] message` or `tag: message` becomes the category `host.<tag>`. */
export function parseConsoleCategory(args: readonly unknown[]): {
  category: string;
  args: unknown[];
} {
  const first = args[0];
  if (typeof first === "string") {
    const match =
      /^\[([A-Za-z0-9._-]{1,32})\]\s*(.*)$/s.exec(first) ??
      /^([A-Za-z][A-Za-z0-9_-]{0,31}):\s+(.*)$/s.exec(first);
    if (match && !NOT_A_TAG.test(match[1])) {
      const tag = match[1]
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, "-")
        .replace(/^[^a-z0-9]+/, "");
      if (tag) return { category: `host.${tag}`, args: [match[2], ...args.slice(1)] };
    }
  }
  return { category: "host", args: [...args] };
}

/** Routes console.* through the Host logger. Returns a function that restores the console. */
export function installConsoleBridge(base: Logger = createLogger("host")): () => void {
  const original = { ...console };
  const route =
    (level: "debug" | "info" | "warn" | "error") =>
    (...args: unknown[]) => {
      const parsed = parseConsoleCategory(args);
      const message = parsed.args.length ? format(...parsed.args) : "";
      const logger = parsed.category === "host" ? base : base.child(parsed.category.slice(5));
      logger[level](message);
    };
  console.log = route("info");
  console.info = route("info");
  console.warn = route("warn");
  console.error = route("error");
  console.debug = route("debug");
  return () => {
    Object.assign(console, original);
  };
}
