import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { Divider } from "../../../../../shared/ui/Divider";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { SectionLabel } from "../../../../../shared/ui/SectionLabel";
import { SegmentedControl } from "../../../../../shared/ui/SegmentedControl";
import { Select } from "../../../../../shared/ui/Select";
import { SubTabs } from "../../../../../shared/ui/SubTabs";
import { Text } from "../../../../../shared/ui/Text";
import type { Capability, SocialAccount } from "../../../model/social";
import type { SocialClient } from "../../../model/socialClient";
import { socialQueryScope } from "../../../model/socialQuery";
import type { YouTubeOperation } from "../../../model/youtubeManagement";
import { capabilityReasonText } from "../../common/capabilityText";
import { useAccountWrite } from "../useAccountWrite";
import { YouTubeBrowse } from "./YouTubeBrowse";
import { YouTubeFields } from "./YouTubeFields";
import { withDefaults, youtubePayload } from "./YouTubeFormFields";
import { asYoutubeRecord, YouTubeFacts, YouTubeResult } from "./YouTubeResult";
import {
  isBrowseForm,
  youtubeIdKeys,
  youtubeSections,
  youtubeViewForms,
  youtubeViews,
  type YouTubeDraft,
  type YouTubeSection,
  type YouTubeView,
} from "./youtubeForms";
import { youtubeChanged, youtubePick, youtubePrefill } from "./youtubeItems";
import { YouTubeScopeHandoff, youtubeScopeOperation } from "./YouTubeScopeHandoff";
import "./youtube.css";

function browseTitle(action: string) {
  switch (action) {
    case "youtube.quota.status":
      return t("Quota usage");
    case "youtube.monetization.status":
      return t("Monetization");
    case "youtube.operations.list":
      return t("Waiting for review");
    default:
      return "";
  }
}

function emptyText(action: string) {
  switch (action) {
    case "youtube.videos.list":
      return t("No videos found.");
    case "youtube.playlists.list":
      return t("No playlists found.");
    case "youtube.comments.list":
      return t("No comments to show.");
    case "youtube.subscriptions.list":
      return t("No subscriptions to show.");
    case "youtube.broadcasts.list":
      return t("No broadcasts found.");
    case "youtube.liveChat.list":
      return t("No chat messages yet.");
    case "youtube.superChats.list":
      return t("No Super Chats yet.");
    case "youtube.community.list":
      return t("No Community posts found.");
    case "youtube.operations.list":
      return t("Nothing is waiting for review.");
    default:
      return t("No results");
  }
}

