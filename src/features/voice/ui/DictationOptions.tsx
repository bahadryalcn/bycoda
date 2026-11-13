import { useRef, useState, type ReactNode } from "react";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu, type DropdownMenuAction } from "../../../shared/ui/DropdownMenu";
import { HarnessIcon } from "../../../shared/ui/identity";
import { AudioLines, Brain, ChevronUp, Globe, Languages, Laptop } from "../../../shared/ui/icons";
import { Text } from "../../../shared/ui/Text";
import { useT } from "../../../shared/i18n";
import {
  CLOUD_DICTATION_PROVIDERS,
  DICTATION_LANGUAGES,
  DICTATION_MODELS,
  DICTATION_PROVIDER_NAMES,
  dictationModel,
} from "../model/dictationModels";
import {
  loadVoiceSettings,
  saveVoiceSettings,
  type DictationEngine,
  type VoiceSettings,
} from "../model/voiceSettings";
import styles from "./DictationButton.module.css";
import { useTranscriptionModels } from "../hooks/useTranscriptionModels";

/**
 * Composer shortcut next to the microphone: recognizer, model and language for the next
 * dictation. Writes the same preferences as Settings → Voice assistant.
 */
export function DictationOptions({
  settings,
  disabled,
}: {
  settings: VoiceSettings;
  disabled: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const engine = settings.dictationEngine;
  const catalog = useTranscriptionModels(open && engine === "openrouter");
  const catalogError = catalog.isError;
  const routerModels = catalog.isFetching || catalogError ? undefined : catalog.data;
  const engineName = (value: DictationEngine) =>
    value === "local" ? t("This computer") : DICTATION_PROVIDER_NAMES[value];
  // OpenAI and Grok reuse the marks of their harnesses; OpenRouter has no mark in the app.
  const engineIcon = (value: DictationEngine) =>
    value === "local" ? (
      <Laptop />
    ) : value === "openai" ? (
      <HarnessIcon harness="codex" size="sm" />
    ) : value === "xai" ? (
      <HarnessIcon harness="grok" size="sm" />
    ) : (
      <Globe />
    );
  const radio = (
    id: string,
    label: string,
    checked: boolean,
    icon?: ReactNode,
  ): DropdownMenuAction => ({
    kind: "item",
    id,
    label,
    icon,
    checked,
    selectionRole: "radio",
  });
  // The current choice reads as a quiet value beside the row label.
  const chosen = (value: string) => (
    <Text size="micro" tone="secondary" className="shrink-0">
      {value}
    </Text>
  );
  const model =
    engine === "local"
      ? undefined
      : engine === "openrouter" && !settings.dictationModels.openrouter
        ? routerModels?.[0]?.id
        : dictationModel(engine, settings.dictationModels[engine]);
  const languageName =
    DICTATION_LANGUAGES.find(([code]) => code === settings.dictationLanguage)?.[1] ??
    t("Automatic");

  const pick = (id: string) => {
    const [kind, value] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
    const current = loadVoiceSettings();
    if (kind === "engine")
      saveVoiceSettings({ ...current, dictationEngine: value as DictationEngine });
    else if (kind === "model" && current.dictationEngine !== "local")
      saveVoiceSettings({
        ...current,
        dictationModels: { ...current.dictationModels, [current.dictationEngine]: value },
      });
    else if (kind === "language")
      saveVoiceSettings({
        ...current,
        dictationLanguage: value as VoiceSettings["dictationLanguage"],
      });
  };

  return (
    <>
      <Button
        ref={trigger}
        variant="ghost"
        motion="none"
        iconOnly
        className={styles.options}
        label={t("Dictation options")}
        tooltip={t("Recognition, model and language")}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        // Keep the caret in the message box.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronUp className="icon-xs" />
      </Button>
      {open ? (
        <DropdownMenu
          anchor={trigger}
          label={t("Dictation options")}
          side="top"
          width={240}
          onClose={() => setOpen(false)}
          onPick={pick}
          items={[
            {
              kind: "item",
              id: "engine",
              label: t("Dictation recognition"),
              icon: <AudioLines />,
              trailing: chosen(engineName(engine)),
              submenu: (["local", ...CLOUD_DICTATION_PROVIDERS] as DictationEngine[]).map((value) =>
                radio(`engine:${value}`, engineName(value), value === engine, engineIcon(value)),
              ),
            },
            ...(engine === "local"
              ? []
              : [
                  {
                    kind: "item" as const,
                    id: "model",
                    label: t("Dictation model"),
                    icon: <Brain />,
                    submenuWidth: 280,
                    trailing:
                      engine === "openrouter" && !routerModels
                        ? chosen(catalogError ? t("Unavailable") : t("Loading…"))
                        : undefined,
                    submenu: (engine === "openrouter"
                      ? (routerModels ?? [])
                      : DICTATION_MODELS[engine]
                    ).map((entry) => radio(`model:${entry.id}`, entry.label, entry.id === model)),
                  },
                ]),
            {
              kind: "item",
              id: "language",
              label: t("Dictation language"),
              icon: <Languages />,
              trailing: chosen(languageName),
              submenu: [
                radio("language:auto", t("Automatic"), settings.dictationLanguage === "auto"),
                ...DICTATION_LANGUAGES.map(([code, label]) =>
                  radio(`language:${code}`, label, settings.dictationLanguage === code),
                ),
              ],
            },
          ]}
        />
      ) : null}
    </>
  );
}
