import {
  ShortcutRecorder as ArcShortcutRecorder,
  type ShortcutRecorderProps,
} from "./arc/shortcut-recorder/shortcut-recorder";
import { useLocale } from "../i18n";

export function ShortcutRecorder(props: ShortcutRecorderProps) {
  useLocale();
  return (
    <ArcShortcutRecorder
      {...props}
      className={["bycoda-arc bycoda-arc-shortcut", props.className].filter(Boolean).join(" ")}
    />
  );
}
