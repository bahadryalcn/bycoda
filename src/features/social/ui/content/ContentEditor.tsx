import { InlineError } from "../../../../shared/ui/InlineError";
import { useRef, useState, type SetStateAction } from "react";
import { getLocale, t } from "../../../../shared/i18n";
import { wallClockNow } from "../../../../shared/lib/time/wallClock";
import { Button } from "../../../../shared/ui/Button";
import { InlineMessage } from "../../../../shared/ui/InlineError";
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
  buildVariants,
  draftProblems,
  publishLabel,
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
  onOperationError?: (message: string) => void;
  /** The Host now holds this post under this identity; the screen keeps it on the draft. */
  onSaved: (identity: { campaignId: string; revision: number }) => void;
  onDone: (outcome: EditorOutcome) => void;
  onClose: () => void;
  onNavigate: SocialScreenProps["onNavigate"];
};

function describeBlocked(target: PreviewTarget, accounts: SocialAccount[]): string {
  const account = accounts.find((item) => item.id === target.accountId);
  const name = account ? accountLabel(account) : target.accountId;
  const reason =
    target.contentError ??
    (target.capability ? capabilityReasonText(target.capability) : t("Not available yet"));
  return `${name}: ${reason}`;
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
    onOperationError,
  } = props;
  const pending = useSocialPending();
  const submitting = useRef(false);
  const uploading = useRef(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [blocked, setBlocked] = useState<string[]>([]);
  const accounts = snapshot?.accounts ?? [];
  const selected = selectedAccounts(draft, accounts);
  const creators = useTikTokCreators(client, selected, !locked);
  const now = wallClockNow();
  const problems = draftProblems({ draft, projectId, accounts, snapshot, creator: creators, now });
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
  const publish = publishGate({ ...common, problems });
  const save = draftGate({
    ...common,
    hasAccounts: draft.accountIds.length > 0,
    hasContent: draft.text.trim() !== "" || draft.media.length > 0,
  });
  const variantsNow = () =>
    buildVariants({
      draft,
      projectId: projectId!,
      accounts,
      snapshot,
      creator: creators,
      now: Date.now(),
    });
  const campaignInput = () => ({
    campaignId: draft.campaignId,
    revision: draft.revision,
    name: draftName(draft),
    projectIds: [projectId!],
    variants: variantsNow(),
  });

  const saveDraft = () => {
    if (uploading.current || mediaPending || operationPending) return;
    void pending
      .run("content.draft", async () => {
        submitting.current = true;
        onBusyChange?.(true);
        setError(undefined);
        setBlocked([]);
        try {
          await saveCampaign(client, campaignInput());
          onDone("draft");
        } catch (caught) {
          const message =
            caught instanceof Error ? caught.message : t("The post could not be saved.");
          setError(message);
          onOperationError?.(message);
        } finally {
          submitting.current = false;
          onBusyChange?.(false);
        }
      })
      .catch(() => setError(t("The post could not be saved.")));
  };

  const publishNow = () => {
    if (uploading.current || mediaPending || operationPending) return;
    void pending
      .run("content.publish", async () => {
        submitting.current = true;
        onBusyChange?.(true);
        setError(undefined);
        setBlocked([]);
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
            });
            onDone("program");
            return;
          }
          const result = await publishCampaign(client, campaignInput(), (campaign) =>
            onSaved({ campaignId: campaign.id, revision: campaign.revision }),
          );
          if (result.blocked.length) {
            const reasons = result.blocked.map((target) => describeBlocked(target, accounts));
            setBlocked(reasons);
            onOperationError?.(reasons.join("\n"));
            return;
          }
          onDone(draft.when === "now" ? "published" : "scheduled");
        } catch (caught) {
          const message =
            caught instanceof Error ? caught.message : t("The post could not be published.");
          setError(message);
          onOperationError?.(message);
        } finally {
          submitting.current = false;
          onBusyChange?.(false);
        }
      })
      .catch(() => setError(t("The post could not be published.")));
  };

  const footer = (
    <div className="content-footer">
      {publish.fix === "accounts" ? (
        <Button variant="link" onClick={() => onNavigate("accounts")}>
          {t("Open Accounts & Settings")}
        </Button>
      ) : null}
      <DisabledReason
        variant="secondary"
        loading={pending.is("content.draft")}
        onClick={saveDraft}
        {...gateProps(save)}
      >
        {t("Save draft")}
      </DisabledReason>
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
      {locked ? <InlineMessage tone="info">{locked}</InlineMessage> : null}
      {error ? <InlineError>{error}</InlineError> : null}
      {blocked.length ? (
        <InlineError>
          <ul className="content-blocked">
            {blocked.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </InlineError>
      ) : null}
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
    </Sheet>
  );
}
