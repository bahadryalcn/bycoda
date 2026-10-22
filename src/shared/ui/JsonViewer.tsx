import { JsonViewer as ArcJsonViewer, type JsonViewerProps } from "./arc/json-viewer/json-viewer";
import { useLocale } from "../i18n";
import { copyMessage } from "../../platform/tauri/clipboard";

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
