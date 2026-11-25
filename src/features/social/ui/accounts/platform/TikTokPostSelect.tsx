import { useQuery } from "@tanstack/react-query";
import { useT } from "../../../../../shared/i18n";
import { Select } from "../../../../../shared/ui/Select";
import { presentRemoteError } from "../../../../connections/public/remoteFailure";
import { socialQueryScope } from "../../../model/socialQuery";
import type { TikTokPanelProps } from "./TikTokAccountTools";

type PostsResult = { posts?: { id: string; text?: string }[] };

/**
 * Picks one of the account's TikTok posts by caption. Only the Business API lists posts, so a
 * caller renders this when Business access is connected and keeps a typed ID as the fallback.
 */
export function TikTokPostSelect({
  client,
  accountId,
  disabled,
  value,
  onChange,
}: TikTokPanelProps & { value: string; onChange(postId: string): void }) {
  const t = useT();
  const query = useQuery({
    queryKey: [...socialQueryScope(client), "tiktok", accountId, "posts"],
    queryFn: () => client.request<PostsResult>("tiktok.analytics.read", { accountId }),
    staleTime: 60_000,
    enabled: !disabled,
  });
  const posts = query.data?.posts ?? [];
  const options = [
    {
      value: "",
      label: query.isPending ? t("Loading…") : t("Choose a post"),
      disabled: true,
    },
    ...(value && !posts.some((post) => post.id === value) ? [{ value, label: value }] : []),
    ...posts.map((post) => ({ value: post.id, label: post.text?.trim() || post.id })),
  ];
  return (
    <Select
      label={t("TikTok post")}
      value={value}
      options={options}
      disabled={disabled}
      error={query.isError ? presentRemoteError(query.error, { explicit: true }) : undefined}
      onValueChange={onChange}
    />
  );
}
