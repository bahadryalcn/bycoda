import { JsonViewer as ArcJsonViewer, type JsonViewerProps } from "./arc/json-viewer/json-viewer";
import { useLocale } from "../i18n";
import { copyMessage } from "../../platform/tauri/clipboard";

/**
 * Collapsible, copyable tree view of a structured JSON payload (Arc json-viewer with the app's clipboard).
 * Copy goes through the shared clipboard helper; locale follows the app.
 * @group data
 * @use Show a complete parsed JSON payload (tool input/output, config, RPC result) as an inspectable tree.
 * @avoid Plain, diff or truncated output: render as text/code. Key-value summaries: DescriptionList.
 * @arc json-viewer
 */
export function JsonViewer(props: JsonViewerProps) {
  useLocale();
  return (
    <ArcJsonViewer
      writeText={copyMessage}
      {...props}
      className={["bycoda-arc bycoda-arc-json", props.className].filter(Boolean).join(" ")}
    />
  );
}
