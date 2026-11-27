import { t, useLocale } from "../../../../shared/i18n";
import { CollectionRow } from "../../../../shared/ui/CollectionRow";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { StatusText, type StatusTextTone } from "../../../../shared/ui/StatusText";
import { Timestamp } from "../../../../shared/ui/Timestamp";
import type { VoiceWorkEntry } from "../../model/voiceWorkLedger";
import { voiceActionLabel } from "../VoiceToolActivityPanel";

/** Tone and label of an entry: dispatch outcome first, then the observed progress. */
export function voiceWorkStatus(entry: VoiceWorkEntry): [StatusTextTone, string] {
  if (entry.status === "running") return ["running", t("Starting")];
  if (entry.status === "failed" || entry.progress === "failed") return ["failed", t("Failed")];
  if (entry.status === "uncertain") return ["needs-you", t("Unknown")];
  if (entry.progress === "working") return ["running", t("Working")];
  if (entry.progress === "finished") return ["done", t("Finished")];
  return ["idle", t("Started")];
}

const folderOf = (path?: string) =>
  path
    ?.split(/[\\/]+/u)
    .filter(Boolean)
    .pop();

/**
 * Work the voice assistant started, newest first: title or action, project, status and age.
 * A row with a session opens it; the section is absent while the ledger is empty.
 */
export function VoiceWorkList({
  entries,
  onOpenSession,
}: {
  entries: readonly VoiceWorkEntry[];
  /** Opens the entry's session; without it rows are not actionable. */
  onOpenSession?: (entry: VoiceWorkEntry) => void;
}) {
  useLocale();
  if (!entries.length) return null;
  return (
    <section aria-label={t("Work started by voice")} className="grid min-w-0 gap-1">
      <SectionLabel as="h3">{t("Work started by voice")}</SectionLabel>
      <ul className="grid min-w-0">
        {entries.map((entry) => {
          const [tone, label] = voiceWorkStatus(entry);
          const openable = entry.sessionIds.length > 0 && !!onOpenSession;
          return (
            <CollectionRow
              as="li"
              key={entry.id}
              title={entry.title ?? voiceActionLabel(entry.action ?? entry.tool)}
              secondary={folderOf(entry.projectPath)}
              trailing={
                <span className="flex items-center gap-2">
                  <StatusText tone={tone}>{label}</StatusText>
                  <Timestamp
                    value={entry.startedAt}
                    format="relative"
                    relativeStyle="narrow"
                    size="caption"
                    tone="secondary"
                  />
                </span>
              }
              primary={{
                disabled: !openable,
                "data-voice-work-id": entry.id,
              }}
              onOpen={openable ? () => onOpenSession?.(entry) : undefined}
            />
          );
        })}
      </ul>
    </section>
  );
}
