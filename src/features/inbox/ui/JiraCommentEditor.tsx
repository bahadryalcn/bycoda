import { useEffect, useRef } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { attachmentsFromPaths } from "../../sessions/public/attachments";
import { nativeDropPointer } from "../../../shared/lib/externalDrop";
import { isImeComposition } from "../../../shared/lib/keyboard";
import {
  NoteMarkdownEditor,
  runMarkdownCommand,
  type NoteEditorViewRef,
  type MarkdownCommand,
} from "../../notes/public/NoteMarkdownEditor";
import { Button } from "../../../shared/ui/Button";
import { ButtonGroup } from "../../../shared/ui/ButtonGroup";
import { FileField } from "../../../shared/ui/FileField";
import { InlineError } from "../../../shared/ui/InlineError";
import { TabStrip } from "../../../shared/ui/Tabs";
import { Text } from "../../../shared/ui/Text";
import { AgentMarkdown } from "../../sessions/public/AgentMarkdown";
import {
  Bold,
  Italic,
  CodeBlock,
  ListBullet,
  ListNumbered,
  Link,
  X,
} from "../../../shared/ui/icons";
import { t, useLocale } from "../../../shared/i18n";
import {
  JIRA_IMAGE_LIMIT,
  JIRA_IMAGE_TYPES,
  type JiraCommentImage,
} from "../model/jiraCommentDocument";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";

const commands = [
  ["bold", "Bold", Bold],
  ["italic", "Italic", Italic],
  ["code", "Code", CodeBlock],
  ["bullet", "Bullet list", ListBullet],
  ["numbered", "Numbered list", ListNumbered],
  ["link", "Link", Link],
] as const;

