import { useSyncExternalStore } from "react";
import { Select } from "../../../shared/ui/Select";
import { t, useLocale } from "../../../shared/i18n";
import { loadBackgroundHistory, subscribeBackgroundHistory } from "../model/backgroundHistory";
import { useSavedThemes } from "../model/savedThemes";
import { backgroundDisplayName, backgroundKindLabel } from "../model/backgroundNames";
import { SaveBackgroundButton } from "./appearance/controls/SaveBackgroundButton";
import { Text } from "../../../shared/ui/Text";
import type { AppearanceSnapshot } from "../model/appearanceSnapshot";

/** Saved choices remain available after disabling or switching the active background. */
export function BackgroundHistory({
  target = "global",
  path,
  disabled,
  onChoose,
  look,
}: {
  target?: string;
  path: string | null;
  disabled: boolean;
  onChoose: (path: string) => void;
  look?: AppearanceSnapshot;
}) {
  useLocale();
  const themes = useSavedThemes();
  const snapshot = useSyncExternalStore(
    subscribeBackgroundHistory,
    () => JSON.stringify(loadBackgroundHistory(target)),
    () => "[]",
  );
  const history: string[] = JSON.parse(snapshot);
  const paths = path && !history.includes(path) ? [path, ...history] : history;
  if (!paths.length && !path) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {path ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <Text size="caption" truncate>
            {t("Current")} · {backgroundDisplayName(path, themes)}
          </Text>
          <SaveBackgroundButton path={path} disabled={disabled} look={look} />
        </div>
      ) : null}
      <Select
        label={t("Backgrounds")}
        value={path ?? ""}
        disabled={disabled}
        options={[
          { value: "", label: t("Choose background"), disabled: true },
          ...paths.map((value, index) => {
            const name = backgroundDisplayName(value, themes),
              kind = backgroundKindLabel(value);
            return { value, label: `${index + 1} · ${name}${name !== kind ? ` · ${kind}` : ""}` };
          }),
        ]}
        onValueChange={onChoose}
      />
    </div>
  );
}
