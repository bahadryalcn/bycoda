import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { useEffect, useState } from "react";
import { formatNumber, t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { Modal, ModalActions } from "../../../../shared/ui/Modal";
import { TextField } from "../../../../shared/ui/TextField";
import type { SocialList, SocialPerson } from "../../model/audience";
import type { Sequence } from "../../model/outreach";
import type { SocialClient } from "../../model/socialClient";
import { LabeledSelect } from "./LabeledSelect";
import { AudienceReportList } from "./AudienceReportList";
import { addTag, addToList, addToSequence, type BulkResult } from "./audienceBulk";
import { errorMessage } from "./audienceModel";
import { presentRemoteError } from "../../../connections/public/remoteFailure";

export type BulkAction = "list" | "tag" | "sequence";

export type BulkDialogProps = {
  client: SocialClient;
  action: BulkAction;
  people: readonly Pick<SocialPerson, "id" | "name" | "tags">[];
  lists: readonly SocialList[];
  onClose: () => void;
  /** Called after the action ran, so the table can reload. */
  onDone: () => void;
};

function titleOf(action: BulkAction): string {
  switch (action) {
    case "list":
      return t("Add to list");
    case "tag":
      return t("Add a tag");
    case "sequence":
      return t("Add to sequence");
  }
}

function summaryOf(result: BulkResult): string {
  return t("{p0} updated, {p1} could not be updated", {
    p0: formatNumber(result.done),
    p1: formatNumber(result.failed.length),
  });
}

/** One dialog for the three "add the selected people" actions. Each shows how many worked. */
export function BulkDialog({ client, action, people, lists, onClose, onDone }: BulkDialogProps) {
  const ids = people.map((person) => person.id);
  const staticLists = lists.filter((list) => list.kind === "static");
  const [listId, setListId] = useState(staticLists[0]?.id ?? "");
  const [sequenceId, setSequenceId] = useState("");
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [tag, setTag] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<BulkResult>();

  useEffect(() => {
    if (action !== "sequence") return;
    let active = true;
    client.sequences
      .list()
      .then((listResult) => {
        if (active) setSequences(listResult.items);
      })
      .catch((err: unknown) => {
        if (active) setError(errorMessage(err));
      });
    return () => {
      active = false;
    };
  }, [action, client]);

  const reason =
    action === "list" && !listId
      ? t("Choose a list.")
      : action === "tag" && !tag.trim()
        ? t("Enter the tag to add.")
        : action === "sequence" && !sequenceId
          ? t("Choose a sequence.")
          : undefined;

  async function run() {
    if (reason) return;
    setRunning(true);
    setError(undefined);
    try {
      if (action === "list") {
        const changed = await addToList(client, listId, ids);
        setResult({ done: changed, failed: [] });
      } else if (action === "tag") {
        setResult(await addTag(client, people, tag.trim()));
      } else {
        const sequence = sequences.find((item) => item.id === sequenceId);
        if (!sequence) return;
        const changed = await addToSequence(client, sequence, ids);
        setResult({ done: changed, failed: [] });
      }
      onDone();
    } catch (err) {
      setError(presentRemoteError(err, { explicit: true }));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Modal
      title={titleOf(action)}
      description={t("{p0} selected", { p0: formatNumber(ids.length) })}
      onClose={() => {
        if (!running) onClose();
      }}
      footerStart={error ? <InlineError>{error}</InlineError> : undefined}
      footer={
        <ModalActions reason={result || error ? undefined : reason}>
          <Button variant="ghost" disabled={running} onClick={onClose}>
            {result ? t("Done") : t("Cancel")}
          </Button>
          {!result ? (
            <Button
              variant="primary"
              loading={running}
              disabled={Boolean(reason)}
              disabledReason={reason}
              onClick={() => void run().catch(() => undefined)}
            >
              {titleOf(action)}
            </Button>
          ) : null}
        </ModalActions>
      }
    >
      <div className="audience-stack">
        {action === "list" ? (
          <LabeledSelect
            label={t("List")}
            value={listId}
            disabled={running}
            options={[
              { value: "", label: t("Choose a list") },
              ...staticLists.map((list) => ({
                value: list.id,
                label: list.name,
              })),
            ]}
            onChange={setListId}
          />
        ) : null}
        {action === "tag" ? (
          <TextField
            label={t("Tag")}
            value={tag}
            disabled={running}
            onChange={(event) => setTag(event.target.value)}
          />
        ) : null}
        {action === "sequence" ? (
          <>
            <LabeledSelect
              label={t("Sequence")}
              value={sequenceId}
              disabled={running}
              options={[
                { value: "", label: t("Choose a sequence") },
                ...sequences.map((sequence) => ({
                  value: sequence.id,
                  label: sequence.name,
                })),
              ]}
              onChange={setSequenceId}
            />
            <InfoPopover className="self-end shrink-0">
              {t(
                "The sequence runs for its own list, so the selected people are added to that list.",
              )}
            </InfoPopover>
          </>
        ) : null}
        {result ? (
          <section aria-label={t("Result")} className="audience-stack">
            <InlineMessage tone={result.failed.length ? "warning" : "success"}>
              {summaryOf(result)}
            </InlineMessage>
            <AudienceReportList
              items={result.failed}
              renderRow={(item) => {
                const name = people.find((person) => person.id === item.personId)?.name;
                return (
                  <li key={item.personId}>
                    {name ? t("{p0}: {p1}", { p0: name, p1: item.reason }) : item.reason}
                  </li>
                );
              }}
              overflowLabel={(p0) => t("And {p0} more could not be updated.", { p0 })}
            />
          </section>
        ) : null}
      </div>
    </Modal>
  );
}
