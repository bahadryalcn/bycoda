import { useState } from "react";
import { t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { Checkbox } from "../../../../../shared/ui/Checkbox";
import { Disclosure } from "../../../../../shared/ui/Disclosure";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { SectionLabel } from "../../../../../shared/ui/SectionLabel";
import { Select } from "../../../../../shared/ui/Select";
import { TextField } from "../../../../../shared/ui/TextField";
import { isXResourceId } from "../../../../../integrations/social/adapters/x-identifiers";
import type { SocialAccount, SocialJob } from "../../../model/social";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";
import { useXApply, type XApplyKind } from "./XApply";
import { xPostLabel, xPublishedPosts } from "./XPosts";
import "./x.css";

type PostAction = {
  value: XApplyKind;
  label(): string;
  target: "post" | "user";
  toggle?: boolean;
  enterprise?: boolean;
};

const actions: PostAction[] = [
  { value: "deletePost", label: () => t("Delete post"), target: "post" },
  { value: "like", label: () => t("Like"), target: "post", toggle: true },
  { value: "repost", label: () => t("Repost"), target: "post", toggle: true },
  { value: "bookmark", label: () => t("Bookmark"), target: "post", toggle: true },
  { value: "hideReply", label: () => t("Hide reply"), target: "post", toggle: true },
  { value: "follow", label: () => t("Follow"), target: "user", toggle: true },
  { value: "mute", label: () => t("Mute"), target: "user", toggle: true },
  { value: "block", label: () => t("Block"), target: "user", toggle: true, enterprise: true },
];

type Props = { account: SocialAccount; client: SocialClient; disabled: boolean };

/** One reviewed action on a post or an account. Posts are picked from your published posts. */
export function XPostActions({ account, client, disabled }: Props) {
  const [kind, setKind] = useState<XApplyKind>("deletePost");
  const [jobs, setJobs] = useState<SocialJob[]>();
  const [picked, setPicked] = useState("");
  const [manual, setManual] = useState("");
  const [userId, setUserId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const listing = useAccountWrite(t("Could not load your posts."));
  const x = useXApply(account, client);
  const browser = account.connection === "browser";
  const options = actions.filter((action) =>
    browser
      ? action.value === "deletePost"
      : !action.enterprise || account.xApiProduct === "enterprise",
  );
  const action = options.find((item) => item.value === kind) ?? options[0]!;
  const posts = xPublishedPosts(jobs ?? [], account.id);
  const postId = manual.trim() || posts.find((job) => job.id === picked)?.platformId || "";
  const target = action.target === "post" ? postId : userId.trim();
  const valid = isXResourceId(target);
  const loadPosts = () =>
    listing.write("posts", async () => {
      const page = await client.workspaceSnapshot({
        section: "history",
        limit: 50,
        filters: { jobs: { accountId: account.id, kind: "publish", status: "succeeded" } },
      });
      setJobs(page.snapshot?.jobs ?? []);
    });
  const review = async () => {
    const known = posts.find((job) => job.platformId === postId);
    const postLabel = known ? xPostLabel(known) : postId;
    const done = await x.apply({
      kind: action.value,
      title: action.label(),
      details: [
        action.target === "post" ? postLabel : userId.trim(),
        action.value === "deletePost" && postLabel !== postId ? postId : "",
        action.toggle ? (enabled ? t("Enable") : t("Disable")) : "",
      ]
        .filter(Boolean)
        .join(" · "),
      fields: {
        ...(action.target === "post" ? { postId: target } : { userId: target }),
        ...(action.toggle ? { enabled } : {}),
      },
      danger: action.value === "deletePost",
    });
    if (done && action.target === "post") {
      setPicked("");
      setManual("");
    }
  };
  const busy = disabled || x.busy;
  return (
    <div className="social-x-group">
      <SectionLabel variant="inline" size="secondary" as="h4">
        {browser ? t("Delete post") : t("Posts and accounts")}
      </SectionLabel>
      {browser ? null : (
        <Select
          label={t("X API action")}
          value={action.value}
          options={options.map((item) => ({ value: item.value, label: item.label() }))}
          onValueChange={(value) => setKind(value as XApplyKind)}
          disabled={busy}
        />
      )}
      {action.target === "post" ? (
        <>
          <div className="social-x-toolbar social-x-toolbar-pick">
            <Select
              label={t("Post")}
              value={picked}
              disabled={busy || !posts.length}
              options={[
                {
                  value: "",
                  label: posts.length ? t("Choose a post") : t("Load your posts first"),
                },
                ...posts.map((job) => ({ value: job.id, label: xPostLabel(job) })),
              ]}
              onValueChange={(value) => {
                setPicked(value);
                setManual("");
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              loading={listing.is("posts")}
              disabled={busy}
              onClick={() => void loadPosts().catch(() => undefined)}
            >
              {jobs ? t("Refresh") : t("Load my posts")}
            </Button>
          </div>
          {jobs && !posts.length ? (
            <InlineMessage tone="info">
              {t("No posts published from MonoCode yet. Use a post ID instead.")}
            </InlineMessage>
          ) : null}
          <Disclosure summary={t("Use a post ID instead")} variant="row">
            <TextField
              label={t("Post ID")}
              description={t("The number at the end of the post's link on x.com.")}
              inputMode="numeric"
              value={manual}
              disabled={busy}
              onChange={(event) => {
                setManual(event.currentTarget.value);
                setPicked("");
              }}
            />
          </Disclosure>
        </>
      ) : (
        <TextField
          label={t("User ID")}
          description={t("The numeric ID of the account, not its @username.")}
          inputMode="numeric"
          value={userId}
          disabled={busy}
          onChange={(event) => setUserId(event.currentTarget.value)}
        />
      )}
      {action.toggle ? (
        <Checkbox
          size="secondary"
          label={t("Enable")}
          checked={enabled}
          disabled={busy}
          onChange={(event) => setEnabled(event.currentTarget.checked)}
        />
      ) : null}
      <Button
        size="sm"
        variant="primary"
        className="self-start"
        disabled={busy || !valid}
        loading={x.busy}
        onClick={() => void review().catch(() => undefined)}
      >
        {t("Review")}
      </Button>
      {listing.error ? <InlineError>{listing.error}</InlineError> : null}
      {x.error ? <InlineError>{x.error}</InlineError> : null}
      {x.notice ? <InlineMessage tone="info">{x.notice}</InlineMessage> : null}
      {x.dialog}
    </div>
  );
}
