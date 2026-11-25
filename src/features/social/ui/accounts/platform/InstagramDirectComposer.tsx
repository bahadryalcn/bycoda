import { useEffect, useRef, useSyncExternalStore } from "react";
import type { HostProject } from "../../../../connections/public/protocol";
import { presentRemoteError } from "../../../../connections/public/remoteFailure";
import { t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { FieldGroup } from "../../../../../shared/ui/FieldGroup";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { SearchableSelect } from "../../../../../shared/ui/SearchableSelect";
import { TextareaField } from "../../../../../shared/ui/TextareaField";
import { TextField } from "../../../../../shared/ui/TextField";
import type {
  SocialAccount,
  SocialContact,
  SocialDraft,
  SocialJob,
  SocialJobsPage,
} from "../../../model/social";
import type { SocialClient } from "../../../model/socialClient";
import { socialQueryScope } from "../../../model/socialQuery";
import "./instagram.css";

type ComposerInput = { handle: string; projectId: string; text: string };
type Attempt = {
  input: ComposerInput;
  requestIds: { contact: string; draft: string; approve: string; send: string };
  recipient?: { handle: string; platformId: string };
  draft?: SocialDraft;
  sendAttempted?: true;
  job?: SocialJob;
};
type ComposerState = {
  input: ComposerInput;
  attempt?: Attempt;
  pending?: "review" | "send" | "status";
  feedback?: "queued" | "uncertain" | "notQueued";
  error?: string;
};

function createComposerStore() {
  let value: ComposerState = { input: { handle: "", projectId: "", text: "" } };
  const listeners = new Set<() => void>();
  return {
    read: () => value,
    update(patch: Partial<ComposerState>) {
      value = { ...value, ...patch };
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// Switching accounts or leaving Accounts retains in-flight reviews and typed drafts on their Host.
const composerStores = new WeakMap<
  SocialClient,
  Map<string, ReturnType<typeof createComposerStore>>
>();

function composerStore(client: SocialClient, key: string) {
  let accounts = composerStores.get(client);
  if (!accounts) {
    accounts = new Map();
    composerStores.set(client, accounts);
  }
  let store = accounts.get(key);
  if (!store) {
    store = createComposerStore();
    accounts.set(key, store);
  }
  return store;
}

/** Loads a proposed message into the composer; the owner still reviews and queues it there. */
export function prefillInstagramDirect(
  client: SocialClient,
  account: Pick<SocialAccount, "id" | "platformId" | "executorId">,
  input: { handle: string; text: string },
) {
  const store = composerStore(
    client,
    JSON.stringify([account.id, account.platformId, account.executorId]),
  );
  const current = store.read();
  if (current.pending || current.attempt?.sendAttempted) return false;
  store.update({
    input: { ...current.input, ...input },
    attempt: undefined,
    feedback: undefined,
    error: undefined,
  });
  return true;
}

function newAttempt(input: ComposerInput): Attempt {
  return {
    input,
    requestIds: {
      contact: crypto.randomUUID(),
      draft: crypto.randomUUID(),
      approve: crypto.randomUUID(),
      send: crypto.randomUUID(),
    },
  };
}

async function prepareDraft(
  client: SocialClient,
  accountId: string,
  store: ReturnType<typeof createComposerStore>,
  attempt: Attempt,
) {
  if (attempt.draft) return attempt.draft;
  const { handle, projectId, text } = attempt.input;
  const recipient =
    attempt.recipient ?? (await client.browserInstagramRecipient(accountId, handle));
  if (recipient.handle !== handle || !/^\d{1,30}$/.test(recipient.platformId))
    throw new Error(t("Could not verify this Instagram recipient."));
  store.update({ attempt: { ...attempt, recipient } });
  const contact = await client.request<SocialContact>(
    "contacts.upsert",
    {
      accountId,
      platformId: recipient.platformId,
      name: recipient.handle,
      instagramRecipientProjectId: projectId,
    },
    attempt.requestIds.contact,
  );
  if (
    contact.accountId !== accountId ||
    contact.platformId !== recipient.platformId ||
    !contact.projectIds.includes(projectId)
  )
    throw new Error(t("Could not verify this Instagram recipient."));
  const draft = await client.request<SocialDraft>(
    "messages.draft",
    { accountId, projectId, contactId: contact.id, text },
    attempt.requestIds.draft,
  );
  if (
    draft.kind !== "message" ||
    draft.accountId !== accountId ||
    draft.projectId !== projectId ||
    draft.contactId !== contact.id ||
    draft.text !== text
  )
    throw new Error(t("The message could not be prepared."));
  store.update({ attempt: { ...attempt, recipient, draft } });
  return draft;
}

async function checkMessage(
  client: SocialClient,
  accountId: string,
  attempt: Attempt,
): Promise<SocialJob | undefined> {
  if (attempt.job)
    return await client.request<SocialJob>("jobs.status", {
      id: attempt.job.id,
    });
  const { jobs } = await client.request<SocialJobsPage>("jobs.status", {
    page: true,
    offset: 0,
    limit: 100,
  });
  return jobs.find((job) => job.accountId === accountId && job.draftId === attempt.draft?.id);
}

function showReceipt(store: ReturnType<typeof createComposerStore>, job: SocialJob | undefined) {
  const { attempt, input } = store.read();
  if (
    !job ||
    !attempt?.draft ||
    job.draftId !== attempt.draft.id ||
    job.accountId !== attempt.draft.accountId ||
    job.kind !== "message"
  ) {
    store.update({ feedback: "uncertain" });
    return;
  }
  if (job.status === "queued" || job.status === "running" || job.status === "succeeded") {
    store.update({
      attempt: undefined,
      input: { ...input, text: "" },
      feedback: "queued",
    });
  } else if (!job.dispatchedAt && (job.status === "failed" || job.status === "cancelled")) {
    store.update({ attempt: undefined, feedback: "notQueued" });
  } else {
    store.update({ attempt: { ...attempt, job }, feedback: "uncertain" });
  }
}

type InstagramDirectComposerProps = {
  client: SocialClient;
  account: SocialAccount;
  projects: readonly HostProject[];
  disabled: boolean;
};

export function InstagramDirectComposer(props: InstagramDirectComposerProps) {
  const accountKey = JSON.stringify([
    props.account.id,
    props.account.platformId,
    props.account.executorId,
  ]);
  return (
    <Composer
      key={`${socialQueryScope(props.client).join(":")}:${accountKey}`}
      {...props}
      accountKey={accountKey}
    />
  );
}

function Composer({
  client,
  account,
  projects,
  disabled,
  accountKey,
}: InstagramDirectComposerProps & { accountKey: string }) {
  const store = composerStore(client, accountKey);
  const state = useSyncExternalStore(store.subscribe, store.read);
  const confirmation = useConfirm();
  const mounted = useRef(false);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Track the mounted confirmation dialog so late recipient verification cannot open it after leaving Accounts.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const options = projects
    .filter(({ id }) => account.grants[id]?.includes("message"))
    .map(({ id, name }) => ({ value: id, label: name }));
  const project = state.input.projectId
    ? options.find(({ value }) => value === state.input.projectId)
    : options.length === 1
      ? options[0]
      : undefined;
  const handle = state.input.handle.trim().replace(/^@/, "").toLowerCase();
  const text = state.input.text.trim();
  const sendAttempted = state.attempt?.sendAttempted;
  const accountUnavailable =
    disabled || account.paused || !account.connected || !account.accessApproved;
  const updateInput = (patch: Partial<ComposerInput>) => {
    const current = store.read();
    if (current.pending || current.attempt?.sendAttempted) return;
    store.update({
      input: { ...current.input, ...patch },
      attempt: undefined,
      feedback: undefined,
      error: undefined,
    });
  };

  const review = async () => {
    const current = store.read();
    if (
      accountUnavailable ||
      !project ||
      !handle ||
      !text ||
      current.pending ||
      current.attempt?.sendAttempted
    )
      return;
    const input = { handle, projectId: project.value, text };
    const saved = current.attempt;
    const attempt =
      saved &&
      saved.input.handle === handle &&
      saved.input.text === text &&
      saved.input.projectId === project.value
        ? saved
        : newAttempt(input);
    store.update({
      attempt,
      pending: "review",
      feedback: undefined,
      error: undefined,
    });
    try {
      const draft = await prepareDraft(client, account.id, store, attempt);
      if (!mounted.current) return;
      const approved = await confirmation.confirm({
        title: t("Review Instagram message"),
        message: t("Queue this message from {p0} to @{p1} for {p2}?", {
          p0: account.name,
          p1: handle,
          p2: project.label,
        }),
        details: <TextareaField label={t("Message")} value={draft.text} readOnly rows={3} />,
        confirmLabel: t("Queue Instagram message"),
        danger: false,
      });
      if (!approved || !mounted.current) return;
      store.update({ pending: "send" });
      await client.request(
        "drafts.approve",
        { id: draft.id, reviewedDraft: draft },
        attempt.requestIds.approve,
      );
      store.update({
        attempt: { ...store.read().attempt!, sendAttempted: true },
      });
      const job = await client.request<SocialJob>(
        "messages.send",
        { id: draft.id },
        attempt.requestIds.send,
      );
      showReceipt(store, job);
    } catch (cause) {
      store.update({
        ...(store.read().attempt?.sendAttempted ? { feedback: "uncertain" as const } : {}),
        error: presentRemoteError(cause, { explicit: true }),
      });
    } finally {
      store.update({ pending: undefined });
    }
  };

  const checkStatus = async () => {
    const { attempt, pending } = store.read();
    if (disabled || pending || !attempt?.sendAttempted) return;
    store.update({ pending: "status", error: undefined });
    try {
      showReceipt(store, await checkMessage(client, account.id, attempt));
    } catch (cause) {
      store.update({ error: presentRemoteError(cause, { explicit: true }) });
    } finally {
      store.update({ pending: undefined });
    }
  };

  return (
    <FieldGroup legend={t("New Instagram message")} hideLegend>
      {options.length || sendAttempted ? (
        <>
          <div className="instagram-grid">
            <SearchableSelect
              label={t("Project")}
              options={options}
              value={project?.value ?? ""}
              onChange={(projectId) => updateInput({ projectId })}
              disabled={accountUnavailable || !!state.pending || !!sendAttempted}
            />
            <TextField
              label={t("Instagram username")}
              value={state.input.handle}
              maxLength={31}
              disabled={accountUnavailable || !!state.pending || !!sendAttempted}
              onChange={(event) => updateInput({ handle: event.currentTarget.value })}
            />
          </div>
          <TextareaField
            label={t("Message")}
            value={state.input.text}
            rows={3}
            disabled={accountUnavailable || !!state.pending || !!sendAttempted}
            onChange={(event) => updateInput({ text: event.currentTarget.value })}
          />
          {sendAttempted ? (
            <Button
              variant="secondary"
              size="sm"
              loading={state.pending === "status"}
              disabled={disabled || !!state.pending}
              onClick={() => void checkStatus().catch(() => undefined)}
            >
              {t("Check status")}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              loading={
                state.pending === "send" || (state.pending === "review" && !state.attempt?.draft)
              }
              disabled={accountUnavailable || !!state.pending || !project || !handle || !text}
              onClick={() => void review().catch(() => undefined)}
            >
              {t("Review Instagram message")}
            </Button>
          )}
        </>
      ) : (
        <InlineMessage live="off">
          {t("Grant a project permission to send new messages.")}
        </InlineMessage>
      )}
      {state.error ? <InlineError>{state.error}</InlineError> : null}
      {state.feedback === "queued" ? (
        <InlineMessage tone="success">
          {t("Instagram message queued. Check Activity for delivery.")}
        </InlineMessage>
      ) : null}
      {state.feedback === "uncertain" ? (
        <InlineMessage tone="warning">
          {t("The send result is uncertain. Check Activity for the original message.")}
        </InlineMessage>
      ) : null}
      {state.feedback === "notQueued" ? (
        <InlineMessage tone="warning">
          {t("The Instagram message did not leave the queue.")}
        </InlineMessage>
      ) : null}
      {confirmation.dialog}
    </FieldGroup>
  );
}
