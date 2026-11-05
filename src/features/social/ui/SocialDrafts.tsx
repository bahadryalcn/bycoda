import { useSocialPending } from "./useSocialPending";
import { useContext as useSocialContext } from "react";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { Alert } from "../../../shared/ui/Alert";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Button } from "../../../shared/ui/Button";
import { ContinuousList } from "../../../shared/ui/ContinuousList";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { useEffect, useState } from "react";
import { XMediaFields } from "./XMediaFields";
import { SocialUploadImagePreview } from "./SocialUploadImagePreview";
import { socialRows } from "../model/socialWorkspace";
import { socialQueryScope } from "../model/socialQuery";
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

/** Longest delay setTimeout honors; a later deadline is not armed (it would fire at once). */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

export function DraftList({
  drafts,
  client,
  run,
  snapshot,
  recipientInParent = false,
  scopeKey = "collection",
}: {
  drafts: SocialDraft[];
  client: SocialClient;
  run: Run;
  snapshot?: SocialSnapshot;
  recipientInParent?: boolean;
  scopeKey?: string;
}) {
  return (
    <ContinuousList
      items={drafts}
      itemKey={(draft) => draft.id}
      stateKey={`social-drafts:${socialQueryScope(client).join(":")}:${snapshot?.executorId ?? "unknown"}:${snapshot?.programProjectId ?? "all"}:${scopeKey}:${recipientInParent ? "parent" : "detail"}`}
      estimateSize={176}
      renderItem={(draft) => (
        <Draft
          key={draft.id}
          draft={draft}
          client={client}
          run={run}
          snapshot={snapshot}
          recipientInParent={recipientInParent}
        />
      )}
    />
  );
}

