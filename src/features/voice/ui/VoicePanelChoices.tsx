import { useMemo } from "react";
import type { Session } from "../../sessions/model/session";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { projectDisplayName } from "../../projects/model/projectNames";
import { Select } from "../../../shared/ui/Select";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { AudioLines, Folder, Laptop, UserRound } from "../../../shared/ui/icons";
import { speakerEngine, speakerOptions } from "../model/voiceSpeakers";
import { t } from "../../../shared/i18n";
import {
  loadVoiceSettings,
  saveVoiceSettings,
  useVoiceSettings,
  type VoiceMode,
  type VoiceSettings,
} from "../model/voiceSettings";
import styles from "./VoiceCompanion.module.css";

const FOLLOW = "__follow-active__";

/**
 * In-panel choices: which session (and so which project) voice talks to, who runs
 * the conversation and, for local conversations, the reply voice. Changing the
 * conversation or voice disconnects a live connection; Start voice uses the new choice.
 */
export function VoicePanelChoices({
  sessions,
  activeId,
  pinned,
  onPin,
}: {
  sessions: Session[];
  activeId?: string;
  pinned: string | null;
  onPin: (sessionId: string | null) => void;
}) {
  const settings = useVoiceSettings();
  const change = (patch: Partial<VoiceSettings>) =>
    saveVoiceSettings({ ...loadVoiceSettings(), ...patch });
  // Internal workers and temporary Inbox questions are not voice targets.
  const targets = useMemo(
    () => sessions.filter((session) => !session.orchestrationLeadId && !session.inboxAsk),
    [sessions],
  );
  const active = targets.find((session) => session.id === activeId);
  const sessionOptions = useMemo(
    () => [
      {
        value: FOLLOW,
        // Names the session being followed; the pin button marks a fixed choice.
        label: active ? `${t("Active session")}: ${active.title}` : t("Follow active session"),
        description: t("Follow active session"),
      },
      ...targets.map((session) => {
        const project = projectDisplayName(session.cwd);
        return {
          value: session.id,
          label: session.title || t("Untitled session"),
          description: project,
          keywords: `${project} ${session.cwd} ${session.harness}`,
        };
      }),
    ],
    [targets, active?.title],
  );
  const reply = !settings.natural ? "system" : settings.engine;
  const speaker = speakerEngine(settings);
  return (
    <div className={styles.choices}>
      <div className={styles.choice}>
        <Folder size={14} aria-hidden className={styles.choiceIcon} />
        <SearchableSelect
          label={t("Voice session")}
          variant="field"
          value={pinned ?? FOLLOW}
          options={sessionOptions}
          searchPlaceholder={t("Search sessions or projects…")}
          emptyLabel={t("No matching sessions")}
          onChange={(value) => onPin(value === FOLLOW ? null : value)}
        />
      </div>
      <div className={styles.choiceRow}>
        <Select
          label={t("Conversation")}
          value={settings.mode}
          fieldSize="sm"
          options={[
            { value: "local", label: t("Local"), icon: <Laptop size={14} /> },
            {
              value: "grok",
              label: "Grok Voice",
              icon: <HarnessIcon harness="grok" className="size-3.5" />,
            },
            {
              value: "openai",
              label: "OpenAI Realtime",
              icon: <HarnessIcon harness="codex" className="size-3.5" />,
            },
          ]}
          onValueChange={(mode) => change({ mode: mode as VoiceMode })}
        />
        {settings.mode === "local" ? (
          <Select
            label={t("Reply voice")}
            value={reply}
            fieldSize="sm"
            options={[
              { value: "supertonic", label: t("Natural"), icon: <AudioLines size={14} /> },
              { value: "voxcpm2", label: t("High quality"), icon: <AudioLines size={14} /> },
              { value: "elevenlabs", label: "ElevenLabs", icon: <AudioLines size={14} /> },
              { value: "system", label: t("System voice"), icon: <Laptop size={14} /> },
            ]}
            onValueChange={(value) =>
              change(
                value === "system"
                  ? { natural: false }
                  : { natural: true, engine: value as VoiceSettings["engine"] },
              )
            }
          />
        ) : null}
        {speaker ? (
          <Select
            label={t("Speaker")}
            value={settings.speakers[speaker]}
            fieldSize="sm"
            options={speakerOptions(speaker).map((option) => ({
              ...option,
              icon: <UserRound size={14} />,
            }))}
            onValueChange={(value) =>
              change({ speakers: { ...settings.speakers, [speaker]: value } })
            }
          />
        ) : null}
      </div>
    </div>
  );
}
