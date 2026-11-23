import { errorText } from "../../shared/lib/errors";
import { truncateGraphemes } from "../../shared/lib/text/truncate";
import { StatusDot } from "../../shared/ui/StatusDot";
import { surfaceAttributes } from "../../shared/ui/Surface";
import { Text } from "../../shared/ui/Text";
import { Button } from "../../shared/ui/Button";
import { useFormat, useT } from "../../shared/i18n";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { LiveAgent } from "../../features/sessions/model/liveAgents";
import { DropdownMenu, type DropdownMenuItem } from "../../shared/ui/DropdownMenu";
import { IS_MAC } from "../../platform/tauri/platform";
import { WindowControls, toggleWindowMaximize } from "./WindowControls";
import { Toast } from "../../shared/ui/ToastRegion";
import { Copy } from "../../shared/ui/icons";

type Props = { agents: LiveAgent[]; onSelectAgent: (id: string) => void };

export function detachedAgentStatus(agent: LiveAgent, t: (text: string) => string): string {
  if (agent.issue) return t(agent.issue === "retrying" ? "Retrying" : "Failed");
  if (agent.done) return t("Done");
  if (agent.needsApproval) return t("Needs input");
  return agent.waiting ? t("Waiting") : t("Working");
}

export type DetachedBarStatus = "needsInput" | "working" | "failed" | "waiting" | "done";

/** One aggregate state for the bar caption and dot. Attention and live work rank first;
 * a finished set (or none) reads as done. */
export function detachedBarStatus(agents: readonly LiveAgent[]): DetachedBarStatus {
  if (agents.some((agent) => agent.needsApproval)) return "needsInput";
  if (agents.some((agent) => !agent.done && !agent.waiting)) return "working";
  if (agents.some((agent) => agent.issue === "failed")) return "failed";
  if (agents.some((agent) => agent.waiting)) return "waiting";
  return "done";
}

function detachedBarStatusLabel(status: DetachedBarStatus, t: (text: string) => string): string {
  switch (status) {
    case "needsInput":
      return t("Needs input");
    case "working":
      return t("Working");
    case "failed":
      return t("Failed");
    case "waiting":
      return t("Waiting");
    case "done":
      return t("Done");
  }
}

/** The working picker is navigation, not a terminal preview. Never put tool
 * command text in its rows or tooltips. */
export function detachedAgentTitle(title: string, fallback: string): string {
  const normalized = title.replace(/\s+/g, " ").trim() || fallback;
  return truncateGraphemes(normalized, 72);
}

const interactive = "button, a, input, select, textarea, [role=menu], [data-no-window-drag]";

const barTone = {
  needsInput: "warning",
  working: "accent",
  failed: "danger",
  waiting: "secondary",
  done: "muted",
} as const satisfies Record<DetachedBarStatus, string>;

function agentTone(agent: LiveAgent) {
  if (agent.issue === "retrying") return "warning";
  if (agent.issue === "failed") return barTone.failed;
  if (agent.done) return barTone.done;
  if (agent.needsApproval) return barTone.needsInput;
  return agent.waiting ? barTone.waiting : barTone.working;
}

export function DetachedWorkingBar({ agents, onSelectAgent }: Props) {
  const t = useT();
  const { formatNumber } = useFormat();
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [windowError, setWindowError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dragCleanup = useRef<(() => void) | undefined>(undefined);
  const count = agents.length;
  const status = detachedBarStatus(agents);
  const summary =
    count === 1
      ? t("{p0} session", { p0: formatNumber(count) })
      : t("{p0} sessions", { p0: formatNumber(count) });
  // The menu cannot stay open with nothing to list. Closed while rendering so it
  // does not reopen when agents return.
  if (!count && open) setOpen(false);

  useEffect(() => () => dragCleanup.current?.(), []);
  const beginDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest(interactive))
    )
      return;
    dragCleanup.current?.();
    const { clientX, clientY, pointerId } = event;
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", cleanup);
      dragCleanup.current = undefined;
    };
    const end = (up: globalThis.PointerEvent) => {
      if (up.pointerId !== pointerId) return;
      cleanup();
      setDragging(false);
    };
    const move = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      if (!(next.buttons & 1)) {
        cleanup();
        setDragging(false);
        return;
      }
      if (Math.hypot(next.clientX - clientX, next.clientY - clientY) < 5) return;
      cleanup();
      setDragging(true);
      void getCurrentWindow()
        .startDragging()
        .catch(() => {})
        .finally(() => setDragging(false));
    };
    dragCleanup.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", cleanup);
  };
  const menuItems: DropdownMenuItem[] = agents.map((agent) => {
    const title = detachedAgentTitle(agent.title, t("Untitled session"));
    const state = detachedAgentStatus(agent, t);
    return {
      kind: "item",
      id: agent.id,
      label: [title, state, agent.ownerWindowLabel && t("Other window")].filter(Boolean).join(" · "),
      content: title,
      trailing: agent.ownerWindowLabel ? <Copy className="icon-sm" aria-hidden /> : undefined,
      icon: <StatusDot tone={agentTone(agent)} />,
    };
  });

  return (
    <div
      data-detached-working-bar
      data-tauri-drag-region="false"
      onPointerDown={beginDrag}
      onDoubleClick={(event) => {
        if (event.target instanceof Element && event.target.closest(interactive)) return;
        dragCleanup.current?.();
        setWindowError(null);
        void toggleWindowMaximize().catch((error) => setWindowError(errorText(error)));
      }}
      {...surfaceAttributes(
        { frame: "pane", edge: "bottom" },
        `flex h-8 min-w-0 shrink-0 select-none items-center gap-2 [padding-inline-start:0.75rem] ${dragging ? "cursor-grabbing" : "cursor-grab"}`,
      )}
    >
      {count > 0 ? <Button
        variant="ghost"
        motion="none"
        ref={trigger}
        type="button"
        data-tauri-drag-region="false"
        aria-label={`${summary} · ${detachedBarStatusLabel(status, t)}`}
        aria-haspopup="menu"
        expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <StatusDot tone={barTone[status]} />
        <Text size="inherit" tone="inherit" truncate>
          {formatNumber(count)}
        </Text>
      </Button> : null}
      <div className="min-w-4 flex-1 self-stretch" aria-hidden="true" />
      {!IS_MAC ? <WindowControls /> : null}
      {windowError ? (
        <Toast
          tone="danger"
          durationMs={null}
          message={windowError}
          onDismiss={() => setWindowError(null)}
        />
      ) : null}
      {open ? (
        <DropdownMenu
          anchor={trigger}
          align="start"
          size="lg"
          label={t("Working sessions")}
          items={menuItems}
          onPick={onSelectAgent}
          onClose={() => setOpen(false)}
          data-tauri-drag-region="false"
        />
      ) : null}
    </div>
  );
}
