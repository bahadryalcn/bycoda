import { useContext as useSocialContext } from "react";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { Badge } from "../../../shared/ui/Badge";
import { EmptyState } from "../../../shared/ui/EmptyState";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Modal } from "../../../shared/ui/Modal";
import { OverlayMenuLayer, OverlayParent } from "../../../shared/ui/overlay";
import { getLocale, t } from "../../../shared/i18n";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  LoaderCircle,
  Pause,
  Plus,
  X,
} from "../../../shared/ui/icons";
import { SocialFeedbackContext } from "./socialContext";
import { SocialMultiSelect } from "./SocialMultiSelect";
import type { HostProject } from "../../connections/model/protocol";
import type { SocialSnapshot, SocialCollection, SocialCollectionFilter } from "../model/social";
import type { SocialClient } from "../model/socialClient";
export { SOCIAL_PLATFORM_NAMES as names } from "../model/social";
export const youtubeDefaults = {
  title: "",
  privacy: "private" as const,
  madeForKids: false,
  containsSyntheticMedia: false,
};
export const statuses: Record<string, string> = {
  get queued() {
    return t("Queued");
  },
  get running() {
    return t("Sending");
  },
  get succeeded() {
    return t("Sent");
  },
  get failed() {
    return t("Failed");
  },
  get review() {
    return t("Needs review");
  },
  get cancelled() {
    return t("Cancelled");
  },
  get available() {
    return t("Available");
  },
  get unsupported() {
    return t("Unsupported");
  },
  get pending() {
    return t("Awaiting access");
  },
  get expired() {
    return t("Connection expired");
  },
  get draft() {
    return t("Draft");
  },
  get approved() {
    return t("Approved");
  },
  get active() {
    return t("Active");
  },
  get paused() {
    return t("Paused");
  },
  get completed() {
    return t("Completed");
  },
  get connected() {
    return t("Connected");
  },
  get disconnected() {
    return t("Not connected");
  },
  get skipped() {
    return t("Skipped");
  },
  get partial() {
    return t("Partially sent");
  },
};
export const operations: Record<string, string> = {
  get publish() {
    return t("Publishing");
  },
  get media() {
    return t("Media");
  },
  get "comments.read"() {
    return t("Read comments");
  },
  get reply() {
    return t("Reply to comment");
  },
  get comment() {
    return t("Comment on post");
  },
  get "inbox.read"() {
    return t("Read messages");
  },
  get "message.reply"() {
    return t("Reply to message");
  },
  get "message.start"() {
    return t("New conversation");
  },
  get search() {
    return t("Discovery");
  },
  get webhook() {
    return t("Live events");
  },
  get poll() {
    return t("Refresh via API");
  },
};
export const time = (value: number) => new Date(value).toLocaleString(getLocale());
export type Run = (work: () => Promise<unknown>, successMessage?: string) => Promise<boolean>;
export { SocialBusyContext } from "./socialContext";
export const field = (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  return new FormData(event.currentTarget);
};
/** Closes the Composer that owns this form; the form keeps its unsaved state. */
export function closeComposer(form: HTMLFormElement) {
  form.closest("[data-social-composer]")?.dispatchEvent(new CustomEvent("social-composer-close"));
}

export type NoticeKind = "info" | "success" | "warning" | "error" | "loading";
const noticeIcons = {
  info: AlertCircle,
  success: CheckCircle,
  warning: AlertCircle,
  error: X,
  loading: LoaderCircle,
};
export function Notice({
  kind = "info",
  title,
  children,
}: {
  kind?: NoticeKind;
  title?: string;
  children?: ReactNode;
}) {
  const Icon = noticeIcons[kind];
  return (
    <Alert
      className="social-notice"
      data-kind={kind}
      tone={kind === "error" ? "danger" : kind === "loading" ? "info" : kind}
      title={title}
      icon={<Icon aria-hidden="true" />}
      aria-busy={kind === "loading" ? true : undefined}
    >
      {children}
    </Alert>
  );
}
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const kind: NoticeKind | "neutral" = [
    "succeeded",
    "success",
    "approved",
    "active",
    "connected",
    "completed",
    "available",
  ].includes(status)
    ? "success"
    : ["failed", "error", "expired"].includes(status)
      ? "error"
      : ["review", "warning", "unsupported", "disconnected", "partial", "skipped"].includes(status)
        ? "warning"
        : ["queued", "pending", "draft", "info"].includes(status)
          ? "info"
          : ["running", "loading"].includes(status)
            ? "loading"
            : "neutral";
  const Icon = kind === "neutral" ? Pause : kind === "info" ? Clock : noticeIcons[kind];
  return (
    <Badge
      className="social-status-badge"
      data-kind={kind}
      data-status={status}
      tone={kind === "error" ? "danger" : kind === "loading" ? "info" : kind}
      icon={<Icon aria-hidden="true" />}
    >
      {label ?? statuses[status] ?? status}
    </Badge>
  );
}
export function Empty({
  children,
  title = "",
  icon: Icon,
}: {
  children: ReactNode;
  title?: string;
  icon?: typeof Plus;
}) {
  return (
    <EmptyState
      className="social-empty"
      data-placeholder={!!title}
      title={title}
      icon={Icon ? <Icon aria-hidden="true" /> : null}
      description={children}
    />
  );
}

