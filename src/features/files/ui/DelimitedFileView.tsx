import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { useCallback, useEffect, useState, type ComponentProps } from "react";
import { lazySurface } from "../../../shared/ui/lazySurface";
import { t, useLocale } from "../../../shared/i18n/technical";
import { DocumentView } from "./DocumentView";
import type { FileEditor as FileEditorType } from "./FileEditor";

const FileEditor = lazySurface(async () => ({
  default: (await import("./FileEditor")).FileEditor,
}));

/** Table inspection must not remove the existing editable CSV/TSV source. */
export function DelimitedFileView(props: ComponentProps<typeof FileEditorType>) {
  useLocale();
  const [mode, setMode] = useState<"preview" | "source">(props.showDiff ? "source" : "preview");
  const [sourceMounted, setSourceMounted] = useState(!!props.showDiff);
  const [dirty, setDirty] = useState(false);
  const reportDirty = useCallback(
    (path: string, changed: boolean) => {
      setDirty(changed);
      props.onDirtyChange(path, changed);
    },
    [props.onDirtyChange],
  );
  useEffect(() => {
    if (props.navigation || props.showDiff) {
      setSourceMounted(true);
      setMode("source");
    }
  }, [props.navigation, props.showDiff]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center border-b border-stroke px-3 py-1.5">
        <SegmentedControl
          label={t("Table view")}
          value={mode}
          onValueChange={(value) => {
            if (value === "source") setSourceMounted(true);
            setMode(value as "preview" | "source");
          }}
          options={[
            { value: "preview", label: t("Preview") },
            { value: "source", label: t("Source") },
          ]}
        />
      </div>
      {mode === "preview" && dirty ? (
        <p role="status" className="px-3 py-1 text-ui-caption text-[var(--ui-text-secondary)]">
          {t("Preview shows the saved file. Your source edits are kept in the Source view.")}
        </p>
      ) : null}
      <div className="relative min-h-0 flex-1">
        {mode === "preview" ? <DocumentView path={props.path} cwd={props.cwd} /> : null}
        {sourceMounted ? (
          <div className={mode === "source" ? "absolute inset-0" : "hidden"}>
            <FileEditor
              {...props}
              onDirtyChange={reportDirty}
              active={props.active && mode === "source"}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
