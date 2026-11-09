import { useCallback, useEffect, useState } from "react";
import { formatNumber, t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { DescriptionItem, DescriptionList } from "../../../../shared/ui/DescriptionList";
import { Meter } from "../../../../shared/ui/Meter";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { InlineError } from "../../../../shared/ui/InlineError";
import type { SocialList } from "../../model/audience";
import type { Sequence } from "../../model/outreach";
import type { SequenceStats } from "../../model/socialActions";
import type { SocialClient } from "../../model/socialClient";
import { EmptyHint } from "../common/EmptyHint";
import { OutreachSequenceCard } from "./OutreachSequenceCard";
import { SequenceEditor } from "./SequenceEditor";
import { errorMessage, rateText } from "./audienceModel";
import "./audience.css";

export type OutreachBoardProps = {
  client: SocialClient;
  lists: readonly SocialList[];
  onChanged: () => void;
};

const EMPTY_STATS: SequenceStats = { sent: 0, replied: 0, positive: 0, optedOut: 0, failed: 0 };

/** Why a sequence cannot start yet, in plain words. Undefined means it can start. */
export function startBlockReason(sequence: Sequence): string | undefined {
  if (sequence.status === "done") return t("This sequence has finished.");
  if (sequence.status === "active") return t("This sequence is already running.");
  if (!sequence.steps.length) return t("Add at least one step first.");
  if (!sequence.listId) return t("Choose the list of people first.");
  return undefined;
}

/** Sequences, their results and Start/Pause. Host refusals (owner rights, autonomy) are shown as they come. */
export function OutreachBoard({ client, lists, onChanged }: OutreachBoardProps) {
  const [sequences, setSequences] = useState<Sequence[]>();
  const [stats, setStats] = useState<SequenceStats>(EMPTY_STATS);
  const [selectedId, setSelectedId] = useState<string>();
  const [editing, setEditing] = useState<Sequence | "new">();
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    setError(undefined);
    Promise.all([client.sequences.list(), client.sequences.stats(selectedId)])
      .then(([list, result]) => {
        setSequences(list.items);
        setStats(result);
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [client, selectedId]);

  useEffect(() => {
    load();
  }, [load]);

  async function setRunning(sequence: Sequence, start: boolean) {
    setBusyId(sequence.id);
    setError(undefined);
    try {
      const updated = start
        ? await client.sequences.start(sequence.id)
        : await client.sequences.pause(sequence.id);
      setSequences((current) => current?.map((item) => (item.id === updated.id ? updated : item)));
      onChanged();
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(undefined);
    }
  }

  const selected = sequences?.find((sequence) => sequence.id === selectedId);
  return (
    <div className="audience-stack">
      <div className="audience-row">
        <SectionLabel>
          {selected ? t("Results for {p0}", { p0: selected.name }) : t("Results for all sequences")}
        </SectionLabel>
        <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
          {t("New sequence")}
        </Button>
      </div>

      <DescriptionList columns="auto" className="audience-stats">
        <DescriptionItem term={t("Sent")}>{formatNumber(stats.sent)}</DescriptionItem>
        <DescriptionItem term={t("Replied")}>
          {formatNumber(stats.replied)}
          <Meter
            className="audience-stat-meter"
            label={t("Reply rate")}
            value={stats.sent > 0 ? (stats.replied / stats.sent) * 100 : null}
            valueText={rateText(stats.replied, stats.sent)}
            tone="accent"
          />
        </DescriptionItem>
        <DescriptionItem term={t("Positive replies")}>
          {formatNumber(stats.positive)}
        </DescriptionItem>
        <DescriptionItem term={t("Opt-out rate")}>
          {rateText(stats.optedOut, stats.sent)}
        </DescriptionItem>
      </DescriptionList>
      {stats.failed > 0 ? (
        <p className="audience-caption">
          {t("{p0} could not be sent.", { p0: formatNumber(stats.failed) })}
        </p>
      ) : null}

      {error ? <InlineError>{error}</InlineError> : null}
      {sequences === undefined && !error ? (
        <p className="audience-muted">{t("Loading sequences…")}</p>
      ) : null}
      {sequences && !sequences.length ? (
        <EmptyHint
          message={t(
            "No sequences yet. A sequence sends a few messages over days and stops when someone replies.",
          )}
          action={{ label: t("New sequence"), onClick: () => setEditing("new") }}
        />
      ) : null}

      {sequences?.length ? (
        <ul className="audience-frame">
          {sequences.map((sequence) => (
            <OutreachSequenceCard
              key={sequence.id}
              sequence={sequence}
              selected={sequence.id === selectedId}
              busy={busyId === sequence.id}
              blocked={startBlockReason(sequence)}
              onSelect={() => setSelectedId(sequence.id)}
              onSetRunning={(start) => void setRunning(sequence, start).catch(() => undefined)}
              onEdit={() => setEditing(sequence)}
            />
          ))}
        </ul>
      ) : null}

      {editing ? (
        <SequenceEditor
          client={client}
          sequence={editing === "new" ? undefined : editing}
          lists={lists}
          onClose={() => setEditing(undefined)}
          onSaved={(saved) => {
            setSequences((current) => {
              const rest = (current ?? []).filter((item) => item.id !== saved.id);
              return [...rest, saved];
            });
            setSelectedId(saved.id);
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}