type ComposerSlot = { element: HTMLDivElement | null; parent: symbol | null; layer: number };

function ComposerModalSlot({ onSlot }: { onSlot: (slot: ComposerSlot) => void }) {
  const parent = useContext(OverlayParent);
  const layer = useContext(OverlayMenuLayer);
  const ref = useCallback(
    (element: HTMLDivElement | null) => {
      onSlot({ element, parent, layer });
    },
    [onSlot, parent, layer],
  );
  return <div ref={ref} />;
}

/**
 * Opens its form in the shared Modal. The form lives in one persistent host element that
 * is parked in the page while closed, so unfinished drafts and refs survive close/reopen.
 */
export function Composer({
  title,
  children,
  editing = false,
  description,
  onOpen,
}: {
  title: string;
  children: ReactNode;
  editing?: boolean | number;
  description?: string;
  onOpen?: () => void;
}) {
  const socialLocked = useSocialContext(SocialLockContext);
  const [open, setOpen] = useState(false);
  const [slot, setSlot] = useState<ComposerSlot>({ element: null, parent: null, layer: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const stash = useRef<HTMLDivElement>(null);
  const opened = useRef(onOpen);
  opened.current = onOpen;
  const feedback = useContext(SocialFeedbackContext);
  const host = useMemo(() => {
    if (typeof document === "undefined") return null;
    const element = document.createElement("div");
    element.className = "social-view social-editor social-composer-body";
    element.setAttribute("data-social-composer", "");
    element.setAttribute("role", "group");
    return element;
  }, []);
  useEffect(() => {
    host?.setAttribute("aria-label", title);
  }, [host, title]);
  useEffect(() => {
    if (editing) setOpen(true);
  }, [editing]);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) opened.current?.();
    if (!open && wasOpen.current) trigger.current?.focus();
    wasOpen.current = open;
  }, [open]);
  useEffect(() => {
    if (!host) return;
    const close = () => setOpen(false);
    host.addEventListener("social-composer-close", close);
    return () => host.removeEventListener("social-composer-close", close);
  }, [host]);
  useLayoutEffect(() => {
    const target = open ? slot.element : stash.current;
    if (host && target && host.parentElement !== target) target.appendChild(host);
  });
  useLayoutEffect(() => () => host?.remove(), [host]);
  return (
    <>
      <Button
        disabled={socialLocked}
        ref={trigger}
        type="button"
        variant="secondary"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Plus aria-hidden="true" />
        <span>{title}</span>
      </Button>
      <div ref={stash} hidden />
      {open ? (
        <Modal title={title} description={description} size="lg" onClose={() => setOpen(false)}>
          <ComposerModalSlot onSlot={setSlot} />
        </Modal>
      ) : null}
      {host
        ? createPortal(
            <OverlayMenuLayer.Provider value={slot.layer}>
              <OverlayParent.Provider value={slot.parent}>
                {feedback.error ? (
                  <Notice kind="error" title={t("Operation could not be completed")}>
                    {feedback.error}
                  </Notice>
                ) : null}
                {children}
              </OverlayParent.Provider>
            </OverlayMenuLayer.Provider>,
            host,
          )
        : null}
    </>
  );
}
export function Projects({
  projects,
  selected,
  onChange,
}: {
  projects: HostProject[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <SocialMultiSelect
      label={t("Related projects")}
      placeholder={t("Select a project")}
      searchPlaceholder={t("Search by project name or folder")}
      options={projects.map((project) => ({
        value: project.id,
        label: project.name || project.cwd,
        description: project.cwd,
      }))}
      selected={selected}
      onChange={onChange}
    />
  );
}
export type Props = {
  client: SocialClient;
  snapshot: SocialSnapshot;
  projects: HostProject[];
  initialProject?: string;
  run: Run;
  onFilterChange?: (collection: SocialCollection, filter: SocialCollectionFilter) => void;
};
