import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { ScrollArea } from "../../../shared/ui/ScrollArea";
import { useId, type ReactNode } from "react";
import { useRetainedScroll } from "../../../shared/hooks/useRetainedScroll";
import { useLocale } from "../../../shared/i18n";

/** Each pane owns one scroll area, with its extent visible even on overlay scrollbars. */
export function NoteEditorPane({
  label,
  hidden = false,
  split = false,
  document: readingPane = false,
  scrollKey,
  children,
}: {
  label: string;
  hidden?: boolean;
  /** The visible pane caption is only needed when two panes share the view. */
  split?: boolean;
  /** The rendered document pane uses the ~46rem reading measure on the canvas ground. */
  document?: boolean;
  /** Note/project-scoped window-lifetime position, independent for each pane. */
  scrollKey?: string;
  children: ReactNode;
}) {
  useLocale();
  const paneId = useId();
  const retainedViewport = useRetainedScroll<HTMLDivElement>(scrollKey ?? `note-pane:${paneId}`, {
    ready: !hidden,
  });

  return (
    <div
      hidden={hidden}
      data-split={split || undefined}
      data-document={readingPane || undefined}
      {...surfaceAttributes(
        {
          ...(readingPane && split
            ? { frame: "pane" as const, edge: "inline-start" as const }
            : {}),
          ...(readingPane ? { variant: "page" as const } : {}),
        },
        hidden ? "hidden" : "note-editor-pane",
      )}
    >
      {split ? (
        <Text
          as="div"
          size="caption"
          tone="secondary"
          leading="inherit"
          weight="medium"
          {...surfaceAttributes({ frame: "pane", edge: "block-end" }, "note-pane-label")}
        >
          {label}
        </Text>
      ) : null}
      <ScrollArea
        axis="both"
        gutter="stable"
        ref={retainedViewport}
        className="note-pane-scroll"
        role="region"
        aria-label={label}
        tabIndex={0}
      >
        <Text
          as="div"
          size="inherit"
          tone="inherit"
          leading={readingPane ? "relaxed" : "inherit"}
          className="note-pane-content"
        >
          {children}
        </Text>
      </ScrollArea>
    </div>
  );
}
