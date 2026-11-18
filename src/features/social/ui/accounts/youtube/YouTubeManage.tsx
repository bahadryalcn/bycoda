import { useState } from "react";
import { t } from "../../../../../shared/i18n";
import { isoTimestamp } from "../../../../../shared/lib/time/timestamps";
import { Button } from "../../../../../shared/ui/Button";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { DatePicker } from "../../../../../shared/ui/DatePicker";
import { DateTimePicker } from "../../../../../shared/ui/DateTimePicker";
import { FieldGroup } from "../../../../../shared/ui/FieldGroup";
import { FileField } from "../../../../../shared/ui/FileField";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { NumberField } from "../../../../../shared/ui/NumberField";
import { Select } from "../../../../../shared/ui/Select";
import { Text } from "../../../../../shared/ui/Text";
import { TextareaField } from "../../../../../shared/ui/TextareaField";
import { TextField } from "../../../../../shared/ui/TextField";
import type { Capability, SocialAccount } from "../../../model/social";
import type { SocialClient } from "../../../model/socialClient";
import type { YouTubeOperation } from "../../../model/youtubeManagement";
import { capabilityReasonText } from "../../common/capabilityText";
import { useAccountWrite } from "../useAccountWrite";
import { asYoutubeRecord, YouTubeFacts, YouTubeResult } from "./YouTubeResult";
import {
  youtubeForms,
  youtubeSections,
  type YouTubeForm,
  type YouTubeFormField,
  type YouTubeSection,
} from "./youtubeForms";

type Draft = Record<string, string | File[]>;

function fieldValue(field: YouTubeFormField, value: string) {
  if (field.type === "number") return Number(value);
  if (field.type === "datetime") return value === "" ? null : isoTimestamp(Date.parse(value));
  if (field.type === "lines")
    return value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  if (field.type === "links")
    return value
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const split = line.indexOf("|");
        if (split < 0)
          throw new Error(t("One link per line in Name | https://example.com format."));
        return { title: line.slice(0, split).trim(), url: line.slice(split + 1).trim() };
      });
  return field.choices && (value === "true" || value === "false") ? value === "true" : value;
}

async function payload(
  form: YouTubeForm,
  draft: Draft,
  accountId: string,
  upload?: SocialClient["upload"],
) {
  const input: Record<string, unknown> = { accountId, ...form.fixed };
  const patch: Record<string, unknown> = {};
  for (const field of form.fields ?? []) {
    const raw = draft[field.key];
    if (raw === undefined) continue;
    if (raw === "" && !field.emptyAllowed) continue;
    const entry = form.fieldsInPatch?.includes(field.key) ? patch : input;
    if (Array.isArray(raw)) {
      if (!raw.length) continue;
      const ids = upload
        ? await Promise.all(raw.map(async (file) => (await upload(file)).uploadId))
        : raw.map((file) => file.name);
      entry[field.key] = field.multiple ? ids : ids[0];
    } else {
      entry[field.key] = fieldValue(field, raw);
    }
  }
  if (form.fieldsInPatch) input.patch = patch;
  return input;
}

