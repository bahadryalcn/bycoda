import { MenuRow } from "../../shared/ui/MenuRow";
import { Button } from "../../shared/ui/Button";
import { t, useT } from "../../shared/i18n";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { LiveAgent } from "../../features/sessions/model/liveAgents";
import { ChevronDown } from "../../shared/ui/icons";
import { Popover } from "../../shared/ui/Popover";
import { IS_MAC } from "../../platform/tauri/platform";
import { WindowControls, toggleWindowMaximize } from "./WindowControls";
import { TransientNotice } from "../../shared/ui/TransientNotice";

type Props = { agents: LiveAgent[]; onSelectAgent: (id: string) => void };

export function detachedAgentStatus(agent: LiveAgent): string {
  if (agent.issue) return t(agent.issue === "retrying" ? "Retrying" : "Failed");
  return agent.done ? t("Done") : agent.needsApproval ? t("Needs input") : t("Working");
}

/** The working picker is navigation, not a terminal preview. Never put tool
 * command text in its rows or tooltips. */
export function detachedAgentTitle(title: string): string {
  const normalized = title.replace(/\s+/g, " ").trim() || "Untitled session";
  return normalized.length > 72 ? `${normalized.slice(0, 71)}…` : normalized;
}

const interactive = "button, a, input, select, textarea, [role=menu], [data-no-window-drag]";

export function DetachedWorkingBar({ agents, onSelectAgent }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [windowError, setWindowError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const dragCleanup = useRef<(() => void) | undefined>(undefined);
  const menuId = useId();
  const count = agents.length;
  const summary = `${count} ${count === 1 ? "conversation" : "conversations"}`;

  useEffect(() => () => dragCleanup.current?.(), []);
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
  }, [open]);
  useEffect(() => {
    if (!count) setOpen(false);
  }, [count]);

  const dismiss = () => {
    setOpen(false);
    trigger.current?.focus();
  };
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
  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitem]")];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    else if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
      return;
    } else return;
    event.preventDefault();
    items[next]?.focus();
  };

  return (
    <div
      data-detached-working-bar
      data-tauri-drag-region="false"
      onPointerDown={beginDrag}
      onDoubleClick={(event) => {
        if (event.target instanceof Element && event.target.closest(interactive)) return;
        dragCleanup.current?.();
        setWindowError(null);
        void toggleWindowMaximize().catch((error) =>
          setWindowError(error instanceof Error ? error.message : String(error)),
        );
      }}
      className={`flex h-8 min-w-0 shrink-0 select-none items-center gap-2 border-b border-stroke [padding-inline-start:0.75rem] ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
    >
      <span className="text-ui-micro text-(--ui-text-secondary)">{t("Working")}</span>
      <Button
        variant="ghost"
        motion="none"
        ref={trigger}
        type="button"
        data-tauri-drag-region="false"
        aria-label={t("Working conversations: {p0}", { p0: summary })}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={!count}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="flex max-w-56 items-center gap-2"
      >
        <span
          className={`size-1.5 shrink-0 rounded-full ${agents.some((agent) => agent.needsApproval) ? "bg-warning" : agents.some((agent) => !agent.done) ? "bg-active" : "bg-(--ui-text-muted)"}`}
        />
        <span className="truncate">{summary}</span>
        <ChevronDown className="icon-xs shrink-0 text-(--ui-text-secondary)" aria-hidden="true" />
      </Button>
      <div className="min-w-4 flex-1 self-stretch" aria-hidden="true" />
      {!IS_MAC ? <WindowControls /> : null}
      {windowError ? (
        <TransientNotice
          tone="danger"
          durationMs={null}
          message={windowError}
          onDismiss={() => setWindowError(null)}
        />
      ) : null}
      {open ? (
        <Popover
          ref={menu}
          anchor={trigger}
          align="start"
          width={320}
          maxHeight={320}
          onDismiss={dismiss}
          role="menu"
          id={menuId}
          aria-label={t("Working conversations")}
          onKeyDown={onMenuKey}
          style={{ maxWidth: "calc(100vw - 16px)" }}
          className="overflow-y-auto p-1"
          data-tauri-drag-region="false"
        >
          {agents.map((agent) => (
            <MenuRow
              key={agent.id}
              type="button"
              role="menuitem"
              data-tauri-drag-region="false"
              onClick={() => {
                dismiss();
                onSelectAgent(agent.id);
              }}
              className="flex w-full min-w-0 items-center gap-2"
            >
              <span
                aria-hidden="true"
                className={`size-1.5 shrink-0 rounded-full ${agent.issue === "failed" ? "bg-danger" : agent.issue === "retrying" ? "bg-warning" : agent.done ? "bg-(--ui-text-muted)" : agent.needsApproval ? "bg-warning" : "bg-active"}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ui-caption">
                  {detachedAgentTitle(agent.title)}
                </span>
                <span className="block truncate text-ui-micro text-(--ui-text-secondary)">
                  {detachedAgentStatus(agent)}
                  {agent.ownerWindowLabel ? t(" · Other window") : t(" · This window")}
                </span>
              </span>
            </MenuRow>
          ))}
        </Popover>
      ) : null}
    </div>
  );
}
