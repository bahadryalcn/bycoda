import {
  ShortcutRecorder as ArcShortcutRecorder,
  ShortcutKbd,
  type ShortcutRecorderProps,
} from "./arc/shortcut-recorder/shortcut-recorder";
import { useLocale } from "../i18n";

type Props = ShortcutRecorderProps & {
  /** Already formatted key labels for an externally controlled recorder. */
  displayKeys?: readonly string[];
};

export function ShortcutRecorder({ displayKeys, ...props }: Props) {
  useLocale();
  return (
    <ArcShortcutRecorder
      {...props}
      displayText={
        displayKeys?.length ? (
          <span className="inline-flex items-center gap-1">
            {displayKeys.map((key, index) => (
              <span key={index} className="inline-flex items-center gap-1">
                {index > 0 && props.platform === "other" ? <span>+</span> : null}
                <ShortcutKbd size="sm">{key}</ShortcutKbd>
              </span>
            ))}
          </span>
        ) : (
          props.displayText
        )
      }
      className={["bycoda-arc bycoda-arc-shortcut", props.className].filter(Boolean).join(" ")}
    />
  );
}
