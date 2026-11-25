import { redactDiagnosticText } from "@bycoda/account-contracts";
import { useRef, useState, type SetStateAction } from "react";
import { getLocale, t } from "../../../../shared/i18n";
import { wallClockNow } from "../../../../shared/lib/time/wallClock";
import { Button } from "../../../../shared/ui/Button";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { Sheet } from "../../../../shared/ui/Sheet";
import { useSocialPending } from "../../hooks/useSocialPending";
import type { SocialClient } from "../../model/socialClient";
import type { SocialAccount, SocialSnapshot } from "../../model/social";
import type { SocialMediaEditor } from "../../model/socialMediaEditor";
import { DisabledReason, gateProps } from "../common/DisabledReason";
import { capabilityReasonText } from "../common/capabilityText";
import type { SocialScreenProps, SocialShellState } from "../shell/screens";
import { ContentEditorFields } from "./ContentEditorFields";
import { EditorAdvanced } from "./EditorAdvanced";
import { PlatformPreviews } from "./PlatformPreviews";
import { mediaOf, scheduledMs, draftName, withUtm, type ContentDraft } from "./contentDraft";
import {
  accountLabel,
  buildDraftVariants,
  buildVariants,
  draftProblems,
  hasPostContent,
  publishLabel,
  isScheduledDraft,
  selectedAccounts,
} from "./contentRules";
import {
  publishCampaign,
  saveCampaign,
  saveRepeatProgram,
  type PreviewTarget,
} from "./contentPublish";
import { draftGate, publishGate } from "./contentGate";
import { useTikTokCreators } from "./useTikTokCreators";
import { presentRemoteError } from "../../../connections/public/remoteFailure";

/** What happened to the draft; the screen closes the editor and clears the draft for each. */
export type EditorOutcome = "published" | "scheduled" | "draft" | "program";

export type ContentEditorProps = {
  client: SocialClient;
  editor: SocialMediaEditor;
  snapshot?: SocialSnapshot;
  projectId?: string;
  shell: SocialShellState;
  draft: ContentDraft;
  onDraft: (next: SetStateAction<ContentDraft>) => void;
  /** Why this post cannot be changed (for example it is already scheduled). */
  locked?: string;
  /** Retained operation state when this project's editor was temporarily unmounted. */
  operationPending?: boolean;
  mediaPending?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onMediaBusyChange?: (busy: boolean) => void;
  /** Surfaces a failure on the screen when this editor was unmounted mid-operation (project switch). */
  operationError?: EditorFailure[];
  onOperationError?: (failure: EditorFailure[] | undefined) => void;
  /** The Host now holds this post under this identity; the screen keeps it on the draft. */
  onSaved: (identity: { campaignId: string; revision: number }) => void;
  onDone: (outcome: EditorOutcome) => void;
  onClose: () => void;
  onNavigate: SocialScreenProps["onNavigate"];
};

export type EditorFailure = { title: string; details?: string };

function describeBlocked(target: PreviewTarget, accounts: SocialAccount[]): EditorFailure {
  const account = accounts.find((item) => item.id === target.accountId);
  const name = account ? accountLabel(account) : target.accountId;
  const reason = target.contentError
    ? t("The post could not be published.")
    : target.capability
      ? capabilityReasonText(target.capability)
      : t("Not available yet");
  return {
    title: `${name}: ${reason}`,
    details: target.contentError ? redactDiagnosticText(target.contentError) : undefined,
  };
}

