import { Alert } from "../../../shared/ui/Alert";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Button } from "../../../shared/ui/Button";
import { useEffect, useState } from "react";
import { XMediaFields } from "./XMediaFields";
import { socialRows } from "../model/socialWorkspace";
import type {
  SocialDraft,
  SocialDraftApprovalInput,
  SocialPolicy,
  SocialSnapshot,
} from "../model/social";
import type { SocialClient } from "../model/socialClient";
import {
  effectiveSocialPolicy,
  DEFAULT_SOCIAL_POLICIES,
  socialCharacterCount,
  socialLimit,
} from "../model/socialPolicy";
import { HARNESS_TITLE } from "../../sessions/model/session";
import { t, useLocale } from "../../../shared/i18n";
import { Notice, StatusBadge, statuses, time, type Run } from "./socialShared";

export function DraftList({
  drafts,
  client,
  run,
  snapshot,
}: {
  drafts: SocialDraft[];
  client: SocialClient;
  run: Run;
  snapshot?: SocialSnapshot;
}) {
  return (
    <div>
      {drafts.map((draft) => (
        <Draft key={draft.id} draft={draft} client={client} run={run} snapshot={snapshot} />
      ))}
    </div>
  );
}

function Draft({
  draft,
  client,
  run,
  snapshot,
}: {
  draft: SocialDraft;
  client: SocialClient;
  run: Run;
  snapshot?: SocialSnapshot;
}) {
  useLocale();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(draft.text);
  const [factIds, setFactIds] = useState(draft.factIds);
  const [media, setMedia] = useState(draft.media ?? []);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [editPolicy, setEditPolicy] = useState<SocialPolicy>();
  const [policyError, setPolicyError] = useState("");
  const [policyAttempt, setPolicyAttempt] = useState(0);
  const facts =
    snapshot?.profiles.find((profile) => profile.projectId === draft.projectId)?.facts ?? [];
  const missingFacts = snapshot
    ? factIds.filter((id) => !facts.some((fact) => fact.id === id))
    : [];
  const account = snapshot?.accounts.find((item) => item.id === draft.accountId);
  useEffect(() => {
    if (!editing || !account) return;
    let cancelled = false;
    setEditPolicy(undefined);
    setPolicyError("");
    void client
      .request<{ effective: SocialPolicy }>("policy.get", { accountId: account.id })
      .then((result) => {
        if (!cancelled) setEditPolicy(result.effective);
      })
      .catch(() => {
        if (!cancelled) setPolicyError(t("Could not load account limits."));
      });
    return () => {
      cancelled = true;
    };
  }, [editing, account?.id, client, policyAttempt]);
  const contact =
    snapshot &&
    socialRows(snapshot.contacts, snapshot.related?.contacts).find(
      (item) => item.id === draft.contactId,
    );
  const thread =
    snapshot &&
    socialRows(snapshot.threads, snapshot.related?.threads).find(
      (item) => item.id === draft.threadId,
    );
  const job =
    snapshot &&
    socialRows(snapshot.jobs, snapshot.related?.jobs).find(
      (item) => item.draftId === draft.id && item.status !== "cancelled",
    );
  const generating =
    draft.generation?.status === "running" || draft.generation?.status === "queued";
  const limit = account
    ? socialLimit(
        editPolicy ??
          effectiveSocialPolicy(snapshot?.policies ?? DEFAULT_SOCIAL_POLICIES, account.platform),
        draft.kind === "comment"
          ? "comment"
          : draft.kind === "reply" && thread?.kind === "comment"
            ? "comment"
            : "message",
      )
    : undefined;
  const count = socialCharacterCount(text);
  const disabledReason = job
    ? t("Send status: {p0}.", { p0: statuses[job.status] })
    : limit && socialCharacterCount(draft.text) > limit
      ? t("The draft exceeds the current character limit. Edit the text.")
      : generating
        ? t("AI is preparing the draft.")
        : draft.reviewReason
          ? draft.reviewReason
          : contact?.optedOut
            ? t("This contact does not want to be contacted.")
            : thread?.replyAllowed === false
              ? t("The platform does not allow replies to this conversation.")
              : thread?.replyUntil && thread.replyUntil <= Date.now()
                ? t("The reply window for this conversation has expired.")
                : snapshot && (!snapshot.hostOnline || snapshot.stopped || !snapshot.sendingEnabled)
                  ? t("Sending is off. Use the sending controls in the Automations section.")
                  : snapshot && (!account?.connected || account.paused)
                    ? t("The account is not connected or is paused. Check the Accounts section.")
                    : "";
  return (
    <article className="social-preview">
      <div className="social-record-heading">
        <strong>
          {draft.kind === "message"
            ? t("Message draft")
            : draft.kind === "comment"
              ? t("Comment draft")
              : t("Reply draft")}
        </strong>
        <StatusBadge
          status={job?.status ?? (generating ? "running" : draft.reviewReason ? "review" : "draft")}
          label={
            job
              ? statuses[job.status]
              : generating
                ? t("Preparing")
                : draft.reviewReason
                  ? t("Needs review")
                  : t("Draft ready")
          }
        />
      </div>
      <p className="social-muted">
        {account?.name ?? draft.accountId} · {contact?.name ?? t("Contact in the conversation")}
        {` · ${time(draft.createdAt)}`}
      </p>
      {draft.generation ? (
        <p className="social-muted">
          {t("Agent: {p0} · {p1} · {p2}", {
            p0: HARNESS_TITLE[draft.generation.agent.provider],
            p1: draft.generation.agent.model || t("default model"),
            p2: {
              queued: t("Waiting to generate"),
              running: t("Generating"),
              completed: t("Generated"),
              review: t("Review required"),
            }[draft.generation.status],
          })}
        </p>
      ) : null}
      {draft.media?.length ? (
        <p role="status">
          {t("Attachments: {p0}", {
            p0: draft.media.some((item) => item.kind === "video")
              ? t("1 video")
              : t("{p0} images", { p0: draft.media.length }),
          })}
        </p>
      ) : null}
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (mediaBusy) return;
            void (async () => {
              if (
                await run(async () => {
                  const { effective } = await client.request<{ effective: SocialPolicy }>(
                    "policy.get",
                    { accountId: draft.accountId },
                  );
                  const latestLimit = socialLimit(
                    effective,
                    draft.kind === "message" || thread?.kind === "message" ? "message" : "comment",
                  );
                  if (latestLimit !== undefined && socialCharacterCount(text) > latestLimit)
                    throw new Error(
                      t("The text exceeds the {p0} character limit.", { p0: latestLimit }),
                    );
                  return client.request("drafts.update", {
                    id: draft.id,
                    text,
                    factIds,
                    ...(account?.platform === "x" ? { media } : {}),
                  });
                }, t("Draft updated. The new content must be approved again before sending."))
              )
                setEditing(false);
            })();
          }}
        >
          <TextareaField
            label={t("Draft text")}
            required
            rows={4}
            value={text}
            disabled={!!account && !editPolicy}
            onChange={(event) => setText(event.target.value)}
          />
          <details className="social-settings">
            <summary>{t("Information sources (optional)")}</summary>
            {facts.map((fact) => (
              <label className="social-inline-check" key={fact.id}>
                <Checkbox
                  checked={factIds.includes(fact.id)}
                  onChange={(event) =>
                    setFactIds((current) =>
                      event.target.checked
                        ? [...current, fact.id]
                        : current.filter((id) => id !== fact.id),
                    )
                  }
                />
                {fact.topic}
              </label>
            ))}
            {missingFacts.length ? (
              <p role="status">
                {t(
                  "Some source facts for this draft were deleted. Choose a current fact or remove the deleted links.",
                )}
              </p>
            ) : null}
            {factIds.length ? (
              <Button variant="secondary" type="button" onClick={() => setFactIds([])}>
                {t("Remove fact links")}
              </Button>
            ) : (
              <p className="social-muted">
                {t("This draft is not linked to a specific source fact.")}
              </p>
            )}
          </details>
          {account && !editPolicy ? (
            <Notice kind={policyError ? "error" : "loading"}>
              {policyError || t("Loading account limits…")}
              {policyError ? (
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => setPolicyAttempt((attempt) => attempt + 1)}
                >
                  {t("Retry")}
                </Button>
              ) : null}
            </Notice>
          ) : null}
          <p className="social-muted" role="status">
            {t("{p0} characters", { p0: `${count}${limit ? ` / ${limit}` : ""}` })}
          </p>
          {limit && count > limit ? (
            <Alert tone="danger">
              {t("You are over the character limit by {p0} characters.", { p0: count - limit })}
            </Alert>
          ) : null}
          {account?.platform === "x" &&
          !(
            account.connection === "browser" &&
            (draft.kind === "message" || thread?.kind === "message")
          ) ? (
            <XMediaFields
              value={media}
              client={client}
              onChange={setMedia}
              onBusyChange={setMediaBusy}
              message={draft.kind === "message" || thread?.kind === "message"}
            />
          ) : null}
          <div className="social-actions">
            <Button
              type="submit"
              variant="primary"

              disabled={
                mediaBusy ||
                !text.trim() ||
                (!!limit && count > limit) ||
                !!missingFacts.length ||
                (!!account && !editPolicy)
              }
            >
              {t("Save changes")}
            </Button>
            <Button variant="secondary" type="button" onClick={() => setEditing(false)}>
              {t("Cancel editing")}
            </Button>
          </div>
        </form>
      ) : (
        <p className="social-message">{draft.text || t("Preparing draft…")}</p>
      )}
      {disabledReason && !job ? (
        <Notice kind={draft.reviewReason || contact?.optedOut ? "warning" : "info"}>
          {disabledReason}
        </Notice>
      ) : null}
      {job?.error ? (
        <Notice
          kind={job.status === "review" ? "warning" : job.status === "failed" ? "error" : "info"}
        >
          {job.error}
        </Notice>
      ) : null}
      {job?.url ? (
        <a href={job.url} target="_blank" rel="noreferrer">
          {t("View on platform")}
        </a>
      ) : null}
      {!editing ? (
        <div className="social-approval">
          <p className="social-muted">
            {t("Approving sends from {p0} to {p1} · {p2} characters", {
              p0: account?.name ?? draft.accountId,
              p1: contact?.name ?? t("Contact in the conversation"),
              p2: `${socialCharacterCount(draft.text)}${limit ? ` / ${limit}` : ""}`,
            })}
          </p>
          <div className="social-actions">
            <Button
              type="button"
              variant="secondary"
              disabled={!!job || draft.generation?.status === "running"}
              onClick={() => {
                setText(draft.text);
                setFactIds(draft.factIds);
                setMedia(draft.media ?? []);
                setEditing(true);
              }}
            >
              {t("Edit")}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={!!disabledReason || !draft.text.trim()}
              onClick={() =>
                void run(async () => {
                  const reviewedDraft = structuredClone(draft);
                  const { effective } = await client.request<{ effective: SocialPolicy }>(
                    "policy.get",
                    { accountId: draft.accountId },
                  );
                  const latestLimit = socialLimit(
                    effective,
                    draft.kind === "message" || thread?.kind === "message" ? "message" : "comment",
                  );
                  if (latestLimit !== undefined && socialCharacterCount(draft.text) > latestLimit)
                    throw new Error(
                      t("The text exceeds the {p0} character limit. Edit the draft.", {
                        p0: latestLimit,
                      }),
                    );
                  await client.request("drafts.approve", {
                    id: reviewedDraft.id,
                    reviewedDraft,
                  } satisfies SocialDraftApprovalInput);
                  await client.request(
                    `${draft.kind === "reply" ? "replies" : draft.kind === "message" ? "messages" : "comments"}.send`,
                    { id: draft.id },
                  );
                }, t("Draft approved and added to the send queue."))
              }
            >
              {t("Approve and add to send queue")}
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