export function YouTubeManage({
  client,
  account,
  capabilities,
  disabled,
  initialSection = "channel",
}: {
  client: SocialClient;
  account: SocialAccount;
  capabilities: Capability[];
  disabled: boolean;
  initialSection?: YouTubeSection;
}) {
  const browser = account.connection === "browser";
  const [section, setSection] = useState(initialSection);
  const [views, setViews] = useState<Partial<Record<YouTubeSection, YouTubeView>>>({});
  const [operation, setOperation] = useState("");
  const [drafts, setDrafts] = useState<Partial<Record<YouTubeSection, YouTubeDraft>>>({});
  const [selection, setSelection] = useState<{
    section: YouTubeSection;
    id: string;
    title: string;
    keys: string[];
    baseline: Record<string, string>;
  }>();
  const [result, setResult] = useState<unknown>();
  const own = drafts[section] ?? {};
  const selected = selection?.section === section ? selection : undefined;
  const queryClient = useQueryClient();
  // Browser accounts read the channel only when the owner presses Load, so only API accounts prefill.
  const channelRead = useQuery({
    queryKey: [...socialQueryScope(client), "youtube", account.id, "prefill", "channel"],
    queryFn: () => client.request("youtube.channel.read", { accountId: account.id }),
    enabled: section === "channel" && !browser && !disabled && account.connected && !account.paused,
    staleTime: 15_000,
  });
  const channelBaseline = asYoutubeRecord(channelRead.data)
    ? youtubePrefill("youtube.channel.update", asYoutubeRecord(channelRead.data)!)
    : {};
  const baseline = section === "channel" ? channelBaseline : (selected?.baseline ?? {});
  // The edit form shows the current values; what the owner typed (the draft) wins over them.
  const draft: YouTubeDraft = { ...baseline, ...own };
  const mergeDraft = (values: YouTubeDraft) =>
    setDrafts((current) => ({
      ...current,
      [section]: { ...current[section], ...values },
    }));
  const setField = (key: string, value: string | File[]) => mergeDraft({ [key]: value });
  const { write, failureTitle, details, is, setError } = useAccountWrite(
    t("The YouTube operation failed."),
  );
  const confirmation = useConfirm();

  const sectionViews = youtubeViews(section, browser);
  const view =
    views[section] ?? sectionViews[0]?.value ?? (section === "videos" ? "videos" : undefined);
  const forms = youtubeViewForms(section, browser, view);
  const browseForm = forms.find(isBrowseForm);
  const taskForms = forms.filter((item) => !isBrowseForm(item));
  const form = taskForms.find((item) => item.action === operation) ?? taskForms[0];
  const busy = is("youtube");
  const blocked = disabled || (section !== "review" && (account.paused || !account.connected));
  const taskFields = form?.fields?.filter(
    (field) => !field.whenKind || field.whenKind === draft.kind,
  );
  const effective = form ? withDefaults(form, draft) : draft;
  const capability = capabilities.find((item) => item.operation === form?.capability);
  const unavailable = capability && capability.status !== "available";
  const incomplete = taskFields?.some(({ key, required }) => required && !effective[key]?.length);
  const needsTarget = taskFields?.some(
    ({ key, required }) => required && youtubeIdKeys.has(key) && !effective[key]?.length,
  );
  const actionLabel =
    form?.action === "youtube.community.publish" && draft.publishAt
      ? t("Schedule Community post")
      : (form?.label ?? "");
  const outgoing = form?.fieldsInPatch ? youtubeChanged(effective, baseline) : effective;
  const nothingToChange =
    form?.fieldsInPatch !== undefined &&
    !form.fieldsInPatch.some((key) => {
      const value = outgoing[key];
      return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== "";
    }) &&
    !form.fields?.some(({ key, emptyAllowed }) => emptyAllowed && outgoing[key] === "");
  const scopeOperation = section === "analytics" ? youtubeScopeOperation(result) : undefined;
  const reviewing = section === "review";

  const refreshLists = () =>
    queryClient
      .invalidateQueries({
        queryKey: [...socialQueryScope(client), "youtube", account.id],
      })
      .catch(() => undefined);
  const finish = (response: unknown, deletedVideoId?: unknown) => {
    if (response === undefined) return;
    if (typeof deletedVideoId === "string" && asYoutubeRecord(response)?.status === "done") {
      setSelection((current) =>
        current?.section === "videos" && current.id === deletedVideoId ? undefined : current,
      );
      setDrafts((current) => {
        if (current.videos?.videoId !== deletedVideoId) return current;
        const next = { ...current.videos };
        delete next.videoId;
        return { ...current, videos: next };
      });
    }
    setResult(response);
    refreshLists();
  };
  const handleError = (cause: unknown) =>
    setError(cause instanceof Error ? cause.message : t("The YouTube operation failed."));

  const run = async () => {
    if (!form) return;
    if (!form.write) {
      finish(
        await write(
          "youtube",
          async () =>
            await client.request(form.action, await youtubePayload(form, outgoing, account.id)),
        ),
      );
      return;
    }
    const details = await youtubePayload(form, outgoing, account.id);
    const isVideoDelete = form.action === "youtube.video.delete";
    const confirmationDetails =
      isVideoDelete && selected && selected.id === details.videoId
        ? { title: selected.title, ...details }
        : details;
    const confirmed = await confirmation.confirm({
      title: actionLabel,
      message: isVideoDelete ? (
        <>
          {account.name}
          <br />
          {t("This action cannot be undone.")}
        </>
      ) : (
        account.name
      ),
      danger: form.danger ?? false,
      confirmLabel: actionLabel,
      details: <YouTubeFacts data={confirmationDetails} />,
    });
    if (!confirmed) return;
    finish(
      await write(
        "youtube",
        async () =>
          await client.request(
            form.action,
            await youtubePayload(form, outgoing, account.id, client.upload),
          ),
      ),
      isVideoDelete ? details.videoId : undefined,
    );
  };

  const chooseTask = (value: string) => {
    setOperation(value);
    setResult(undefined);
    setError("");
  };
  const pick = (row: Record<string, unknown>) => {
    const target = youtubePick(section, view, own, row);
    if (!target) return;
    // A new row starts from its own current values, not from edits typed for the previous row.
    setDrafts((current) => {
      const next = { ...current[section], ...target.values };
      for (const key of Object.keys(target.baseline ?? {})) delete next[key];
      return { ...current, [section]: next };
    });
    setSelection({
      section,
      id: String(row.id),
      title: target.title,
      keys: Object.keys(target.values),
      baseline: target.baseline ?? {},
    });
    if (taskForms.some((item) => item.action === target.action)) chooseTask(target.action);
    else setResult(undefined);
  };
  const clearSelection = () => {
    if (!selected) return;
    setDrafts((current) => {
      const next = { ...current[section] };
      for (const key of [...selected.keys, ...Object.keys(selected.baseline)]) delete next[key];
      return { ...current, [section]: next };
    });
    setSelection(undefined);
  };
  const review = async (target: YouTubeOperation) => {
    const deletes = target.action.endsWith(".delete");
    if (
      !(await confirmation.confirm({
        title: t("Approve YouTube operation"),
        message: deletes ? (
          <>
            {account.name}
            <br />
            {t("This action cannot be undone.")}
          </>
        ) : (
          account.name
        ),
        danger: deletes,
        confirmLabel: t("Approve"),
        details: <YouTubeFacts data={{ action: target.action, ...target.input }} />,
      }))
    )
      return;
    finish(
      await write("youtube", () =>
        client.request("youtube.operation.approve", {
          accountId: account.id,
          id: target.id,
          confirm: true,
        }),
      ),
      target.action === "youtube.video.delete" ? target.input.videoId : undefined,
    );
  };
  const reconcile = async (target: YouTubeOperation, status: "done" | "rejected") => {
    const label = status === "done" ? t("Completed") : t("Failed");
    if (
      !(await confirmation.confirm({
        title: label,
        message: t("YouTube outcome is uncertain. Verify it on YouTube before trying again."),
        danger: false,
        confirmLabel: label,
        details: <YouTubeFacts data={{ action: target.action, ...target.input }} />,
      }))
    )
      return;
    finish(
      await write("youtube", () =>
        client.request("youtube.operation.reconcile", {
          accountId: account.id,
          id: target.id,
          status,
          confirm: true,
        }),
      ),
    );
  };

  const drilled = view === "playlists" && typeof draft.playlistId === "string" && draft.playlistId;
  const lead =
    sectionViews.length > 1 ? (
      <SegmentedControl
        label={t("YouTube management")}
        value={view ?? ""}
        options={sectionViews}
        onValueChange={(value) => {
          setViews((current) => ({
            ...current,
            [section]: value as YouTubeView,
          }));
          setOperation("");
          setResult(undefined);
          setError("");
        }}
      />
    ) : undefined;

  return (
    <div className="youtube-manage">
      <SubTabs
        wrap
        label={t("YouTube management")}
        value={section}
        items={youtubeSections(browser)}
        onValueChange={(value) => {
          setSection(value as YouTubeSection);
          setOperation("");
          setResult(undefined);
          setError("");
        }}
      />
      {browseForm ? (
        <YouTubeBrowse
          key={`${section}:${view ?? ""}`}
          client={client}
          account={account}
          form={browseForm}
          title={drilled ? t("Playlist items") : browseTitle(browseForm.action)}
          lead={lead}
          draft={draft}
          setField={setField}
          blocked={blocked}
          browser={browser}
          selectedId={selected?.id}
          onPick={
            [
              "youtube.superChats.list",
              "youtube.channel.read",
              "youtube.quota.status",
              "youtube.monetization.status",
            ].includes(browseForm.action)
              ? undefined
              : pick
          }
          review={
            reviewing
              ? (target) => {
                  review(target).catch(handleError);
                }
              : undefined
          }
          reconcile={
            reviewing
              ? (target, status) => {
                  reconcile(target, status).catch(handleError);
                }
              : undefined
          }
          emptyText={emptyText(browseForm.action)}
        />
      ) : lead ? (
        <div className="youtube-head">{lead}</div>
      ) : null}
      {form ? (
        <section className="youtube-task" aria-label={t("Actions")}>
          <Divider decorative />
          <div className="youtube-head">
            <SectionLabel as="h3">
              {taskForms.length === 1 ? form.label : t("Actions")}
            </SectionLabel>
          </div>
          {taskForms.length > 1 ? (
            taskForms.length <= 4 ? (
              <SegmentedControl
                label={t("Actions")}
                value={form.action}
                options={taskForms.map(({ action, label }) => ({
                  value: action,
                  label,
                }))}
                onValueChange={chooseTask}
              />
            ) : (
              <Select
                label={t("Actions")}
                hideLabel
                value={form.action}
                disabled={busy || blocked}
                options={taskForms.map(({ action, label }) => ({
                  value: action,
                  label,
                }))}
                onValueChange={chooseTask}
              />
            )
          ) : null}
          {selected && selected.keys.some((key) => taskFields?.some((f) => f.key === key)) ? (
            <div className="youtube-selected">
              <Text size="caption" tone="secondary">
                {t("Selected: {p0}", { p0: selected.title })}
              </Text>
              <Button size="sm" variant="ghost" onClick={clearSelection}>
                {t("Clear")}
              </Button>
            </div>
          ) : null}
          {taskFields?.length ? (
            <YouTubeFields
              key={form.action}
              client={client}
              accountId={account.id}
              fields={taskFields}
              draft={effective}
              setField={setField}
              disabled={busy || blocked}
              enabled={!blocked}
              unset={t("No change")}
              listAvailable={Boolean(browseForm)}
            />
          ) : null}
          {unavailable ? (
            <InlineMessage tone="warning">{capabilityReasonText(capability)}</InlineMessage>
          ) : null}
          {needsTarget && !blocked ? (
            <Text size="caption" tone="secondary">
              {t("Pick an item in the list above, or enter its ID.")}
            </Text>
          ) : null}
          {failureTitle ? <InlineError details={details}>{failureTitle}</InlineError> : null}
          <div className="youtube-actions">
            <Button
              variant={form.danger ? "secondary" : "primary"}
              tone={form.danger ? "danger" : undefined}
              disabled={Boolean(incomplete || unavailable || blocked || nothingToChange)}
              disabledReason={
                blocked
                  ? t("Connect and resume this account first.")
                  : unavailable
                    ? capabilityReasonText(capability)
                    : incomplete
                      ? t("Fill in the fields above.")
                      : t("No changes to save.")
              }
              loading={busy}
              onClick={() => {
                run().catch(handleError);
              }}
            >
              {actionLabel}
            </Button>
          </div>
          {scopeOperation ? (
            <YouTubeScopeHandoff
              client={client}
              account={account}
              operation={scopeOperation}
              disabled={blocked}
            />
          ) : result !== undefined ? (
            <YouTubeResult result={result} busy={busy} />
          ) : null}
        </section>
      ) : (
        <>
          {failureTitle ? <InlineError details={details}>{failureTitle}</InlineError> : null}
          {result !== undefined ? <YouTubeResult result={result} busy={busy} /> : null}
        </>
      )}
      {browser && section === "channel" ? (
        <Text size="caption" tone="secondary">
          {t("Connect this channel with the YouTube API to edit its description or banner.")}
        </Text>
      ) : null}
      {confirmation.dialog}
    </div>
  );
}
