import { useState } from "react";
import { copyText } from "../../../../../platform/tauri/clipboard";
import { useT } from "../../../../../shared/i18n";
import { Badge } from "../../../../../shared/ui/Badge";
import { Button } from "../../../../../shared/ui/Button";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { CopyButton } from "../../../../../shared/ui/CopyButton";
import { Disclosure } from "../../../../../shared/ui/Disclosure";
import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { LoadingText } from "../../../../../shared/ui/LoadingText";
import { SectionLabel } from "../../../../../shared/ui/SectionLabel";
import { Surface } from "../../../../../shared/ui/Surface";
import { Text } from "../../../../../shared/ui/Text";
import { TextField } from "../../../../../shared/ui/TextField";
import type { FacebookLiveComment } from "../../../../../integrations/social/adapters/facebook-live";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";
import "./facebook.css";
import { FacebookLiveReply } from "./FacebookLiveReply";

type LiveState = {
  id?: string;
  title: string;
  phase: "creating" | "unpublished" | "starting" | "live" | "ending" | "ended";
  encoderReady: boolean;
};
type CommentPage = { comments: FacebookLiveComment[]; next?: string };

export function FacebookLivePanel({
  client,
  accountId,
  canStream,
}: {
  client: SocialClient;
  accountId: string;
  canStream: boolean;
}) {
  const t = useT();
  const confirm = useConfirm();
  const work = useAccountWrite(t("Could not save this change. Try again."));
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [broadcast, setBroadcast] = useState<LiveState | null>();
  const [page, setPage] = useState<CommentPage & { cursor?: string }>();
  const [uncertain, setUncertain] = useState(false);
  const load = async () => {
    const result = await work.write("list", () =>
      client.request<{ broadcasts: LiveState[] }>("facebook.live.list", { accountId }),
    );
    if (result) {
      const current = result.broadcasts[0] ?? null;
      if (current?.id !== broadcast?.id) setPage(undefined);
      setBroadcast(current);
      setUncertain(false);
    }
  };
  const comments = async (cursor?: string) => {
    const liveId = broadcast?.id;
    if (!liveId) return;
    const result = await work.write("comments", () =>
      client.request<CommentPage>("facebook.live.comments", {
        accountId,
        liveId,
        ...(cursor ? { cursor } : {}),
      }),
    );
    if (result) setPage({ ...result, cursor });
  };
  const mutate = async (action: "create" | "start" | "end") => {
    const label = labels[action];
    if (
      !(await confirm.confirm({
        title: label,
        message: action === "create" ? title : (broadcast?.title ?? ""),
        confirmLabel: label,
        danger: action === "end",
      }))
    )
      return;
    const input =
      action === "create"
        ? { title, ...(description.trim() ? { description } : {}) }
        : { liveId: broadcast?.id };
    const result = await work.write(action, () =>
      client.request<LiveState>(`facebook.live.${action}`, {
        accountId,
        ...input,
        confirm: `${action.toUpperCase()}_FACEBOOK_LIVE`,
      }),
    );
    if (!result) {
      setUncertain(true);
      return;
    }
    setBroadcast(result);
    setUncertain(result.phase === "creating");
    if (action === "create") setPage(undefined);
  };
  const labels = { create: t("Create live video"), start: t("Go live"), end: t("End live video") };
  const phases = {
    creating: t("Unconfirmed"),
    unpublished: t("Unpublished"),
    starting: t("Starting…"),
    live: t("Live"),
    ending: t("Unconfirmed"),
    ended: t("Ended"),
  };
  const liveId = broadcast?.id;
  const showCreate =
    canStream && broadcast !== undefined && (!broadcast || broadcast.phase === "ended");

  return (
    <section className="social-fb-stack" aria-label={t("Live video")}>
      <div className="social-fb-toolbar">
        <Button
          size="sm"
          variant="secondary"
          loading={work.is("list")}
          onClick={() => void load().catch(() => undefined)}
        >
          {broadcast === undefined ? t("Load live video") : t("Refresh")}
        </Button>
      </div>
      {broadcast === undefined && !work.is("list") && !work.error ? (
        <Text as="p" size="secondary" tone="muted">
          {t("Load your latest live video to start it, end it or read its comments.")}
        </Text>
      ) : null}
      {broadcast === undefined && work.is("list") ? (
        <LoadingText>{t("Loading…")}</LoadingText>
      ) : null}
      {broadcast === null ? (
        <EmptyState size="inline" description={t("No live video yet.")} />
      ) : null}
      {broadcast ? (
        <Surface variant="card" padding="sm" className="social-fb-item">
          <div className="social-fb-item-head">
            <Text as="span" weight="medium" className="social-fb-item-title">
              {broadcast.title}
            </Text>
            <Badge tone={broadcast.phase === "live" ? "success" : "neutral"}>
              {phases[broadcast.phase]}
            </Badge>
          </div>
          {broadcast.id ? (
            <>
              {broadcast.encoderReady ? (
                <Text as="p" size="secondary" tone="muted">
                  {t("Paste the stream server and key into your streaming software.")}
                </Text>
              ) : null}
              <div className="social-fb-actions">
                {broadcast.encoderReady ? (
                  <>
                    <CopyButton
                      size="sm"
                      label={t("Copy stream server")}
                      onCopy={async () =>
                        copyText((await client.facebookEncoder(accountId, broadcast.id!)).server)
                      }
                    />
                    <CopyButton
                      size="sm"
                      label={t("Copy stream key")}
                      onCopy={async () =>
                        copyText((await client.facebookEncoder(accountId, broadcast.id!)).streamKey)
                      }
                    />
                  </>
                ) : null}
                {canStream &&
                broadcast.encoderReady &&
                (broadcast.phase === "unpublished" || broadcast.phase === "starting") ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={work.is("start")}
                    onClick={() => void mutate("start").catch(() => undefined)}
                  >
                    {labels.start}
                  </Button>
                ) : null}
                {canStream && broadcast.phase !== "ended" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    tone="danger"
                    loading={work.is("end")}
                    onClick={() => void mutate("end").catch(() => undefined)}
                  >
                    {labels.end}
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}
        </Surface>
      ) : null}
      {showCreate ? (
        <div className="social-fb-group">
          <SectionLabel variant="inline" size="secondary" as="h4">
            {t("New live video")}
          </SectionLabel>
          <TextField
            label={t("Title")}
            value={title}
            maxLength={254}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
          <TextField
            label={t("Description")}
            value={description}
            maxLength={8000}
            onChange={(event) => setDescription(event.currentTarget.value)}
          />
          <Button
            size="sm"
            variant="primary"
            className="self-start"
            disabled={!title.trim() || uncertain}
            loading={work.is("create")}
            onClick={() => void mutate("create").catch(() => undefined)}
          >
            {labels.create}
          </Button>
        </div>
      ) : null}
      {broadcast && liveId ? (
        <div className="social-fb-toolbar">
          <Button
            size="sm"
            variant="secondary"
            loading={work.is("comments")}
            onClick={() => void comments().catch(() => undefined)}
          >
            {t("Live comments")}
          </Button>
        </div>
      ) : null}
      {page && !page.comments.length ? (
        <EmptyState size="inline" description={t("No comments on this live video yet.")} />
      ) : null}
      {liveId && page?.comments.length ? (
        <ul className="social-fb-list">
          {page.comments.map((comment) => (
            <Surface
              key={comment.id}
              as="li"
              variant="card"
              padding="sm"
              className="social-fb-item"
            >
              <Text as="span" size="caption" tone="muted">
                {comment.authorName ?? comment.authorId}
              </Text>
              <Text as="p" className="social-fb-item-title">
                {comment.text}
              </Text>
              {comment.canReply ? (
                <Disclosure summary={t("Reply")} variant="row">
                  <FacebookLiveReply
                    client={client}
                    accountId={accountId}
                    liveId={liveId}
                    comment={comment}
                    cursor={page.cursor}
                  />
                </Disclosure>
              ) : null}
            </Surface>
          ))}
        </ul>
      ) : null}
      {page?.next ? (
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          loading={work.is("comments")}
          onClick={() => void comments(page.next).catch(() => undefined)}
        >
          {t("Next page")}
        </Button>
      ) : null}
      {uncertain ? (
        <InlineMessage tone="warning">
          {t("Refresh the live video before trying again.")}
        </InlineMessage>
      ) : null}
      {work.error ? <InlineError>{work.error}</InlineError> : null}
      {confirm.dialog}
    </section>
  );
}