function FormField({
  field,
  value,
  disabled,
  set,
}: {
  field: YouTubeFormField;
  value?: string | File[];
  disabled: boolean;
  set(value: string | File[]): void;
}) {
  const { label, description, required } = field;
  const input = typeof value === "string" ? value : "";
  const props = { label, disabled, required };
  if (field.choices)
    return (
      <Select
        label={label}
        value={input}
        disabled={disabled}
        onValueChange={set}
        options={field.choices}
      />
    );
  if (field.type === "images")
    return (
      <FileField
        label={label}
        disabled={disabled}
        multiple={field.multiple}
        description={Array.isArray(value) ? value.map((file) => file.name).join(", ") : description}
        accept="image/png,image/jpeg"
        onFiles={set}
      />
    );
  if (field.type === "date") return <DatePicker {...props} value={input} onChange={set} />;
  if (field.type === "datetime") return <DateTimePicker {...props} value={input} onChange={set} />;
  if (field.type === "number")
    return (
      <NumberField {...props} value={input} min={0} onChange={(event) => set(event.target.value)} />
    );
  if (field.type === "textarea" || field.type === "lines" || field.type === "links")
    return (
      <TextareaField
        {...props}
        description={description}
        value={input}
        minRows={2}
        onChange={(event) => set(event.target.value)}
      />
    );
  return (
    <TextField
      {...props}
      description={description}
      value={input}
      onChange={(event) => set(event.target.value)}
    />
  );
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
  const [operation, setOperation] = useState("");
  const [drafts, setDrafts] = useState<Partial<Record<YouTubeSection, Draft>>>({});
  const draft = drafts[section] ?? {};
  const setField = (key: string, value: string | File[]) =>
    setDrafts((current) => ({ ...current, [section]: { ...current[section], [key]: value } }));
  const [result, setResult] = useState<unknown>();
  const { write, error, is, setError } = useAccountWrite(t("The YouTube operation failed."));
  const confirmation = useConfirm();
  const forms = youtubeForms(section, browser);
  const selectedForm = forms.find((item) => item.action === operation) ?? forms[0]!;
  const form = {
    ...selectedForm,
    fields: selectedForm.fields?.filter(
      (field) => !field.whenKind || field.whenKind === draft.kind,
    ),
  };
  const busy = is("youtube");
  const connectionBlocked =
    disabled || (section !== "review" && (account.paused || !account.connected));
  const capability = capabilities.find((item) => item.operation === form.capability);
  const unavailable = capability && capability.status !== "available";
  const incomplete = form.fields?.some(({ key, required }) => required && !draft[key]?.length);
  const resultRecord = asYoutubeRecord(result);
  const videoPage = form.action === "youtube.videos.list";
  const next =
    typeof resultRecord?.next === "string"
      ? { cursor: resultRecord.next }
      : typeof resultRecord?.nextStartIndex === "number"
        ? { startIndex: resultRecord.nextStartIndex }
        : undefined;

  const run = async (page?: Record<string, unknown>) => {
    if (!form.write) {
      const response = await write(
        "youtube",
        async () =>
          await client.request(form.action, {
            ...(await payload(form, draft, account.id)),
            ...page,
          }),
      );
      if (response !== undefined) setResult(response);
      return;
    }
    const details = await payload(form, draft, account.id);
    const confirmed = await confirmation.confirm({
      title: form.label,
      message: account.name,
      danger: form.danger ?? false,
      confirmLabel: form.label,
      details: <YouTubeFacts data={details} />,
    });
    if (!confirmed) return;
    const response = await write(
      "youtube",
      async () =>
        await client.request(form.action, await payload(form, draft, account.id, client.upload)),
    );
    if (response !== undefined) setResult(response);
  };

  const select = (value: string) => {
    setOperation(value);
    setResult(undefined);
    setError("");
  };
  const selectItem = (item: Record<string, unknown>) => {
    if (typeof item.id !== "string") return;
    const key = videoPage
      ? "videoId"
      : section === "videos"
        ? draft.playlistId
          ? "playlistItemId"
          : "playlistId"
        : section === "comments"
          ? "commentId"
          : section === "subscriptions"
            ? "targetChannelId"
            : section === "live" && form.action === "youtube.liveChat.list"
              ? "messageId"
              : "broadcastId";
    const id =
      key === "targetChannelId" && typeof item.channelId === "string" ? item.channelId : item.id;
    setField(key, id);
    const action = videoPage
      ? "youtube.video.update"
      : section === "comments"
        ? "youtube.comment.moderate"
        : section === "subscriptions"
          ? "youtube.subscription.preview"
          : key === "playlistItemId"
            ? "youtube.playlist.move"
            : key === "playlistId"
              ? "youtube.playlists.list"
              : key === "messageId"
                ? "youtube.liveChat.delete"
                : "youtube.liveChat.list";
    if (action !== form.action) select(action);
  };
  const review = async (operation: YouTubeOperation) => {
    if (
      !(await confirmation.confirm({
        title: t("Approve YouTube operation"),
        message: account.name,
        danger: false,
        confirmLabel: t("Approve"),
        details: <YouTubeFacts data={{ action: operation.action, ...operation.input }} />,
      }))
    )
      return;
    const response = await write("youtube", () =>
      client.request("youtube.operation.approve", {
        accountId: account.id,
        id: operation.id,
        confirm: true,
      }),
    );
    if (response !== undefined) setResult(response);
  };
  const reconcile = async (operation: YouTubeOperation, status: "done" | "rejected") => {
    const label = status === "done" ? t("Completed") : t("Failed");
    if (
      !(await confirmation.confirm({
        title: label,
        message: t("YouTube outcome is uncertain. Verify it on YouTube before trying again."),
        danger: false,
        confirmLabel: label,
        details: <YouTubeFacts data={{ action: operation.action, ...operation.input }} />,
      }))
    )
      return;
    const response = await write("youtube", () =>
      client.request("youtube.operation.reconcile", {
        accountId: account.id,
        id: operation.id,
        status,
        confirm: true,
      }),
    );
    if (response !== undefined) setResult(response);
  };
  const handleError = (error: unknown) =>
    setError(error instanceof Error ? error.message : t("The YouTube operation failed."));
  const canSelectItem = [
    "youtube.videos.list",
    "youtube.playlists.list",
    "youtube.comments.list",
    "youtube.subscriptions.list",
    "youtube.broadcasts.list",
    "youtube.liveChat.list",
  ].includes(form.action);

  return (
    <FieldGroup disabled={busy || connectionBlocked}>
      <Select
        label={t("YouTube management")}
        hideLabel
        value={section}
        options={youtubeSections(browser)}
        onValueChange={(value) => {
          setSection(value as YouTubeSection);
          select("");
        }}
      />
      {forms.length > 1 ? (
        <Select
          label={t("Action")}
          value={form.action}
          options={forms.map(({ action, label }) => ({ value: action, label }))}
          onValueChange={select}
        />
      ) : null}
      {form.fields?.map((field) => (
        <FormField
          key={field.key}
          field={field}
          value={draft[field.key]}
          set={(value) => setField(field.key, value)}
          disabled={busy || connectionBlocked}
        />
      ))}
      {unavailable ? (
        <InlineMessage tone="warning">{capabilityReasonText(capability)}</InlineMessage>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
      <div>
        <Button
          variant="primary"
          disabled={Boolean(incomplete || unavailable)}
          loading={busy}
          onClick={() => {
            run().catch(handleError);
          }}
        >
          {form.label}
        </Button>
      </div>
      {result !== undefined ? (
        <YouTubeResult
          result={result}
          busy={busy}
          review={
            section === "review"
              ? (operation) => {
                  review(operation).catch(handleError);
                }
              : undefined
          }
          onPickItem={canSelectItem ? selectItem : undefined}
          reconcile={
            section === "review"
              ? (operation, status) => {
                  reconcile(operation, status).catch(handleError);
                }
              : undefined
          }
        />
      ) : null}
      {next ? (
        <Button
          disabled={busy}
          onClick={() => {
            run(next).catch(handleError);
          }}
        >
          {t("Next page")}
        </Button>
      ) : null}
      {browser && section === "channel" ? (
        <Text size="caption" tone="secondary">
          {t("Connect this channel with the YouTube API to edit its description or banner.")}
        </Text>
      ) : null}
      {confirmation.dialog}
    </FieldGroup>
  );
}
