import { surfaceAttributes } from "../../../shared/ui/Surface";
import { useEffect, useMemo, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { useDragResize } from "../../../shared/hooks/useDragResize";
import { openUrlSafely } from "../../../shared/lib/openUrlSafely";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { Sash } from "../../../shared/ui/Sash";
import { Spinner } from "../../../shared/ui/Spinner";
import { Text } from "../../../shared/ui/Text";
import { hasActiveOverlay } from "../../../shared/ui/overlay";
import { CircleX, ExternalLink, X } from "../../../shared/ui/icons";
import { useTabGroupLogos } from "../../projects/public/useTabGroupLogos";
import type { RecentProject } from "../../projects";
import type { LinkedWorkItem } from "../../sessions";
import { useGithubWorkItem } from "../hooks/useGithubWorkItem";
import { inboxItemKey, inboxProjectsForRail } from "../model/githubTasks";
import { InboxDetail } from "./InboxDetail";
import { inboxProjectOptions, type CiRepairProps } from "./InboxPresentation";

const LINKED_PANEL_MIN_WIDTH = 360;
const LINKED_PANEL_DEFAULT_WIDTH = 520;
let rememberedLinkedPanelWidth = LINKED_PANEL_DEFAULT_WIDTH;

export function LinkedWorkItemPanel({
  repairSessions,
  onRepairChecks,
  onOpenSession,
  target,
  cwd,
  recents,
  visible = true,
  onClose,
}: {
  repairSessions?: CiRepairProps["repairSessions"];
  onRepairChecks?: CiRepairProps["onRepairChecks"];
  onOpenSession?: (sessionId: string) => void | Promise<void>;
  target: LinkedWorkItem;
  cwd: string;
  recents: RecentProject[];
  visible?: boolean;
  onClose: () => void;
}) {
  useLocale();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const logos = useTabGroupLogos();
  const projects = useMemo(() => inboxProjectsForRail(recents, cwd), [cwd, recents]);
  const projectOptions = useMemo(() => inboxProjectOptions(projects, logos), [logos, projects]);
  const { item, error, loading, setItem } = useGithubWorkItem(target, cwd);
  const [errorForUrl, setErrorForUrl] = useState<string | null>(null);
  if (errorForUrl && errorForUrl !== target.url) setErrorForUrl(null);
  const openError = errorForUrl === target.url ? t("Could not open the link. Try again.") : "";
  const targetUrlRef = useRef(target.url);
  targetUrlRef.current = target.url;
  const resize = useDragResize({
    min: LINKED_PANEL_MIN_WIDTH,
    max: () =>
      Math.max(
        LINKED_PANEL_MIN_WIDTH,
        Math.round(
          (typeof window === "undefined" ? LINKED_PANEL_DEFAULT_WIDTH / 0.65 : window.innerWidth) *
            0.65,
        ),
      ),
    defaultWidth: LINKED_PANEL_DEFAULT_WIDTH,
    initial: rememberedLinkedPanelWidth,
    direction: "left",
    onCommit: (width) => {
      rememberedLinkedPanelWidth = width;
    },
  });

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Sync the window Escape listener with panel visibility.
  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || hasActiveOverlay()) return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visible]);

  const kindLabel = target.kind === "pr" ? t("pull request") : t("issue");
  return (
    <Text
      as="aside"
      size="inherit"
      tone="neutral"
      ref={resize.setPaneRef}
      aria-label={t("Linked {p0} #{p1}", { p0: kindLabel, p1: target.number })}
      aria-busy={loading}
      aria-hidden={!visible}
      inert={!visible || undefined}
      data-linked-work-item-panel
      {...surfaceAttributes(
        { frame: "pane", edge: "left" },
        `@container/linked relative min-h-0 max-w-full shrink-0 flex-col @max-[950px]/main-row:absolute @max-[950px]/main-row:inset-y-0 @max-[950px]/main-row:right-0 @max-[950px]/main-row:z-(--layer-pane-sheet) @max-[950px]/main-row:shadow-(--ui-elevation-floating) ${visible ? "flex linked-work-item-enter" : "hidden"}`,
      )}
    >
      <Sash
        {...resize.sashProps}
        appearance="hidden"
        label={t("Resize linked {p0} panel", { p0: kindLabel })}
        className="absolute inset-y-0 -left-px"
      />
      <header className="flex shrink-0 items-center gap-2 px-3 py-1">
        <Text size="caption" tone="secondary" weight="medium" truncate className="min-w-0 flex-1">
          {t("Linked {p0} #{p1}", { p0: kindLabel, p1: target.number })}
        </Text>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          label={t("Close {p0} panel", { p0: kindLabel })}
          onClick={onClose}
          className="shrink-0"
        >
          <X className="icon-sm" strokeWidth={1.75} />
        </Button>
      </header>
      <div className="min-h-0 min-w-0 flex-1">
        {item ? (
          <InboxDetail
            key={inboxItemKey(item)}
            item={item}
            cwd={cwd}
            projects={projectOptions}
            revision={0}
            relatedSessions={[]}
            mode="panel"
            visible={visible}
            repairSessions={repairSessions}
            onRepairChecks={onRepairChecks}
            onOpenSession={onOpenSession}
            onItemChange={setItem}
          />
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-(--space-10) text-center">
            <CircleX tone="danger" className="icon-lg" strokeWidth={1.75} />
            <Alert tone="danger" className="max-w-sm">
              {error}
            </Alert>
            {openError ? <InlineError>{openError}</InlineError> : null}
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                setErrorForUrl(null);
                const url = target.url;
                openUrlSafely(url, () => {
                  if (targetUrlRef.current === url) setErrorForUrl(url);
                });
              }}
            >
              <ExternalLink className="icon-sm" strokeWidth={1.75} />
              {t("Open on GitHub")}
            </Button>
          </div>
        ) : (
          <Text
            as="div"
            size="inherit"
            tone="secondary"
            className="flex h-full items-center justify-center"
          >
            <Spinner size="md" />
          </Text>
        )}
      </div>
    </Text>
  );
}
