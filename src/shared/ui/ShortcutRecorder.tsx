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

/**
 * Control that captures a key combination, validating physical keys and IME input, and shows it as key caps.
 * `displayKeys` supplies already formatted labels for an externally controlled recorder; the shortcut model lives in `shortcut.ts`.
 * @group fields
 * @use Let the user rebind a keyboard shortcut (settings).
 * @avoid Only displaying a shortcut: ShortcutKeys.
 * @arc shortcut-recorder
 */
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
                {index > 0 && props.platform === "other" ? (
                  <span className="text-(--ui-text-muted)">+</span>
                ) : null}
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
