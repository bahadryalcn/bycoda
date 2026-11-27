import { accountBlockedReason } from "../accounts/blockedReason";
import { redactDiagnosticText } from "@bycoda/account-contracts";
import { useEffect, useState, type ReactNode } from "react";
import type {
  SnapchatEarningsQuery,
  SnapchatEarningsResult,
  SnapchatInsightAsset,
  SnapchatInsightGranularity,
  SnapchatInsightRow,
  SnapchatInsightsQuery,
  SnapchatInsightsResult,
} from "../../../../integrations/social/snapchat-insights";
import { formatDate, formatNumber, t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { CollectionFooter } from "../../../../shared/ui/ContinuousList";
import { DateRangePicker, type DateRange } from "../../../../shared/ui/DateRangePicker";
import { dateKey } from "../../../../shared/ui/date-time/values";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { LoadingText } from "../../../../shared/ui/LoadingText";
import { Select } from "../../../../shared/ui/Select";
import { Text } from "../../../../shared/ui/Text";
import type { Capability, SocialAccount, SocialSnapshot } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { useAccountWrite } from "../accounts/useAccountWrite";
import { snapchatAccountKey } from "../common/snapchatAccount";

type ReadProps = { client: SocialClient; accountId: string; disabled: boolean };
type InsightAsset = Exclude<SnapchatInsightAsset, "SNAP">;

const assetLabels: Record<InsightAsset, () => string> = {
  PROFILE: () => t("Public Profile"),
  LENS: () => t("Lenses"),
  STORY: () => t("Public Stories"),
  SAVED_STORY: () => t("Saved Stories"),
  SPOTLIGHT: () => t("Spotlight"),
};
const granularityLabels: Record<SnapchatInsightGranularity, () => string> = {
  LIFETIME: () => t("Lifetime"),
  TOTAL: () => t("Total"),
  DAY: () => t("Daily"),
};

function utcDate(value: string) {
  const date = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isFinite(date) ? formatDate(date, { timeZone: "UTC" }) : value;
}

function datePeriod(start: string, end: string) {
  return start === end ? utcDate(start) : `${utcDate(start)} – ${utcDate(end)}`;
}

function insightBounds(
  range: DateRange | null,
): Pick<SnapchatInsightsQuery, "startDate" | "endDate"> {
  if (!range) return {};
  const end = new Date(range.end);
  end.setDate(end.getDate() + 1);
  return { startDate: dateKey(range.start), endDate: dateKey(end) };
}

function insightKey(row: SnapchatInsightRow) {
  return JSON.stringify([
    row.assetId,
    row.metric,
    row.startTime,
    row.endTime,
    row.dimension,
    row.dimensionValue,
  ]);
}

type DataPage<T> = { rows: T[]; nextCursor?: string; partial?: boolean; context?: ReactNode };

function InsightPages<T>({
  disabled,
  label,
  empty,
  failure,
  loadPage,
  rowKey,
  renderRow,
}: {
  disabled: boolean;
  label: string;
  empty: string;
  failure: string;
  loadPage(cursor?: string): Promise<DataPage<T>>;
  rowKey(row: T): string;
  renderRow(row: T): ReactNode;
}) {
  const [page, setPage] = useState<DataPage<T>>();
  const { details, failureTitle, is, write } = useAccountWrite(failure);
  const loading = is("read") || is("more");
  const read = (cursor?: string) => {
    if (disabled || loading) return;
    void write(cursor ? "more" : "read", async () => {
      const result = await loadPage(cursor);
      setPage((previous) => ({
        ...result,
        rows:
          cursor && previous
            ? [
                ...new Map(
                  [...previous.rows, ...result.rows].map((row) => [rowKey(row), row]),
                ).values(),
              ]
            : result.rows,
        nextCursor: result.nextCursor === cursor ? undefined : result.nextCursor,
        partial: result.partial || (!!cursor && previous?.partial),
      }));
    }).catch(() => undefined);
  };

  return (
    <>
      <div className="social-field-row">
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled || loading}
          disabledReason={accountBlockedReason(disabled)}
          loading={is("read")}
          onClick={() => read()}
        >
          {page ? t("Refresh") : label}
        </Button>
      </div>
      {failureTitle ? <InlineError details={details}>{failureTitle}</InlineError> : null}
      {page?.context}
      {page?.rows.map((row) => (
        <div key={rowKey(row)}>{renderRow(row)}</div>
      ))}
      {!failureTitle && !loading && page?.rows.length === 0 && !page.partial && !page.nextCursor ? (
        <EmptyState size="inline" context="list" title={empty} />
      ) : null}
      <CollectionFooter
        hasMore={!!page?.nextCursor && !disabled}
        loading={is("more")}
        partial={page?.partial ? t("Some Snapchat results are unavailable.") : undefined}
        onLoadMore={() => {
          if (page?.nextCursor) read(page.nextCursor);
        }}
      />
    </>
  );
}