/** The post editor: fields, previews and one publish action. Saving runs the Host's exact-revision flow. */
export function ContentEditor(props: ContentEditorProps) {
  const {
    client,
    editor,
    snapshot,
    projectId,
    shell,
    draft,
    onDraft,
    locked,
    onSaved,
    onDone,
    onClose,
    onNavigate,
    operationPending,
    mediaPending,
    onBusyChange,
    onMediaBusyChange,
    operationError,
    onOperationError,
  } = props;
  const pending = useSocialPending();
  const submitting = useRef(false);
  const uploading = useRef(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [localError, setLocalError] = useState<EditorFailure[]>();
  const setFailure = onOperationError ?? setLocalError;
  const failures = onOperationError ? operationError : localError;
  const fail = (title: string, cause: unknown) =>
    setFailure([
      {
        title,
        details:
          cause instanceof Error
            ? redactDiagnosticText(presentRemoteError(cause, { explicit: true }))
            : undefined,
      },
    ]);
  const accounts = snapshot?.accounts ?? [];
  const selected = selectedAccounts(draft, accounts);
  const creators = useTikTokCreators(client, selected, !locked);
  const now = wallClockNow();
  const problems = draftProblems({
    draft,
    projectId,
    accounts,
    snapshot,
    creator: creators,
    now,
  });
  const submissionBusy =
    !!operationPending ||
    pending.is("content.publish") ||
    pending.is("content.draft") ||
    pending.is("content.ai");
  const busy = submissionBusy || mediaBusy || !!mediaPending;
  const mediaBusyChanged = (value: boolean) => {
    uploading.current = value;
    setMediaBusy(value);
    onMediaBusyChange?.(value);
  };
  const changeDraft = (next: SetStateAction<ContentDraft>) => {
    if (!submitting.current && !locked && !submissionBusy) onDraft(next);
  };
  const common = {
    snapshot,
    projectId,
    shell,
    locked,
    busy,
    busyReason:
      mediaBusy || mediaPending
        ? t("Uploading…")
        : pending.is("content.draft")
          ? t("Saving…")
          : undefined,
  };
  const publish = publishGate({ ...common, problems, prepareOnly: draft.repeat.enabled });
  const variantInput = {
    draft,
    projectId: projectId!,
    accounts,
    snapshot,
    creator: creators,
    now,
  };
  const save = draftGate({
    ...common,
    hasAccounts: draft.accountIds.length > 0,
    hasMissingAccounts: selected.length !== draft.accountIds.length,
    hasContent:
      hasPostContent(draft, selected) ||
      (!!draft.saved &&
        buildDraftVariants(variantInput).some(
          (variant) =>
            variant.text.trim() ||
            variant.media.length ||
            variant.linkedinFormat ||
            variant.reddit?.title?.trim(),
        )),
  });
  const campaignInput = (saveAsDraft = false) => ({
    campaignId: draft.campaignId,
    revision: draft.revision,
    name: draftName(draft),
    projectIds: [projectId!],
    variants: buildDraftVariants({ ...variantInput, now: wallClockNow() }, saveAsDraft),
  });

  const saveDraft = () => {
    if (
      draft.repeat.enabled ||
      save.disabled ||
      submitting.current ||
      uploading.current ||
      mediaPending ||
      operationPending
    )
      return;
    void pending
      .run("content.draft", async () => {
        submitting.current = true;
        onBusyChange?.(true);
        setFailure(undefined);
        try {
          await saveCampaign(client, campaignInput(true));
          onDone("draft");
        } catch (caught) {
          fail(t("The post could not be saved."), caught);
        } finally {
          submitting.current = false;
          onBusyChange?.(false);
        }
      })
      .catch((cause: unknown) => fail(t("The post could not be saved."), cause));
  };

  const publishNow = () => {
    if (
      publish.disabled ||
      submitting.current ||
      uploading.current ||
      mediaPending ||
      operationPending
    )
      return;
    void pending
      .run("content.publish", async () => {
        submitting.current = true;
        onBusyChange?.(true);
        setFailure(undefined);
        try {
          if (draft.repeat.enabled) {
            await saveRepeatProgram(client, {
              projectId: projectId!,
              name: draftName(draft),
              text: draft.text.trim(),
              link: withUtm(draft.link, draft.utm) || undefined,
              accountIds: draft.accountIds,
              factIds: draft.factIds,
              media: mediaOf(draft.media),
              repeat: draft.repeat,
              startsAt: scheduledMs(draft) ?? now,
              language: getLocale(),
              youtube: buildVariants(variantInput).find((variant) => variant.youtube)?.youtube,
            });
            onDone("program");
            return;
          }
          const result = await publishCampaign(client, campaignInput(), (campaign) =>
            onSaved({ campaignId: campaign.id, revision: campaign.revision }),
          );
          if (result.blocked.length) {
            setFailure(result.blocked.map((target) => describeBlocked(target, accounts)));
            return;
          }
          onDone(isScheduledDraft(draft) ? "scheduled" : "published");
        } catch (caught) {
          fail(
            draft.repeat.enabled
              ? t("Could not save the program.")
              : t("The post could not be published."),
            caught,
          );
        } finally {
          submitting.current = false;
          onBusyChange?.(false);
        }
      })
      .catch((cause: unknown) => fail(t("The post could not be published."), cause));
  };

  const footer = (
    <div className="content-footer">
      {publish.fix === "accounts" ? (
        <Button variant="link" onClick={() => onNavigate("accounts")}>
          {t("Open Accounts & Settings")}
        </Button>
      ) : null}
      {!draft.repeat.enabled ? (
        <DisabledReason
          variant="secondary"
          loading={pending.is("content.draft")}
          onClick={saveDraft}
          {...gateProps(save)}
        >
          {t("Save draft")}
        </DisabledReason>
      ) : null}
      <DisabledReason
        variant="primary"
        loading={pending.is("content.publish")}
        onClick={publishNow}
        {...gateProps(publish)}
      >
        {draft.repeat.enabled ? t("Save as paused program") : publishLabel(draft)}
      </DisabledReason>
    </div>
  );

  return (
    <Sheet
      title={draft.campaignId ? t("Edit post") : t("New post")}
      onClose={() => {
        if (!submitting.current && !uploading.current && !busy) onClose();
      }}
      footer={footer}
    >
      <div className="content-editor-body">
        {locked ? <InlineMessage tone="info">{locked}</InlineMessage> : null}
        {/* One notice slot: a failure, or the accounts the post could not go to. */}
        {failures?.map(({ title, details }, index) => (
          <InlineError key={index} details={details}>
            {title}
          </InlineError>
        ))}
        <ContentEditorFields
          client={client}
          editor={editor}
          snapshot={snapshot}
          projectId={projectId}
          draft={draft}
          onDraft={changeDraft}
          locked={
            locked ?? (submissionBusy ? t("Wait for the current action to finish.") : undefined)
          }
          onMediaBusyChange={mediaBusyChanged}
          aiStopped={shell.aiStopped}
          creators={creators}
          onNavigate={onNavigate}
        />
        <PlatformPreviews
          accounts={selected}
          draft={draft}
          policies={snapshot?.policies}
          problems={problems}
        />
        <EditorAdvanced
          draft={draft}
          onDraft={changeDraft}
          snapshot={snapshot}
          projectId={projectId}
          disabled={!!locked || busy}
        />
      </div>
    </Sheet>
  );
}
