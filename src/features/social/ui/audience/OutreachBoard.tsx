import { LoadingText } from "../../../../shared/ui/LoadingText";
import { useCallback, useEffect, useState } from "react";
import { formatNumber, t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { DescriptionItem, DescriptionList } from "../../../../shared/ui/DescriptionList";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { Plus } from "../../../../shared/ui/icons";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { Surface } from "../../../../shared/ui/Surface";
import type { SocialList } from "../../model/audience";
import type { Sequence } from "../../model/outreach";
import type { SequenceStats } from "../../model/socialActions";
import type { SocialClient } from "../../model/socialClient";
import { EmptyHint } from "../common/EmptyHint";
import { OutreachSequenceCard } from "./OutreachSequenceCard";
import { SequenceEditor } from "./SequenceEditor";
import { errorMessage, listDisplayName, rateText } from "./audienceModel";
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

/**
 * Sequences, their results and Start/Pause. Results are the Host's own totals for all sequences
 * or for the one that is chosen. Host refusals (owner rights, autonomy) are shown as they come.
 */
export function OutreachBoard({ client, lists, onChanged }: OutreachBoardProps) {
  const [sequences, setSequences] = useState<Sequence[]>();
  const [stats, setStats] = useState<SequenceStats>(EMPTY_STATS);
  const [selectedId, setSelectedId] = useState<string>();
  const [editing, setEditing] = useState<Sequence | "new">();
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    Promise.all([client.sequences.list(), client.sequences.stats(selectedId)])
      .then(([list, result]) => {
        setError(undefined);
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
  const hasSequences = Boolean(sequences?.length);
  return (
    <div className="audience-stack">
      <SectionLabel
        actions={
          <>
            {selected ? (
              <Button variant="ghost" size="sm" onClick={() => setSelectedId(undefined)}>
                {t("Show all sequences")}
              </Button>
            ) : null}
            {hasSequences ? (
              <Button
                variant="primary"
                size="sm"
                startIcon={<Plus className="icon-sm" aria-hidden="true" />}
                onClick={() => setEditing("new")}
              >
                {t("New sequence")}
              </Button>
            ) : null}
          </>
        }
      >
        {selected ? t("Results for {p0}", { p0: selected.name }) : t("Results for all sequences")}
      </SectionLabel>

      {hasSequences ? (
        <Surface variant="card" padding="none" className="audience-stats">
          <DescriptionList columns="auto" className="px-3 py-2">
            <DescriptionItem term={t("Sent")}>{formatNumber(stats.sent)}</DescriptionItem>
            <DescriptionItem term={t("Replied")}>
              {formatNumber(stats.replied)}
              {stats.sent > 0 ? ` (${rateText(stats.replied, stats.sent)})` : ""}
            </DescriptionItem>
            <DescriptionItem term={t("Positive replies")}>
              {formatNumber(stats.positive)}
            </DescriptionItem>
            <DescriptionItem term={t("Opt-out rate")}>
              {rateText(stats.optedOut, stats.sent)}
            </DescriptionItem>
          </DescriptionList>
        </Surface>
      ) : null}
      {stats.failed > 0 ? (
        <InlineMessage tone="warning">
          {t("{p0} could not be sent.", { p0: formatNumber(stats.failed) })}
        </InlineMessage>
      ) : null}

      {error ? <InlineError>{error}</InlineError> : null}
      {sequences === undefined && !error ? (
        <LoadingText delay={false} className="audience-muted">
          {t("Loading sequences…")}
        </LoadingText>
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
        <Surface as="ul" variant="card" padding="none" className="audience-frame">
          {sequences.map((sequence, index) => {
            const list = lists.find((item) => item.id === sequence.listId);
            return (
              <OutreachSequenceCard
                key={sequence.id}
                sequence={sequence}
                separated={index > 0}
                listName={list ? listDisplayName(list) : ""}
                selected={sequence.id === selectedId}
                busy={busyId === sequence.id}
                blocked={startBlockReason(sequence)}
                onSelect={() => setSelectedId(sequence.id)}
                onSetRunning={(start) => void setRunning(sequence, start).catch(() => undefined)}
                onEdit={() => setEditing(sequence)}
              />
            );
          })}
        </Surface>
      ) : null}

      {editing ? (
        <SequenceEditor
          client={client}
          sequence={editing === "new" ? undefined : editing}
          lists={lists}
          onClose={() => setEditing(undefined)}
          onSaved={(saved) => {
            setSequences((current) =>
              current?.some((item) => item.id === saved.id)
                ? current.map((item) => (item.id === saved.id ? saved : item))
                : [...(current ?? []), saved],
            );
            setSelectedId(saved.id);
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}