function Metrics({ client, accountId, disabled }: ReadProps) {
  const [assetType, setAssetType] = useState<InsightAsset>("PROFILE");
  const [granularity, setGranularity] = useState<SnapchatInsightGranularity>("LIFETIME");
  const [range, setRange] = useState<DateRange | null>(null);
  const recent = granularity !== "LIFETIME";
  const bounds = recent ? insightBounds(range) : {};

  return (
    <div className="social-card">
      <div className="social-field-row">
        <Select
          label={t("Format")}
          value={assetType}
          disabled={disabled}
          onValueChange={(value) => setAssetType(value as InsightAsset)}
          options={(Object.keys(assetLabels) as InsightAsset[]).map((value) => ({
            value,
            label: assetLabels[value](),
          }))}
        />
        <Select
          label={t("Granularity")}
          value={granularity}
          disabled={disabled}
          onValueChange={(value) => setGranularity(value as SnapchatInsightGranularity)}
          options={(Object.keys(granularityLabels) as SnapchatInsightGranularity[]).map(
            (value) => ({
              value,
              label: granularityLabels[value](),
            }),
          )}
        />
      </div>
      {recent ? (
        <DateRangePicker
          label={t("Date range")}
          value={range}
          onChange={setRange}
          onClear={() => setRange(null)}
          disabled={disabled}
        />
      ) : null}
      <InsightPages
        key={JSON.stringify([assetType, granularity, bounds])}
        disabled={disabled}
        label={t("Read insights")}
        empty={t("No Snapchat insights found.")}
        failure={t("Could not load Snapchat insights.")}
        loadPage={async (cursor) => {
          const query: SnapchatInsightsQuery = {
            assetType,
            granularity,
            ...bounds,
            ...(cursor ? { cursor } : {}),
          };
          const result = await client.request<SnapchatInsightsResult>("snapchat.analytics.get", {
            accountId,
            ...query,
          });
          return {
            ...result,
            context:
              result.startDate && result.endDate ? (
                <Text as="p" size="secondary" tone="muted">
                  {t("{p1} through {p2} (UTC, end exclusive)", {
                    p1: utcDate(result.startDate),
                    p2: utcDate(result.endDate),
                  })}
                </Text>
              ) : undefined,
          };
        }}
        rowKey={insightKey}
        renderRow={(row) => (
          <>
            <Text as="p" wrap="anywhere">
              {row.metric} · {formatNumber(row.value)}
            </Text>
            {assetType !== "PROFILE" || row.startTime || row.dimension ? (
              <Text as="p" size="secondary" tone="muted" wrap="anywhere">
                {[
                  assetType !== "PROFILE" ? row.assetId : undefined,
                  row.startTime ? utcDate(row.startTime) : undefined,
                  row.dimension,
                  row.dimensionValue,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            ) : null}
          </>
        )}
      />
    </div>
  );
}

function Earnings({ client, accountId, disabled }: ReadProps) {
  const [range, setRange] = useState<DateRange | null>(null);
  const startDate = range ? dateKey(range.start) : undefined;
  const endDate = range ? dateKey(range.end) : undefined;
  return (
    <div className="social-card">
      <DateRangePicker
        label={t("Date range")}
        value={range}
        onChange={setRange}
        onClear={() => setRange(null)}
        disabled={disabled}
      />
      <InsightPages
        key={JSON.stringify([startDate, endDate])}
        disabled={disabled}
        label={t("Read earnings")}
        empty={t("No Snapchat earnings found.")}
        failure={t("Could not load Snapchat earnings.")}
        loadPage={async (cursor) => {
          const query: SnapchatEarningsQuery = {
            ...(startDate && endDate ? { startDate, endDate } : {}),
            ...(cursor ? { cursor } : {}),
          };
          const result = await client.request<SnapchatEarningsResult>("snapchat.earnings.get", {
            accountId,
            ...query,
          });
          return {
            ...result,
            context: (
              <>
                <Text as="p" size="secondary" tone="muted">
                  {datePeriod(result.startDate, result.endDate)}
                </Text>
                <Text as="p" size="secondary" tone="muted">
                  {t("Data through {p1} (UTC)", { p1: utcDate(result.dataThrough) })}
                </Text>
              </>
            ),
          };
        }}
        rowKey={(row) => JSON.stringify([row.date, row.source, row.state, row.amountUsdMillis])}
        renderRow={(row) => (
          <Text as="p">
            {utcDate(row.date)} ·{" "}
            {formatNumber(row.amountUsdMillis / 1000, {
              style: "currency",
              currency: row.currency,
              minimumFractionDigits: 3,
              maximumFractionDigits: 3,
            })}{" "}
            · {row.source} · {row.state}
          </Text>
        )}
      />
    </div>
  );
}

function AccountInsights({
  client,
  account,
  capabilities,
  disabled,
}: {
  client: SocialClient;
  account: SocialAccount;
  capabilities: Capability[];
  disabled: boolean;
}) {
  const capability = capabilities.find((item) => item.operation === "analytics");
  if (capability?.status !== "available")
    return (
      <InlineMessage tone="warning">{capability?.reason || t("Connection needed")}</InlineMessage>
    );
  return (
    <>
      <Disclosure summary={t("Insights")} variant="row">
        <Metrics client={client} accountId={account.id} disabled={disabled} />
      </Disclosure>
      <Disclosure summary={t("Creator earnings")} variant="row">
        <Earnings client={client} accountId={account.id} disabled={disabled} />
      </Disclosure>
    </>
  );
}

export function SnapchatInsights({
  client,
  projectId,
  active,
  disabled,
}: {
  client: SocialClient;
  projectId?: string;
  active: boolean;
  disabled: boolean;
}) {
  const [snapshot, setSnapshot] = useState<SocialSnapshot>();
  const [failure, setFailure] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState("");

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Poll account grants only while this Host and project are visible in Command.
  useEffect(() => {
    if (!active || disabled) return;
    let current = true;
    const refresh = async () => {
      try {
        const { snapshot } = await client.sectionSnapshot({ section: "accounts", projectId });
        if (!snapshot) throw new Error("The Host did not return the account snapshot.");
        if (current) {
          setSnapshot(snapshot);
          setFailure(undefined);
        }
      } catch (cause) {
        if (current) setFailure(cause instanceof Error ? redactDiagnosticText(cause.message) : "");
      } finally {
        if (current) setLoading(false);
      }
    };
    setLoading(true);
    void refresh().catch(() => undefined);
    const timer = setInterval(() => void refresh().catch(() => undefined), 60_000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [active, client, projectId, disabled, retry]);

  const accounts =
    snapshot?.accounts.filter(
      (account) =>
        account.platform === "snapchat" &&
        account.accountType === "public_profile" &&
        account.connection !== "browser" &&
        (!projectId || account.grants[projectId]?.includes("read")),
    ) ?? [];
  const account = accounts.find((item) => item.id === selected) ?? accounts[0];
  const readPending = loading && active && !disabled;
  if (failure === undefined && !readPending && (!account || !snapshot)) return null;
  const executorMismatch = !!account && account.executorId !== snapshot?.executorId;
  return (
    <>
      {failure !== undefined ? (
        <InlineError
          details={failure}
          retry={{
            onRetry: () => setRetry((value) => value + 1),
            pending: readPending,
            disabled,
          }}
        >
          {t("Could not read the accounts. Try again.")}
        </InlineError>
      ) : null}
      {!snapshot && readPending ? <LoadingText>{t("Loading accounts…")}</LoadingText> : null}
      {account && snapshot ? (
        <Disclosure summary={t("Snapchat insights")} variant="row">
          <div className="social-card">
            {executorMismatch ? (
              <InlineMessage tone="warning">
                {t("This account is connected on another computer.")}
              </InlineMessage>
            ) : null}
            {accounts.length > 1 ? (
              <Select
                label={t("Account")}
                value={account.id}
                onValueChange={setSelected}
                disabled={disabled}
                options={accounts.map((item) => ({ value: item.id, label: item.name }))}
              />
            ) : (
              <Text as="p" size="secondary">
                {account.name}
              </Text>
            )}
            <AccountInsights
              key={snapchatAccountKey(client, account)}
              client={client}
              account={account}
              capabilities={snapshot.capabilities[account.id] ?? []}
              disabled={disabled || executorMismatch}
            />
          </div>
        </Disclosure>
      ) : null}
    </>
  );
}
