import { useState } from "react";
import { formatNumber, t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { Modal, ModalActions } from "../../../../shared/ui/Modal";
import { NumberField } from "../../../../shared/ui/NumberField";
import { TextField } from "../../../../shared/ui/TextField";
import { SOCIAL_PLATFORM_NAMES } from "../../model/social";
import type { SocialAccount } from "../../model/social";
import type { SocialList } from "../../model/audience";
import type { CollectResult } from "../../model/socialActions";
import type { SocialClient } from "../../model/socialClient";
import { DisabledReason } from "../common/DisabledReason";
import { TechnicalDetails } from "../common/TechnicalDetails";
import { LabeledSelect } from "./LabeledSelect";
import { errorMessage } from "./audienceModel";
import {
  FIND_PEOPLE_KINDS,
  buildFindPeopleSource,
  captureSourceLabel,
  emptyFindPeopleForm,
  findPeopleNeeds,
  type CaptureSourceKind,
  type FindPeopleForm,
} from "./findPeopleSource";

export const COLLECT_LIMIT_MAX = 500;

export type FindPeopleDialogProps = {
  client: SocialClient;
  accounts: readonly SocialAccount[];
  lists: readonly SocialList[];
  onClose: () => void;
  /** Called after a collection ran, so the table can reload. */
  onCollected: (result: CollectResult) => void;
};

function accountLabel(account: SocialAccount): string {
  return `${SOCIAL_PLATFORM_NAMES[account.platform]} · ${account.name}`;
}

/** The one primary action of the audience screen: pick an account and a source, then collect. */
export function FindPeopleDialog({
  client,
  accounts,
  lists,
  onClose,
  onCollected,
}: FindPeopleDialogProps) {
  const [form, setForm] = useState<FindPeopleForm>(() => emptyFindPeopleForm(accounts[0]?.id));
  const [listId, setListId] = useState(lists.find((list) => list.kind === "static")?.id ?? "");
  const [limit, setLimit] = useState("100");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<CollectResult>();

  const built = buildFindPeopleSource(form);
  const limitValue = Number(limit);
  const limitValid =
    Number.isInteger(limitValue) && limitValue >= 1 && limitValue <= COLLECT_LIMIT_MAX;
  const reason = !accounts.length
    ? t("Connect an account in Accounts & Settings first.")
    : "error" in built
      ? built.error
      : !limitValid
        ? t("Enter a whole number from 1 to {p0}.", { p0: COLLECT_LIMIT_MAX })
        : undefined;
  const actionState = reason ? { disabled: true as const, reason } : { disabled: false as const };
  const needs = findPeopleNeeds(form.kind);

  async function run() {
    if ("error" in built || !limitValid) return;
    setRunning(true);
    setError(undefined);
    setResult(undefined);
    try {
      const collected = await client.audience.collect({
        source: built.source,
        targetListId: listId || undefined,
        limit: limitValue,
      });
      setResult(collected);
      onCollected(collected);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Modal
      title={t("Find people")}
      description={t("Collects public people from one of your accounts. Nothing is sent to them.")}
      onClose={() => {
        if (!running) onClose();
      }}
      size="lg"
      footerStart={error ? <InlineError>{error}</InlineError> : undefined}
      footer={
        <ModalActions>
          <Button variant="ghost" disabled={running} onClick={onClose}>
            {result ? t("Done") : t("Cancel")}
          </Button>
          <DisabledReason
            variant="primary"
            loading={running}
            {...actionState}
            onClick={() => void run().catch(() => undefined)}
          >
            {t("Find people")}
          </DisabledReason>
        </ModalActions>
      }
    >
      <div className="audience-stack">
        <LabeledSelect
          label={t("Account")}
          value={form.accountId}
          disabled={running || !accounts.length}
          options={accounts.map((account) => ({ value: account.id, label: accountLabel(account) }))}
          onChange={(accountId) => setForm({ ...form, accountId })}
        />
        <LabeledSelect
          label={t("Where to look")}
          value={form.kind}
          disabled={running}
          options={FIND_PEOPLE_KINDS.map((kind: CaptureSourceKind) => ({
            value: kind,
            label: captureSourceLabel(kind),
          }))}
          onChange={(kind) => setForm({ ...form, kind: kind as CaptureSourceKind })}
        />
        {needs === "postRef" ? (
          <TextField
            label={t("Post link or ID (optional)")}
            placeholder={t("Leave empty to use all recent posts")}
            value={form.postRef}
            disabled={running}
            onChange={(event) => setForm({ ...form, postRef: event.target.value })}
          />
        ) : null}
        {needs === "query" ? (
          <TextField
            label={t("Keyword or hashtag")}
            value={form.query}
            disabled={running}
            onChange={(event) => setForm({ ...form, query: event.target.value })}
          />
        ) : null}
        {needs === "handle" ? (
          <TextField
            label={t("Account handle")}
            placeholder="@name"
            value={form.handle}
            disabled={running}
            onChange={(event) => setForm({ ...form, handle: event.target.value })}
          />
        ) : null}
        <LabeledSelect
          label={t("Add them to")}
          value={listId}
          disabled={running}
          options={[
            { value: "", label: t("Only All people") },
            ...lists
              .filter((list) => list.kind === "static")
              .map((list) => ({ value: list.id, label: list.name })),
          ]}
          onChange={setListId}
        />
        <NumberField
          label={t("Maximum people")}
          min={1}
          max={COLLECT_LIMIT_MAX}
          value={limit}
          disabled={running}
          error={
            limitValid
              ? undefined
              : t("Enter a whole number from 1 to {p0}.", { p0: COLLECT_LIMIT_MAX })
          }
          onChange={(event) => setLimit(event.target.value)}
        />
        {result && !result.unsupported ? (
          <InlineMessage tone="success">
            {t("{p0} people added, {p1} skipped", {
              p0: formatNumber(result.collected),
              p1: formatNumber(result.skipped),
            })}
          </InlineMessage>
        ) : null}
        {result?.unsupported ? (
          <InlineMessage tone="warning">
            {t("This search is not available for this account yet. Try another source.")}
            <TechnicalDetails>
              <code>{result.unsupported}</code>
            </TechnicalDetails>
          </InlineMessage>
        ) : null}
      </div>
    </Modal>
  );
}
