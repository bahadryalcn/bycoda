import { useState } from "react";
import { formatNumber, t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { Checkbox } from "../../../../../shared/ui/Checkbox";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { InlineError } from "../../../../../shared/ui/InlineError";
import { Select } from "../../../../../shared/ui/Select";
import { Text } from "../../../../../shared/ui/Text";
import { TextField } from "../../../../../shared/ui/TextField";
import { isXResourceId } from "../../../../../integrations/social/adapters/x-identifiers";
import type { xReadInsights } from "../../../../../integrations/social/adapters/x-insights";
import type { getXOwnedLists } from "../../../../../integrations/social/adapters/x-relationships";
import type { xListOwnSpaces } from "../../../../../integrations/social/adapters/x-spaces";
import type { SocialAccount } from "../../../model/social";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";

const actions = [
  { value: "deletePost", label: () => t("Delete post"), target: "post" },
  { value: "like", label: () => t("Like"), target: "post", toggle: true },
  { value: "repost", label: () => t("Repost"), target: "post", toggle: true },
  { value: "bookmark", label: () => t("Bookmark"), target: "post", toggle: true },
  { value: "hideReply", label: () => t("Hide reply"), target: "post", toggle: true },
  { value: "follow", label: () => t("Follow"), target: "user", toggle: true },
  { value: "mute", label: () => t("Mute"), target: "user", toggle: true },
  { value: "block", label: () => t("Block"), target: "user", toggle: true, enterprise: true },
  { value: "createList", label: () => t("Create list"), name: true },
  { value: "updateList", label: () => t("Edit list"), name: true, list: true },
  { value: "deleteList", label: () => t("Delete list"), list: true },
  { value: "addListMember", label: () => t("Add list member"), target: "user", list: true },
  { value: "removeListMember", label: () => t("Remove list member"), target: "user", list: true },
] satisfies {
  value: string;
  label(): string;
  target?: string;
  toggle?: boolean;
  enterprise?: boolean;
  name?: boolean;
  list?: boolean;
}[];

type Props = { account: SocialAccount; client: SocialClient; disabled: boolean };

export function XApiActions({ account, client, disabled }: Props) {
  const [kind, setKind] = useState("deletePost");
  const [target, setTarget] = useState("");
  const [listId, setListId] = useState("");
  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [notice, setNotice] = useState("");
  const { confirm, dialog } = useConfirm();
  const { error, is, write } = useAccountWrite(
    t("The X action needs review. Check the result on X before sending again."),
  );
  const options = actions.filter(
    (action) => !action.enterprise || account.xApiProduct === "enterprise",
  );
  const action = options.find((item) => item.value === kind) ?? options[0]!;
  const valid =
    (!action.target || isXResourceId(target)) &&
    (!action.list || isXResourceId(listId)) &&
    (!action.name || Boolean(name.trim()));
  const apply = async () => {
    const fields = {
      ...(action.target === "post" ? { postId: target } : {}),
      ...(action.target === "user" ? { userId: target } : {}),
      ...(action.toggle ? { enabled } : {}),
      ...(action.list ? { listId } : {}),
      ...(action.name ? { name: name.trim() } : {}),
    };
    const approved = await confirm({
      title: action.label(),
      message: t("Apply this action to {p0}?", { p0: account.name }),
      details: [
        action.target ? target : "",
        action.list ? listId : "",
        action.name ? name : "",
        action.toggle ? (enabled ? t("Enable") : t("Disable")) : "",
      ]
        .filter(Boolean)
        .join(" · "),
      confirmLabel: t("Apply"),
      danger: action.value.startsWith("delete"),
    });
    if (!approved) return;
    setNotice("");
    await write("apply", async () => {
      const result = await client.request<{
        status: "applied" | "review";
        result?: { pending?: boolean; listId?: string };
      }>("x.apply", {
        accountId: account.id,
        kind: action.value,
        ...fields,
        intentId: crypto.randomUUID(),
        confirm: "APPLY_X_ACTION",
      });
      setNotice(
        result.status === "review"
          ? t("The X action needs review. Check the result on X before sending again.")
          : result.result?.pending
            ? t("Follow request pending")
            : (result.result?.listId ?? t("Applied")),
      );
    });
  };
  return (
    <div className="social-field-row">
      <Select
        label={t("X API action")}
        value={action.value}
        options={options.map((item) => ({ value: item.value, label: item.label() }))}
        onValueChange={setKind}
        disabled={disabled || is("apply")}
      />
      {action.target ? (
        <TextField
          label={action.target === "post" ? t("Post ID") : t("User ID")}
          inputMode="numeric"
          value={target}
          onChange={(event) => setTarget(event.currentTarget.value)}
        />
      ) : null}
      {action.list ? (
        <TextField
          label={t("List ID")}
          value={listId}
          inputMode="numeric"
          onChange={(event) => setListId(event.currentTarget.value)}
        />
      ) : null}
      {action.name ? (
        <TextField
          label={t("Name")}
          value={name}
          maxLength={25}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      ) : null}
      {action.toggle ? (
        <Checkbox
          label={t("Enable")}
          checked={enabled}
          onChange={(event) => setEnabled(event.currentTarget.checked)}
        />
      ) : null}
      <Button
        disabled={disabled || !valid}
        loading={is("apply")}
        onClick={() => void apply().catch(() => undefined)}
      >
        {t("Review")}
      </Button>
      {error ? <InlineError>{error}</InlineError> : null}
      {notice ? (
        <Text as="p" size="caption">
          {notice}
        </Text>
      ) : null}
      <XReadouts account={account} client={client} disabled={disabled} />
      {dialog}
    </div>
  );
}

function XReadouts({ account, client, disabled }: Props) {
  const [insights, setInsights] = useState<Awaited<ReturnType<typeof xReadInsights>>>();
  const [spaces, setSpaces] = useState<Awaited<ReturnType<typeof xListOwnSpaces>>>();
  const [lists, setLists] = useState<Awaited<ReturnType<typeof getXOwnedLists>>>();
  const { error, is, write } = useAccountWrite(t("Could not load data."));
  const read = (operation: string, fetch: () => Promise<void>) => void write(operation, fetch);
  return (
    <div className="social-field-row">
      {account.xApiProduct === "enterprise" ? (
        <Button
          disabled={disabled}
          loading={is("analytics")}
          onClick={() =>
            read("analytics", async () => {
              setInsights(await client.request("x.insights", { accountId: account.id }));
            })
          }
        >
          {t("Analytics")}
        </Button>
      ) : null}
      {account.xApiProduct === "enterprise" && insights ? (
        <Text as="p" size="caption">
          {t("Posts measured: {p0}", {
            p0: formatNumber(insights.coverage.requestedPosts),
          })}{" "}
          · {t("Impressions")}:{" "}
          {formatNumber(
            insights.daily.reduce((sum, day) => sum + (day.metrics.impressions ?? 0), 0),
          )}
        </Text>
      ) : null}
      <Button
        disabled={disabled}
        loading={is("spaces")}
        onClick={() =>
          read("spaces", async () => {
            setSpaces(await client.request("x.spaces", { accountId: account.id }));
          })
        }
      >
        {t("Spaces")}
      </Button>
      {spaces ? (
        <Text as="p" size="caption">
          {spaces.spaces.map((space) => space.title ?? space.id).join(" · ") || t("No results")}
        </Text>
      ) : null}
      <Button
        disabled={disabled}
        loading={is("lists")}
        onClick={() =>
          read("lists", async () => {
            setLists(await client.request("x.lists", { accountId: account.id }));
          })
        }
      >
        {t("X lists")}
      </Button>
      {lists ? (
        <Text as="p" size="caption">
          {lists.items.map((list) => `${list.name} (${list.id})`).join(" · ") || t("No results")}
        </Text>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
    </div>
  );
}
