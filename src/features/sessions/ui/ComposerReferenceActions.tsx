import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../../shared/i18n";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { cumulativeCssZoom } from "../../../shared/lib/cssZoom";
import { observeResize } from "../../../shared/lib/observeResize";
import { Button } from "../../../shared/ui/Button";
import { ImageLightbox } from "../../../shared/ui/ImageLightbox";
import { Link } from "../../../shared/ui/Link";
import { Popover } from "../../../shared/ui/Popover";
import { Text } from "../../../shared/ui/Text";
import { SkillIcon } from "../../../shared/ui/icons";
import type { Attachment } from "../model/session";
import { AttachmentFilePreview, canOpenFileAttachment } from "./AttachmentFilePreview";
import { ComposerSkillGroupHover } from "./ComposerSkillGroupHover";
import { useAttachmentPreview } from "./useAttachmentPreview";
import { useAttachmentMenu } from "./useAttachmentMenu";
import styles from "./ComposerHighlight.module.css";

export type ComposerSkillDetails = { description: string; path?: string };
export type ComposerSkillGroup = { invocation: string; name: string; members: readonly string[] };

type TargetKind = "attachment" | "file" | "group" | "missing" | "skill" | "url";
type Bounds = { left: number; top: number; width: number; height: number };
type Target = { kind: TargetKind; value: string; bounds: Bounds[] };
type Geometry = { parent: HTMLElement; targets: Target[] };
type Selected = { target: Target; anchor: HTMLElement; key: string };

function readGeometry(paint: HTMLElement, input: HTMLTextAreaElement): Geometry | null {
  const parent = input.parentElement;
  if (!parent) return null;
  const zoom = cumulativeCssZoom(parent);
  const origin = parent.getBoundingClientRect();
  const viewport = input.getBoundingClientRect();
  const selector = "[data-composer-reference]";
  const targets: Target[] = [];
  for (const node of paint.querySelectorAll<HTMLElement>(selector)) {
    // Markdown links can enclose a separately formatted URL. One action owns the whole link.
    if (node.parentElement?.closest(selector)) continue;
    const kind = node.dataset.composerReference as TargetKind;
    const value = node.dataset.referenceValue;
    if (!value) continue;
    const face = node.querySelector<HTMLElement>("[data-draft-token-label], [data-reference-face]");
    const rects = face?.getClientRects();
    const bounds: Bounds[] = [];
    for (const rect of rects?.length ? rects : node.getClientRects()) {
      const left = Math.max(rect.left, viewport.left);
      const top = Math.max(rect.top, viewport.top);
      const right = Math.min(rect.right, viewport.right);
      const bottom = Math.min(rect.bottom, viewport.bottom);
      if (right <= left || bottom <= top) continue;
      bounds.push({
        left: (left - origin.left) / zoom - parent.clientLeft,
        top: (top - origin.top) / zoom - parent.clientTop,
        width: (right - left) / zoom,
        height: (bottom - top) / zoom,
      });
    }
    // Keep source order and key positions even when a token scrolls out of view.
    targets.push({ kind, value, bounds });
  }
  return { parent, targets };
}

