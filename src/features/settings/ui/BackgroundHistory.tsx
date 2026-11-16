import { useSyncExternalStore } from "react";
import { Select } from "../../../shared/ui/Select";
import { t, useLocale } from "../../../shared/i18n";
import { loadBackgroundHistory, subscribeBackgroundHistory } from "../model/backgroundHistory";
import { chatBackgroundKind } from "../../../shared/lib/chatBackgroundKind";

/** Saved choices remain available after disabling or switching the active background. */
export function BackgroundHistory({
  target = "global",
  path,
  disabled,
  onChoose,
}: {
  target?: string;
  path: string | null;
  disabled: boolean;
  onChoose: (path: string) => void;
}) {
  useLocale();
  const snapshot = useSyncExternalStore(
    subscribeBackgroundHistory,
    () => JSON.stringify(loadBackgroundHistory(target)),
    () => "[]",
  );
  const paths: string[] = JSON.parse(snapshot);
  if (!paths.length) return null;
  return (
    <Select
      label={t("Backgrounds")}
      value={path ?? ""}
      disabled={disabled}
      options={[
        { value: "", label: t("Choose background"), disabled: true },
        ...paths.map((value, index) => ({
          value,
          label: `${index + 1} · ${chatBackgroundKind(value).toUpperCase()} · ${value.split(/[\\/]/).pop()}`,
        })),
      ]}
      onValueChange={onChoose}
    />
  );
}