function Draft({
  draft,
  client,
  run,
  snapshot,
  recipientInParent,
}: {
  draft: SocialDraft;
  client: SocialClient;
  run: Run;
  snapshot?: SocialSnapshot;
  recipientInParent: boolean;
}) {
  const pendingUi = useSocialPending();
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const editorStateKey = `social-draft-editor:${socialQueryScope(client).join(":")}:${snapshot?.executorId ?? "unknown"}:${snapshot?.programProjectId ?? "all"}:${draft.id}`;
  const [editing, setEditing] = useRetainedState(`${editorStateKey}:editing`, false);
  const [text, setText] = useRetainedState(`${editorStateKey}:text`, draft.text);
  const [factIds, setFactIds] = useRetainedState(`${editorStateKey}:facts`, draft.factIds);
  const [media, setMedia] = useRetainedState(`${editorStateKey}:media`, draft.media ?? []);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [editPolicy, setEditPolicy] = useState<SocialPolicy>();
  const [policyError, setPolicyError] = useState("");
  const [policyAttempt, setPolicyAttempt] = useState(0);
  const facts =
    snapshot?.profiles.find((profile) => profile.projectId === draft.projectId)?.facts ?? [];
  const missingFacts = snapshot
    ? factIds.filter((id) => !facts.some((fact) => fact.id === id))
    : [];
  const account = snapshot?.accounts.find((item) => item.id === draft.accountId);
  // Opening the editor (or changing account, client or retrying) starts a fresh limits read.
  const policyKey = [editing, account?.id, client, policyAttempt] as const;
  const [seenPolicyKey, setSeenPolicyKey] = useState(policyKey);
  if (policyKey.some((value, index) => !Object.is(value, seenPolicyKey[index]))) {
    setSeenPolicyKey(policyKey);
    if (editing && account) {
      setEditPolicy(undefined);
      setPolicyError("");
    }
  }
  useEffect(() => {
    if (!editing || !account) return;
    let cancelled = false;
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
  // The reply window closes on its own: a timer at the deadline refreshes the clock used for the check.
  const replyUntil = account?.connection !== "browser" ? thread?.replyUntil : undefined;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!replyUntil) return;
    const delay = Math.max(0, replyUntil - Date.now());
    if (delay > MAX_TIMER_DELAY_MS) return;
    const timer = setTimeout(() => setNow(Math.max(Date.now(), replyUntil)), delay);
    return () => clearTimeout(timer);
  }, [replyUntil]);
  const replyWindowExpired = !!replyUntil && replyUntil <= now;
  const messageDraft = draft.kind === "message" || thread?.kind === "message";
  const messagingMedia =
    !!account &&
    account.connected &&
    ["whatsapp", "telegram"].includes(account.platform) &&
    messageDraft &&
    snapshot?.capabilities[account.id]?.some(
      (item) => item.operation === "media" && item.status === "available",
    ) &&
    snapshot.capabilities[account.id]?.some(
      (item) =>
        ["message.reply", "message.start"].includes(item.operation) && item.status === "available",
    );
  const canEditMedia =
    !!account &&
    ((account.platform === "x" && !(account.connection === "browser" && messageDraft)) ||
      messagingMedia);
  const job =
    snapshot &&
    socialRows(snapshot.jobs, snapshot.related?.jobs).find(
      (item) => item.draftId === draft.id && item.status !== "cancelled",
    );
  const generating =
    draft.generation?.status === "running" || draft.generation?.status === "queued";
  const policyLimit = account
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
  const apiMessagingMedia = messagingMedia && account?.connection !== "browser";
  const attachmentOnly = apiMessagingMedia && media.length > 0;
  const limit = attachmentOnly ? Math.min(policyLimit ?? 1024, 1024) : policyLimit;
  const count = attachmentOnly ? text.length : socialCharacterCount(text);
  const disabledReason = job
    ? t("Send status: {p0}.", { p0: statuses[job.status] })
    : limit &&
        (apiMessagingMedia && draft.media?.length
          ? draft.text.length
          : socialCharacterCount(draft.text)) > limit
      ? t("The draft exceeds the current character limit. Edit the text.")
      : generating
        ? t("AI is preparing the draft.")
        : draft.reviewReason
          ? draft.reviewReason
          : contact?.optedOut
            ? t("This contact does not want to be contacted.")
            : thread?.replyAllowed === false
              ? t("The platform does not allow replies to this conversation.")
              : replyWindowExpired
                ? t("The reply window for this conversation has expired.")
                : snapshot && (!snapshot.hostOnline || snapshot.stopped || !snapshot.sendingEnabled)
                  ? t("Sending is off. Use the sending controls in the Automations section.")
                  : snapshot && (!account?.connected || account.paused)
                    ? t("The account is not connected or is paused. Check the Accounts section.")
                    : "";
  return (
    <article className="social-preview">
      <div className="social-record-heading">
        {!recipientInParent ? (
          <strong className="min-w-0 break-words text-ui-secondary font-medium">
            {contact?.name || t("Contact in the conversation")}
          </strong>
        ) : null}
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
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ui-caption text-(--ui-text-secondary)">
        <span>{account?.name ?? draft.accountId}</span>
        <span>
          {draft.kind === "message"
            ? t("Message draft")
            : draft.kind === "comment"
              ? t("Comment draft")
              : t("Reply draft")}
        </span>{" "}
        <span>
          {t("Created")}: {time(draft.createdAt)}
        </span>
      </div>

      {(editing ? media : draft.media)?.length ? (
        <details onToggle={(event) => setShowAttachments(event.currentTarget.open)}>
          <summary>
            {t("Attachments: {p0}", {
              p0: (editing ? media : draft.media!).some((item) => item.kind === "video")
                ? t("1 video")
                : t("{p0} images", { p0: (editing ? media : draft.media!).length }),
            })}
          </summary>
          {showAttachments
            ? (editing ? media : (draft.media ?? [])).map((item, index) =>
                item.kind === "image" && item.uploadId ? (
                  <SocialUploadImagePreview
                    key={`${item.uploadId}:${index}`}
                    client={client}
                    uploadId={item.uploadId}
                    alt={item.alt}
                  />
                ) : null,
              )
            : null}
        </details>
      ) : null}
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (mediaBusy) return;
            void (async () => {
              if (
                await pendingUi.run("draft.save-changes", () =>
                  run(async () => {
                    const { effective } = await client.request<{ effective: SocialPolicy }>(
                      "policy.get",
                      { accountId: draft.accountId },
                    );
                    const latestLimit = socialLimit(
                      effective,
                      draft.kind === "message" || thread?.kind === "message"
                        ? "message"
                        : "comment",
                    );
                    if (latestLimit !== undefined && socialCharacterCount(text) > latestLimit)
                      throw new Error(
                        t("The text exceeds the {p0} character limit.", { p0: latestLimit }),
                      );
                    return client.request("drafts.update", {
                      id: draft.id,
                      text,
                      factIds,
                      ...(canEditMedia ? { media } : {}),
                    });
                  }, t("Draft updated. The new content must be approved again before sending.")),
                )
              )
                setEditing(false);
            })();
          }}
        >
          <TextareaField
            label={t("Draft text")}
            required={!attachmentOnly}
            rows={4}
            value={text}
            disabled={socialLocked || (!!account && !editPolicy)}
            onChange={(event) => setText(event.target.value)}
          />
          <details className="social-settings">
            <summary>{t("Information sources (optional)")}</summary>
            {facts.map((fact) => (
              <label className="social-inline-check" key={fact.id}>
                <Checkbox
                  disabled={socialLocked}
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
              <Button
                disabled={socialLocked}
                variant="secondary"
                type="button"
                onClick={() => setFactIds([])}
              >
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
                  disabled={socialLocked}
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
          {canEditMedia ? (
            <XMediaFields
              value={media}
              client={client}
              onChange={setMedia}
              onBusyChange={setMediaBusy}
              message={messageDraft}
              label={
                account?.platform === "x"
                  ? undefined
                  : t("{p0} attachments", {
                      p0: account!.platform === "whatsapp" ? "WhatsApp" : "Telegram",
                    })
              }
              help={
                account?.platform === "x"
                  ? undefined
                  : account?.connection !== "browser"
                    ? t(
                        "One PNG/JPEG up to 5 MiB or MP4 up to {p0} MiB. Captions fit 1024 UTF-16 characters.",
                        { p0: account?.platform === "whatsapp" ? 16 : 50 },
                      )
                    : t("Files are uploaded to the selected host and attached through the browser.")
              }
              maxVideoMiB={apiMessagingMedia ? (account?.platform === "whatsapp" ? 16 : 50) : 64}
              maxCount={account?.platform === "x" ? undefined : 1}
              allowAltText={account?.platform === "x"}
            />
          ) : null}
          <div className="social-actions">
            <Button
              loading={pendingUi.is("draft.save-changes")}
              type="submit"
              variant="primary"

              disabled={
                socialLocked ||
                mediaBusy ||
                (!text.trim() && !attachmentOnly) ||
                (!!limit && count > limit) ||
                !!missingFacts.length ||
                (!!account && !editPolicy)
              }
            >
              {t("Save changes")}
            </Button>
            <Button
              disabled={socialLocked}
              variant="secondary"
              type="button"
              onClick={() => setEditing(false)}
            >
              {t("Cancel editing")}
            </Button>
          </div>
        </form>
      ) : draft.text || !draft.media?.length ? (
        <p className="social-message">{draft.text || t("Preparing draft…")}</p>
      ) : null}
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
      {draft.generation ? (
        <details className="text-ui-caption text-(--ui-text-secondary)">
          <summary>{t("Generation details")}</summary>
          <p>
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
        </details>
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
              disabled={socialLocked || !!job || draft.generation?.status === "running"}
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
              loading={pendingUi.is("draft.approve")}
              type="button"
              variant="primary"
              disabled={
                socialLocked ||
                !!disabledReason ||
                (!draft.text.trim() && !(apiMessagingMedia && draft.media?.length))
              }
              onClick={() =>
                void pendingUi.run("draft.approve", () =>
                  run(async () => {
                    const reviewedDraft = structuredClone(draft);
                    const { effective } = await client.request<{ effective: SocialPolicy }>(
                      "policy.get",
                      { accountId: draft.accountId },
                    );
                    const latestLimit = socialLimit(
                      effective,
                      draft.kind === "message" || thread?.kind === "message"
                        ? "message"
                        : "comment",
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
                  }, t("Draft approved and added to the send queue.")),
                )
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