export function JiraCommentEditor({
  value,
  onChange,
  images,
  onImages,
  disabled,
  draftIdentity,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  images: JiraCommentImage[];
  onImages: (images: JiraCommentImage[]) => void;
  disabled: boolean;
  draftIdentity: string;
  onSubmit: () => Promise<void>;
}) {
  useLocale();
  const viewRef: NoteEditorViewRef = useRef(null);
  const dropZone = useRef<HTMLDivElement>(null);
  const readPending = useRef(false);
  const [mode, setMode] = useRetainedState<"source" | "split" | "preview">(
    `${draftIdentity}:view`,
    "split",
  );
  const [imageError, setImageError] = useRetainedState(`${draftIdentity}:image-error`, "");
  const [reading, setReading] = useRetainedState(`${draftIdentity}:image-reading`, false);
  const locked = disabled || reading;
  const addPaths = async (paths: string[]) => {
    if (locked || readPending.current) return;
    if (images.length + paths.length > 8) {
      setImageError(t("Attach up to 8 PNG, JPEG, GIF or WebP images, 10 MB each."));
      return;
    }
    readPending.current = true;
    setReading(true);
    setImageError("");
    try {
      const files = await attachmentsFromPaths(paths);
      if (
        files.length !== paths.length ||
        files.some(
          (file) =>
            !file.data ||
            !JIRA_IMAGE_TYPES.includes(file.mimeType) ||
            file.size <= 0 ||
            file.size > JIRA_IMAGE_LIMIT,
        )
      ) {
        throw new Error(t("Attach up to 8 PNG, JPEG, GIF or WebP images, 10 MB each."));
      }
      onImages([
        ...images,
        ...files.map((file) => ({
          id: file.id,
          name: file.name,
          type: file.mimeType,
          dataUrl: `data:${file.mimeType};base64,${file.data}`,
        })),
      ]);
    } catch (error) {
      setImageError(String(error));
    } finally {
      readPending.current = false;
      setReading(false);
    }
  };
  const currentDrop = useRef(addPaths);
  currentDrop.current = addPaths;
  // Windows file drops arrive through Tauri, rather than the DOM FileList.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Subscribes to native webview file drops while the composer is mounted.
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (disposed || event.payload.type !== "drop") return;
        const rect = dropZone.current?.getBoundingClientRect();
        const pointer = nativeDropPointer(event.payload.position, { clientX: -1, clientY: -1 });
        if (
          !rect ||
          pointer.clientX < rect.left ||
          pointer.clientX > rect.right ||
          pointer.clientY < rect.top ||
          pointer.clientY > rect.bottom
        )
          return;
        void currentDrop.current(event.payload.paths).catch(() => {});
      })
      .then((release) => {
        if (disposed) release();
        else unlisten = release;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  const addFiles = async (files: File[]) => {
    if (locked || readPending.current) return;
    setImageError("");
    if (
      images.length + files.length > 8 ||
      files.some(
        (file) =>
          !JIRA_IMAGE_TYPES.includes(file.type) || !file.size || file.size > JIRA_IMAGE_LIMIT,
      )
    ) {
      setImageError(t("Attach up to 8 PNG, JPEG, GIF or WebP images, 10 MB each."));
      return;
    }
    readPending.current = true;
    setReading(true);
    try {
      const added = await Promise.all(
        files.map(
          (file) =>
            new Promise<JiraCommentImage>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve({
                  id: crypto.randomUUID(),
                  name: file.name,
                  type: file.type,
                  dataUrl: String(reader.result),
                });
              reader.onerror = () => reject(new Error(t("Could not read image.")));
              reader.onabort = () => reject(new Error(t("Could not read image.")));
              reader.readAsDataURL(file);
            }),
        ),
      );
      onImages([...images, ...added]);
    } catch (error) {
      setImageError(String(error));
    } finally {
      readPending.current = false;
      setReading(false);
    }
  };
  const run = (command: MarkdownCommand) => {
    if (!locked && viewRef.current) runMarkdownCommand(viewRef.current, command);
  };
  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Drop zone wrapper; Ctrl+Enter bubbles from the editor textbox, this wrapper is not a focus target.
    <div
      ref={dropZone}
      className="flex flex-col gap-2"
      onKeyDown={(event) => {
        if (
          event.key === "Enter" &&
          (event.ctrlKey || event.metaKey) &&
          !isImeComposition(event.nativeEvent)
        ) {
          event.preventDefault();
          if (!locked) void onSubmit().catch(() => {});
        }
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        event.stopPropagation();
        void addFiles(Array.from(event.dataTransfer.files)).catch((error) =>
          setImageError(String(error)),
        );
      }}
    >
      <TabStrip
        label={t("Comment")}
        value={mode}
        onValueChange={setMode}
        items={[
          { value: "source", label: t("Source") },
          { value: "split", label: t("Split") },
          { value: "preview", label: t("Preview") },
        ]}
      />
      <ButtonGroup
        surface="transparent"
        className="self-start flex-wrap"
        aria-label={t("Markdown formatting")}
      >
        {commands.map(([command, label, Icon]) => (
          <Button
            key={command}
            type="button"
            variant="ghost"
            size="sm"
            iconOnly
            label={t(label)}
            disabled={locked || mode === "preview"}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => run(command)}
          >
            <Icon className="icon-sm" />
          </Button>
        ))}
      </ButtonGroup>
      <div
        className={
          mode === "split"
            ? "grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-4"
            : "min-w-0"
        }
      >
        <div className="min-w-0" hidden={mode === "preview"} inert={locked}>
          <NoteMarkdownEditor
            value={value}
            onChange={onChange}
            // Notes' Mod+S must never publish a public Jira comment.
            onSave={() => {}}
            onPasteImages={(files) => {
              void addFiles(files).catch((error) => setImageError(String(error)));
            }}
            viewRef={viewRef}
            minHeight={64}
            showLineNumbers={false}
            label={t("Comment")}
          />
        </div>
        {mode !== "source" ? (
          <section aria-label={t("Preview")} className="min-w-0 wrap-anywhere">
            {value.trim() ? (
              <AgentMarkdown text={value} hardBreaks />
            ) : (
              <Text tone="secondary">{t("No preview")}</Text>
            )}
          </section>
        ) : null}
      </div>
      <FileField
        label={t("Images")}
        hideLabel
        buttonLabel={t("Insert image")}
        accept={JIRA_IMAGE_TYPES.join(",")}
        multiple
        disabled={locked}
        onFiles={(files) => {
          void addFiles(files).catch((error) => setImageError(String(error)));
        }}
      />
      {images.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {images.map((image) => (
            <div key={image.id} className="flex items-center gap-1">
              <img src={image.dataUrl} alt={image.name} width={64} height={64} />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                iconOnly
                label={t("Remove {p0}", { p0: image.name })}
                disabled={locked}
                onClick={() => onImages(images.filter((item) => item.id !== image.id))}
              >
                <X className="icon-xs" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      {imageError ? <InlineError>{imageError}</InlineError> : null}
    </div>
  );
}
