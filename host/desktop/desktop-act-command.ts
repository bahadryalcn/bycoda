import {
  isForbiddenDesktopShortcut,
  type DesktopControlRequest,
} from "../../src/shared/model/host-contracts/desktop-control";
import { hasControlCharacters } from "../../src/shared/lib/controlCharacters";

type ActRequest = Extract<DesktopControlRequest, { op: "act" }>;

/** Actions that always need the explicit physical-input grant (real keys, cursor or window focus). */
const PHYSICAL_ONLY = ["press", "double-click", "hover", "drag", "focus-window"];
const TEXT_ACTIONS = ["set-value", "type", "select", "press"];

export const isPhysicalOnlyDesktopAction = (action: string) => PHYSICAL_ONLY.includes(action);

/** Validates that action, text and scroll/drag parameters agree. Throws before anything is journaled. */
export function validateDesktopAct(input: ActRequest, refs: ReadonlySet<string>) {
  const requiresText = TEXT_ACTIONS.includes(input.action);
  if ((requiresText && input.text === undefined) || (!requiresText && input.text !== undefined))
    throw new Error("Desktop action text did not match the selected command.");
  if (
    input.action === "press" &&
    (!input.text ||
      input.text.length > 100 ||
      hasControlCharacters(input.text, false) ||
      isForbiddenDesktopShortcut(input.text))
  )
    throw new Error("Invalid scoped keyboard shortcut.");
  if ((input.action === "drag") !== (input.toRef !== undefined))
    throw new Error("Desktop drag needs a destination ref; no other action takes one.");
  if (input.toRef !== undefined && !refs.has(input.toRef))
    throw new Error("The desktop destination ref is stale or outside this caller's snapshot.");
  if (
    (input.action !== "scroll" && (input.direction !== undefined || input.amount !== undefined)) ||
    (input.action === "scroll" && input.direction === undefined)
  )
    throw new Error("Desktop scroll needs a direction; no other action takes scroll settings.");
  return requiresText;
}

/** Helper argv (after the session flags) for one validated act. */
export function desktopActArgs(
  input: ActRequest,
  snapshot: { app: string; windowId: string },
): string[] {
  const head = [...(input.headed ? ["--headed"] : []), input.action];
  switch (input.action) {
    case "press":
      return [
        ...head,
        "--timeout-ms",
        "5000",
        "--app",
        snapshot.app,
        "--window-id",
        snapshot.windowId,
        "--",
        input.text!,
      ];
    case "focus-window":
      return [...head, "--app", snapshot.app, "--window-id", snapshot.windowId];
    case "drag":
      return [...head, "--timeout-ms", "5000", "--from", input.ref, "--to", input.toRef!];
    case "scroll":
      return [
        ...head,
        "--timeout-ms",
        "5000",
        "--direction",
        input.direction!,
        ...(input.amount !== undefined ? ["--amount", String(input.amount)] : []),
        "--",
        input.ref,
      ];
    default:
      return [
        ...head,
        "--timeout-ms",
        "5000",
        "--",
        input.ref,
        ...(TEXT_ACTIONS.includes(input.action) ? [input.text!] : []),
      ];
  }
}
