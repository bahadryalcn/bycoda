import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useT } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { DescriptionItem, DescriptionList } from "../../../../../shared/ui/DescriptionList";
import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { LoadingText } from "../../../../../shared/ui/LoadingText";
import { Surface } from "../../../../../shared/ui/Surface";
import { Text } from "../../../../../shared/ui/Text";
import type {
  InstagramManagementKind,
  InstagramManagementRequest,
} from "../../../model/instagramManagement";
import type { SocialClient } from "../../../model/socialClient";
import { socialQueryScope } from "../../../model/socialQuery";
import { useAccountWrite } from "../useAccountWrite";
import "./instagram.css";

/**
 * Changes the assistant proposes for this Instagram account. Nothing runs from this list: the owner
 * makes the change in the matching Instagram tab and then dismisses the request.
 */
export function InstagramManagementRequests({
  client,
  accountId,
  disabled,
}: {
  client: SocialClient;
  accountId: string;
  disabled: boolean;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const { write, is, error } = useAccountWrite(t("Could not save this change. Try again."));
  const requestsKey = [...socialQueryScope(client), "instagram", accountId, "management"];
  const query = useQuery({
    queryKey: requestsKey,
    queryFn: async () =>
      (
        await client.request<{ requests: InstagramManagementRequest[] }>(
          "instagram.management.list",
          { accountId },
        )
      ).requests,
    staleTime: 15_000,
  });
  const requests = query.data;
  const titles: Record<InstagramManagementKind, string> = {
    "post.edit": t("Edit post"),
    "post.delete": t("Delete post"),
    "profile.update": t("Edit profile"),
    "highlight.create": t("Create Highlight"),
    "highlight.edit": t("Edit Highlight"),
    "highlight.delete": t("Delete Highlight"),
    "dm.draft": t("New message"),
  };
  const dismiss = async (item: InstagramManagementRequest) => {
    const done = await write(item.id, () =>
      client.request("instagram.management.dismiss", { accountId, id: item.id }),
    );
    if (done)
      queryClient.setQueryData<InstagramManagementRequest[]>(requestsKey, (current) =>
        current?.filter((row) => row.id !== item.id),
      );
  };
  return (
    <section className="instagram-panel" aria-label={t("Instagram requests")}>
      <div className="instagram-actions">
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          loading={query.isFetching}
          onClick={() => {
            query.refetch().catch(() => undefined);
          }}
        >
          {t("Refresh")}
        </Button>
        <Text as="span" size="caption" tone="muted">
          {t("Changes the assistant proposes wait here for your approval.")}
        </Text>
      </div>
      {!requests && query.isFetching ? <LoadingText /> : null}
      {requests?.length === 0 ? (
        <EmptyState size="inline" description={t("No requests waiting.")} />
      ) : null}
      {requests?.map((item) => (
        <Surface key={item.id} variant="card" padding="sm">
          <Text as="p" weight="medium">
            {titles[item.kind]}
          </Text>
          <DescriptionList size="sm">
            {Object.entries(item.details).map(([field, value]) => (
              <DescriptionItem key={field} term={field} monospace>
                {typeof value === "string" ? value : JSON.stringify(value)}
              </DescriptionItem>
            ))}
          </DescriptionList>
          <InlineMessage tone="info">
            {t("Make this change in the matching Instagram tab, then dismiss the request.")}
          </InlineMessage>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            loading={is(item.id)}
            onClick={() => {
              dismiss(item).catch(() => undefined);
            }}
          >
            {t("Dismiss")}
          </Button>
        </Surface>
      ))}
      {error || query.error ? (
        <InlineError>{error ?? t("Could not load data.")}</InlineError>
      ) : null}
    </section>
  );
}
