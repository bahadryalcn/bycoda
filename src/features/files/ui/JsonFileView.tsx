import { useMemo } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { JsonViewer } from "../../../shared/ui/JsonViewer";
import { jsonOpenDepth, parseJsonTree } from "../../../shared/lib/jsonTree";
import styles from "./FileViews.module.css";

/**
 * Tree view of a `.json` file: branches fold, the viewer's own search and expand/collapse-all work on the
 * whole document. Text that is not an object or array (or is too large) says so and offers the raw editor.
 */
export function JsonFileView({
  text,
  visible,
  onShowRaw,
}: {
  text: string;
  /** Only the shown view parses; a hidden one waits so typing in the editor stays cheap. */
  visible: boolean;
  onShowRaw: () => void;
}) {
  const t = useT();
  const parsed = useMemo(() => (visible ? parseJsonTree(text) : null), [visible, text]);
  if (!parsed) return null;
  if (!parsed.ok) {
    return (
      <div className={styles.notice}>
        <InlineMessage tone="warning">
          {t("This file is not a JSON object or array, or it is too large for the tree.")}
        </InlineMessage>
        <Button size="sm" onClick={onShowRaw}>
          {t("Show raw")}
        </Button>
      </div>
    );
  }
  return (
    <div className={styles.tree}>
      <JsonViewer
        data={parsed.data}
        defaultExpandDepth={jsonOpenDepth(parsed.data)}
        label={t("JSON tree")}
        maxHeight="100%"
        className={styles.viewer}
      />
    </div>
  );
}