/** The textarea owns editing. The painted mirror supplies the exact clickable line boxes. */
export function ComposerReferenceActions({
  paint,
  field,
  attachments,
  groups,
  skills,
  onOpenFile,
}: {
  paint: RefObject<HTMLSpanElement | null>;
  field: RefObject<HTMLTextAreaElement | null>;
  attachments: readonly Attachment[];
  groups: readonly ComposerSkillGroup[];
  skills?: ReadonlyMap<string, ComposerSkillDetails>;
  onOpenFile?: (path: string) => void;
}) {
  const t = useT();
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [opened, setOpened] = useState<Selected | null>(null);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keep inline controls in step with textarea scroll and the painted DOM, after the sibling textarea ref attaches.
  useEffect(() => {
    const input = field.current;
    const mirror = paint.current;
    const scroll = mirror?.parentElement;
    if (!input || !mirror || !scroll) return;
    let last = "";
    const sync = () => {
      const next = readGeometry(mirror, input);
      const key = JSON.stringify(next?.targets);
      if (last === key) return;
      last = key;
      setGeometry(next);
    };
    const observer = new MutationObserver(sync);
    observer.observe(mirror, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    scroll.addEventListener("scroll", sync, { passive: true });
    const stopResize = observeResize(input, sync);
    sync();
    return () => {
      observer.disconnect();
      scroll.removeEventListener("scroll", sync);
      stopResize();
    };
  }, [field, paint]);

  if (!geometry) return null;
  const active = opened?.anchor.isConnected ? opened : null;
  const attachment =
    active?.target.kind === "attachment"
      ? attachments.find((file) => file.id === active.target.value)
      : undefined;
  const group =
    active?.target.kind === "group"
      ? groups.find((item) => item.invocation === active.target.value)
      : undefined;
  const skill = active?.target.kind === "skill" ? skills?.get(active.target.value) : undefined;
  const close = () => setOpened(null);
  // ui-drift-ignore: portal-outside-shared -- Inline controls belong beside the textarea outside its aria-hidden mirror. Popovers and dialogs use shared overlays.
  return createPortal(
    <div className={styles.referenceLayer} data-composer-reference-actions="">
      {groups.length && !active ? (
        <ComposerSkillGroupHover
          field={field}
          groups={new Map(groups.map((item) => [item.invocation, item]))}
        />
      ) : null}
      {geometry.targets.map((target, index) => {
        const file =
          target.kind === "attachment"
            ? attachments.find((item) => item.id === target.value)
            : undefined;
        const skillGroup =
          target.kind === "group"
            ? groups.find((item) => item.invocation === target.value)
            : undefined;
        if (target.kind === "file" && !onOpenFile) return null;
        if (target.kind === "attachment" && !file) return null;
        if (target.kind === "group" && !skillGroup) return null;
        const label = file ? t("Open {p0}", { p0: file.name }) : (skillGroup?.name ?? target.value);
        const key = `${index}:${target.kind}:${target.value}`;
        return target.bounds.map((style, part) => {
          const props = {
            className: styles.referenceHit,
            style,
            tabIndex: part === 0 ? 0 : -1,
            "aria-hidden": part === 0 ? undefined : (true as const),
            "aria-label": label,
            "data-reference-anchor": part === 0 ? key : undefined,
          };
          const fragmentKey = `${key}:${part}`;
          const primaryAnchor = (node: HTMLElement) =>
            part === 0
              ? node
              : ([
                  ...node.parentElement!.querySelectorAll<HTMLElement>("[data-reference-anchor]"),
                ].find((element) => element.dataset.referenceAnchor === key) ?? node);
          return target.kind === "url" ? (
            <Link
              key={fragmentKey}
              {...props}
              unstyled
              href={target.value}
              onMouseDown={part ? (event) => event.preventDefault() : undefined}
            />
          ) : (
            <Button
              key={fragmentKey}
              {...props}
              type="button"
              layout="text"
              variant="ghost"
              motion="none"
              aria-haspopup={target.kind === "file" ? undefined : "dialog"}
              aria-expanded={target.kind === "file" ? undefined : active?.key === key}
              onMouseDown={part ? (event) => event.preventDefault() : undefined}
              onClick={(event) => {
                if (target.kind === "file") onOpenFile?.(target.value);
                else {
                  const anchor = primaryAnchor(event.currentTarget);
                  if (part) anchor.focus({ preventScroll: true });
                  setOpened({ target, anchor, key });
                }
              }}
            />
          );
        });
      })}
      {attachment && active ? (
        <ComposerAttachmentPreview
          key={attachment.id}
          attachment={attachment}
          anchor={active.anchor}
          close={close}
        />
      ) : null}
      {active?.target.kind === "missing" ? (
        <UnavailableReference anchor={active.anchor} name={active.target.value} close={close} />
      ) : null}
      {active && (group || active.target.kind === "skill") ? (
        <ComposerSkillReference
          anchor={active.anchor}
          label={group?.name ?? active.target.value}
          group={group}
          skill={skill}
          close={close}
          onOpenFile={onOpenFile}
        />
      ) : null}
    </div>,
    geometry.parent,
  );
}

export function ComposerSkillReference({
  anchor,
  label,
  group,
  skill,
  close,
  onOpenFile,
}: {
  anchor: HTMLElement;
  label: string;
  group?: Pick<ComposerSkillGroup, "members">;
  skill?: ComposerSkillDetails;
  close: () => void;
  onOpenFile?: (path: string) => void;
}) {
  const t = useT();
  const path = skill?.path;
  return (
    <Popover
      anchor={anchor}
      kind="dialog"
      side="top"
      align="start"
      size="lg"
      appearance="composer"
      aria-label={label}
      onDismiss={close}
      className="flex flex-col gap-3 p-3"
    >
      <div className="flex shrink-0 items-center gap-2">
        <SkillIcon className="icon-sm shrink-0" aria-hidden />
        <Text as="p" size="body" tone="primary" weight="medium" wrap="anywhere">
          {label}
        </Text>
      </div>
      {group ? (
        <ul className="m-0 flex min-h-0 flex-col gap-1 overflow-y-auto">
          {group.members.map((member) => (
            <li key={member} className="flex items-center gap-1.5">
              <SkillIcon className="icon-xs shrink-0" aria-hidden />
              <Text size="caption" className="break-all">
                {member}
              </Text>
            </li>
          ))}
        </ul>
      ) : (
        <Text
          as="p"
          size="secondary"
          tone="secondary"
          leading="relaxed"
          wrap="anywhere"
          className="min-h-0 overflow-y-auto overscroll-contain"
        >
          {skill?.description || t("No description")}
        </Text>
      )}
      {path && onOpenFile ? (
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0 self-end"
          onClick={() => {
            close();
            onOpenFile(path);
          }}
        >
          {t("Open {p0}", { p0: "SKILL.md" })}
        </Button>
      ) : null}
    </Popover>
  );
}

export function ComposerAttachmentPreview({
  attachment,
  projectRoot,
  anchor,
  close,
}: {
  attachment: Attachment;
  projectRoot?: string;
  anchor: HTMLElement;
  close: () => void;
}) {
  const t = useT();
  const { actions, saveCopy } = useAttachmentMenu(attachment, projectRoot);
  const image = useAttachmentPreview(attachment);
  const show = useStableCallback(image.show);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- The mounted preview owns the existing attachment reader and releases it when closed.
  useEffect(() => {
    if (!image.canOpen) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled)
        void show().catch((error: unknown) =>
          console.error("Failed to open composer image:", error),
        );
    });
    return () => {
      cancelled = true;
    };
  }, [attachment, image.canOpen, show]);
  if (image.canOpen) {
    return (
      <ImageLightbox
        src={image.src ?? ""}
        alt={attachment.name}
        onClose={close}
        resetKey={attachment.id}
        loading={(!image.open && !image.error) || image.loading}
        error={image.error ? t("Preview unavailable. Try again.") : undefined}
        onRetry={image.retry}
        onImageError={image.recover}
        contextActions={actions}
        notice={saveCopy.error}
      />
    );
  }
  if (canOpenFileAttachment(attachment))
    return (
      <AttachmentFilePreview
        attachment={attachment}
        onClose={close}
        contextActions={actions}
        notice={saveCopy.error}
      />
    );
  return <UnavailableReference anchor={anchor} name={attachment.name} close={close} />;
}

export function UnavailableReference({
  anchor,
  name,
  close,
}: {
  anchor: HTMLElement;
  name: string;
  close: () => void;
}) {
  const t = useT();
  return (
    <Popover
      anchor={anchor}
      kind="dialog"
      side="top"
      align="start"
      aria-label={name}
      onDismiss={close}
      className="max-w-80 space-y-1 p-3"
    >
      <Text as="p" size="secondary" weight="medium">
        {name}
      </Text>
      <Text as="p" size="caption" tone="secondary">
        {t("Preview unavailable")}
      </Text>
    </Popover>
  );
}
