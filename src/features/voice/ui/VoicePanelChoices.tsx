import { useMemo, useState, type ReactNode } from "react";
import type { Session } from "../../sessions/model/session";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { projectDisplayName } from "../../projects/model/projectNames";
import { Button } from "../../../shared/ui/Button";
import { ContextMenu, type ContextMenuItem } from "../../../shared/ui/ContextMenu";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { AudioLines, Laptop, SlidersHorizontal, UserRound } from "../../../shared/ui/icons";
import { speakerEngine, speakerLabel, speakerOptions } from "../model/voiceSpeakers";
import { t } from "../../../shared/i18n";
import {
  loadVoiceSettings,
  saveVoiceSettings,
  useVoiceSettings,
  type VoiceMode,
  type VoiceSettings,
} from "../model/voiceSettings";

const FOLLOW = "__follow-active__";

/** The session (and so the project) voice talks to; following the active one by default. */
export function VoiceSessionPicker({
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
  // Internal workers and temporary Inbox questions are not voice targets.
  const targets = useMemo(
    () => sessions.filter((session) => !session.orchestrationLeadId && !session.inboxAsk),
    [sessions],
  );
  const active = targets.find((session) => session.id === activeId);
  const options = useMemo(
    () => [
      {
        value: FOLLOW,
        label: active ? active.title || t("Untitled session") : t("Follow active session"),
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
  return (
    <SearchableSelect
      label={t("Voice session")}
      variant="transparent"
      value={pinned ?? FOLLOW}
      options={options}
      searchPlaceholder={t("Search sessions or projects…")}
      emptyLabel={t("No matching sessions")}
      onChange={(value) => onPin(value === FOLLOW ? null : value)}
    />
  );
}

const MODES: { value: VoiceMode; label: () => string; icon: () => ReactNode }[] = [
  { value: "local", label: () => t("Local"), icon: () => <Laptop size={14} /> },
  {
    value: "grok",
    label: () => "Grok Voice",
    icon: () => <HarnessIcon harness="grok" className="size-3.5" />,
  },
  {
    value: "openai",
    label: () => "OpenAI Realtime",
    icon: () => <HarnessIcon harness="codex" className="size-3.5" />,
  },
];
const REPLIES = [
  { value: "supertonic", label: () => t("Natural") },
  { value: "voxcpm2", label: () => t("High quality") },
  { value: "elevenlabs", label: () => "ElevenLabs" },
  { value: "system", label: () => t("System voice") },
];

/**
 * Conversation, reply voice and speaker in one menu. A change disconnects a live
 * connection; Start voice uses the new choice.
 */
export function VoiceOptionsMenu() {
  const settings = useVoiceSettings();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const change = (patch: Partial<VoiceSettings>) =>
    saveVoiceSettings({ ...loadVoiceSettings(), ...patch });
  const reply = !settings.natural ? "system" : settings.engine;
  const speaker = speakerEngine(settings);
  const mode = MODES.find((entry) => entry.value === settings.mode) ?? MODES[0]!;
  const items: ContextMenuItem[] = [
    {
      kind: "item",
      id: "mode",
      label: t("Conversation"),
      description: mode.label(),
      icon: mode.icon(),
      submenu: MODES.map((entry) => ({
        kind: "item" as const,
        id: `mode:${entry.value}`,
        label: entry.label(),
        icon: entry.icon(),
        checked: entry.value === settings.mode,
      })),
    },
  ];
  if (settings.mode === "local")
    items.push({
      kind: "item",
      id: "reply",
      label: t("Reply voice"),
      description: REPLIES.find((entry) => entry.value === reply)?.label(),
      icon: <AudioLines size={14} />,
      submenu: REPLIES.map((entry) => ({
        kind: "item" as const,
        id: `reply:${entry.value}`,
        label: entry.label(),
        checked: entry.value === reply,
      })),
    });
  if (speaker)
    items.push({
      kind: "item",
      id: "speaker",
      label: t("Speaker"),
      description: speakerLabel(speaker, settings.speakers[speaker]),
      icon: <UserRound size={14} />,
      submenu: speakerOptions(speaker).map((option) => ({
        kind: "item" as const,
        id: `speaker:${option.value}`,
        label: option.label,
        checked: option.value === settings.speakers[speaker],
      })),
    });
  return (
    <>
      <Button
        iconOnly
        label={t("Voice options")}
        tooltip={t("Voice options")}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        <SlidersHorizontal size={14} />
      </Button>
      {anchor && (
        <ContextMenu
          anchor={anchor}
          ariaLabel={t("Voice options")}
          align="end"
          items={items}
          onClose={() => setAnchor(null)}
          onPick={(id) => {
            const [kind, value] = id.split(":");
            if (!value) return;
            if (kind === "mode") change({ mode: value as VoiceMode });
            else if (kind === "reply")
              change(
                value === "system"
                  ? { natural: false }
                  : { natural: true, engine: value as VoiceSettings["engine"] },
              );
            else if (kind === "speaker" && speaker)
              change({ speakers: { ...settings.speakers, [speaker]: value } });
            setAnchor(null);
          }}
        />
      )}
    </>
  );
}
