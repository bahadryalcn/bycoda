import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { Badge } from "../../../shared/ui/Badge";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { useContext, useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
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
  queued: "Sırada",
  running: "Gönderiliyor",
  succeeded: "Gönderildi",
  failed: "Başarısız",
  review: "İnceleme gerekli",
  cancelled: "İptal",
  available: "Kullanılabilir",
  unsupported: "Desteklenmiyor",
  pending: "Erişim bekleniyor",
  expired: "Bağlantı süresi doldu",
  draft: "Taslak",
  approved: "Onaylı",
  active: "Etkin",
  paused: "Durduruldu",
  completed: "Tamamlandı",
  connected: "Bağlı",
  disconnected: "Bağlı değil",
  skipped: "Atlandı",
  partial: "Kısmen gönderildi",
};
export const operations: Record<string, string> = {
  publish: "Yayın",
  media: "Medya",
  "comments.read": "Yorumları oku",
  reply: "Yoruma yanıt",
  comment: "Gönderiye yorum",
  "inbox.read": "Mesajları oku",
  "message.reply": "Mesaja yanıt",
  "message.start": "Yeni konuşma",
  search: "Keşif",
  webhook: "Anlık olaylar",
  poll: "API ile yenileme",
};
export const time = (value: number) => new Date(value).toLocaleString("tr-TR");
export type Run = (work: () => Promise<unknown>, successMessage?: string) => Promise<boolean>;
export { SocialBusyContext } from "./socialContext";
export const field = (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  return new FormData(event.currentTarget);
};
export function closeComposer(form: HTMLFormElement) {
  const details = form.closest<HTMLDetailsElement>(".social-composer");
  if (!details) return;
  details.querySelector<HTMLDialogElement>("dialog")?.close();
  details.open = false;
  details.querySelector("summary")?.focus();
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

/** Retain unfinished forms while editing in a modal that never displaces the list. */
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
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const feedback = useContext(SocialFeedbackContext);
  const titleId = useId();
  const sync = () => {
    if (!dialog.current) return;
    if (details.current?.open && !dialog.current.open) {
      dialog.current.showModal();
      onOpen?.();
    } else if (!details.current?.open && dialog.current.open) dialog.current.close();
  };
  useEffect(() => {
    if (editing && details.current) {
      details.current.open = true;
      sync();
    }
  }, [editing]);
  useEffect(() => {
    sync();
    return () => dialog.current?.close();
  }, []);
  const close = () => {
    dialog.current?.close();
    if (details.current) details.current.open = false;
    summary.current?.focus();
  };
  return (
    <details ref={details} className="social-composer" onToggle={sync}>
      <summary ref={summary} aria-haspopup="dialog">
        <Plus aria-hidden="true" />
        <span>{title}</span>
      </summary>
      <dialog
        ref={dialog}
        className="social-composer-dialog"
        aria-labelledby={titleId}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <section className="social-editor" aria-label={title}>
          <header className="social-editor-heading">
            <div>
              <h2 id={titleId}>{title}</h2>
              {description ? <p>{description}</p> : null}
            </div>
            <Button
              iconOnly
              label={`${title} formunu kapat`}
              variant="ghost"
              type="button"

              aria-label={`${title} formunu kapat`}
              onClick={close}
            >
              <X aria-hidden="true" />
            </Button>
          </header>
          {feedback.busy ? (
            <Notice kind="loading" title="İşlem sürüyor…" />
          ) : feedback.error ? (
            <Notice kind="error" title="İşlem tamamlanamadı">
              {feedback.error}
            </Notice>
          ) : null}
          {children}
        </section>
      </dialog>
    </details>
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
      label="İlgili projeler"
      placeholder="Proje seçin"
      searchPlaceholder="Proje adı veya klasör ara"
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
