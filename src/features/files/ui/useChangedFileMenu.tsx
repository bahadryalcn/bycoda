import { translateAt, useLocale, type LanguageDomain } from "../../../shared/i18n";
import { useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { message } from "@tauri-apps/plugin-dialog";
import { copyText } from "../../../platform/tauri/clipboard";
import { openPathWithDefaultApp, revealPath } from "../../../platform/tauri/fs";
import { IS_MAC, IS_WIN } from "../../../platform/tauri/platform";
import { parentPath } from "../../../shared/lib/paths";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { ExplorerMenu, type ExplorerMenuItem } from "./ExplorerMenu";
import { canPreviewFile } from "../model/filePreview";
import { setMarkdownViewMode } from "../../sessions/ui/MarkdownModeToggle";

type ChangedFileTarget = {
  path: string;
  relative: string;
  deleted?: boolean;
  onOpenChanges: () => void;
  onOpenFile?: () => void;
};

type Action = {
  id: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  run: () => void | Promise<void>;
};

/** Shared actions for checkpoint and Git change rows, including deleted files. */
export function useChangedFileMenu({
  languageDomain = "technical",
  path,
  relative,
  deleted = false,
  onOpenChanges,
  onOpenFile,
  actions = [],
  selection,
}: {
  languageDomain?: LanguageDomain;
  path: string;
  relative: string;
  deleted?: boolean;
  onOpenChanges: () => void;
  onOpenFile?: () => void;
  actions?: Action[];
  selection?: ChangedFileTarget[] | (() => ChangedFileTarget[]);
}) {
  const locale = useLocale(languageDomain);
  const t = (message: string, values?: Record<string, unknown>) =>
    translateAt(locale, message, values);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const selected = position
    ? typeof selection === "function"
      ? selection()
      : selection
    : undefined;
  const targets = selected?.length
    ? selected
    : [{ path, relative, deleted, onOpenChanges, onOpenFile }];
  const remote = targets.some((target) => target.path.startsWith("remote://"));
  const items: ExplorerMenuItem[] = position
    ? [
        {
          kind: "item",
          id: "changes",
          get label() {
            return t("View Changes");
          },
        },
        ...(onOpenFile && canPreviewFile(path)
          ? [
              {
                kind: "item" as const,
                id: "preview",
                get label() {
                  return t("Preview");
                },
                disabled: targets.every((target) => target.deleted),
              },
            ]
          : []),
        ...(onOpenFile
          ? [
              {
                kind: "item" as const,
                id: "open",
                get label() {
                  return t("Open in {p0}", { p0: PRODUCT_IDENTITY.displayName });
                },
                disabled: targets.every((target) => target.deleted),
              },
            ]
          : []),
        {
          kind: "item",
          id: "default",
          get label() {
            return t("Open in Default App");
          },
          disabled: targets.every((target) => target.deleted) || remote,
        },
        {
          kind: "item",
          id: "reveal",
          label: IS_MAC
            ? t("Reveal in Finder")
            : IS_WIN
              ? t("Reveal in File Explorer")
              : t("Open Containing Folder"),
        },
        { kind: "sep" },
        {
          kind: "item",
          id: "copy-path",
          get label() {
            return t("Copy Path");
          },
        },
        {
          kind: "item",
          id: "copy-relative",
          get label() {
            return t("Copy Relative Path");
          },
        },
        ...(actions.length
          ? [
              { kind: "sep" as const },
              ...actions.map(({ run: _run, ...action }) => ({
                kind: "item" as const,
                ...action,
              })),
            ]
          : []),
      ]
    : [];
  const close = () => {
    setPosition(null);
    trigger.current?.focus();
  };
  const pick = (id: string) => {
    close();
    void (async () => {
      switch (id) {
        case "changes":
          for (const target of targets) target.onOpenChanges();
          return;
        case "preview":
          for (const target of targets) {
            if (!target.deleted && target.onOpenFile && canPreviewFile(target.path)) {
              setMarkdownViewMode(target.path, "preview");
              target.onOpenFile();
            }
          }
          return;
        case "open":
          for (const target of targets) if (!target.deleted) target.onOpenFile?.();
          return;
        case "default":
          if (!remote)
            for (const target of targets)
              if (!target.deleted) await openPathWithDefaultApp(target.path);
          return;
        case "reveal":
          for (const target of targets)
            await revealPath(target.deleted ? parentPath(target.path) : target.path);
          return;
        case "copy-path":
          await copyText(targets.map((target) => target.path).join("\n"));
          return;
        case "copy-relative":
          await copyText(targets.map((target) => target.relative).join("\n"));
          return;
        default: {
          const action = actions.find((item) => item.id === id);
          if (action && !action.disabled) await action.run();
        }
      }
    })().catch((error) =>
      message(String(error), {
        get title() {
          return t("File action failed");
        },
        kind: "error",
      }),
    );
  };
  return {
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      trigger.current =
        (event.target as HTMLElement).closest<HTMLElement>("button") ?? event.currentTarget;
      setPosition({ x: event.clientX, y: event.clientY });
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      event.preventDefault();
      event.stopPropagation();
      trigger.current = event.target as HTMLElement;
      const rect = trigger.current.getBoundingClientRect();
      setPosition({ x: rect.left, y: rect.bottom });
    },
    menu: position ? (
      <ExplorerMenu
        {...position}
        ariaLabel={t("Changed file actions")}
        items={items}
        onPick={pick}
        onClose={close}
      />
    ) : null,
  };
}
