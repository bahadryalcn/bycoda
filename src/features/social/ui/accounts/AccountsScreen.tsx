import { InlineError } from "../../../../shared/ui/InlineError";
import { LoadingText } from "../../../../shared/ui/LoadingText";
import { Text } from "../../../../shared/ui/Text";
import { useState } from "react";
import { dateTimeFormat } from "../../../../shared/lib/intl";
import { t } from "../../../../shared/i18n";
import { InlineMessage } from "../../../../shared/ui/InlineError";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { Sheet } from "../../../../shared/ui/Sheet";
import { EmptyHint } from "../common/EmptyHint";
import { DisabledReason, gateProps, type ActionGate } from "../common/DisabledReason";
import type { SocialScreenProps } from "../shell/screens";
import { AccountDetail } from "./AccountDetail";
import { AccountRow } from "./AccountRow";
import { ConnectAccountDialog } from "./ConnectAccountDialog";
import { GeneralSettings } from "./GeneralSettings";
import { accountHealth } from "./accountsModel";
import { useAccountsData } from "./useAccountsData";
import "./accounts.css";

/** Accounts & Settings: the account list, per-account detail and the general settings below it. */
export function AccountsScreen({
  client,
  machineId,
  projectId,
  shellState,
  active,
}: SocialScreenProps) {
  const data = useAccountsData({ client, machineId, projectId, active });
  const [selectedId, setSelectedId] = useState<string>();
  const [connectOpen, setConnectOpen] = useState(false);
  const { snapshot } = data;
  const accounts = snapshot?.accounts ?? [];
  const selected = accounts.find((account) => account.id === selectedId);
  const hostOnline = snapshot?.hostOnline ?? shellState.hostOnline;
  const connectGate: ActionGate = shellState.unreachable
    ? { disabled: true, disabledReason: t("Could not reach this computer.") }
    : { disabled: false };

  return (
    <div className="social-accounts-screen">
      <SectionLabel
        className="social-accounts-toolbar"
        as="h3"
        count={snapshot ? accounts.length : null}
        actions={
          <DisabledReason
            variant="primary"
            size="sm"
            onClick={() => setConnectOpen(true)}
            {...gateProps(connectGate)}
          >
            {t("Connect account")}
          </DisabledReason>
        }
      >
        {t("Accounts")}
      </SectionLabel>
      {data.error ? (
        <InlineError retry={{ onRetry: data.reload, label: t("Try again") }}>
          {data.error}
        </InlineError>
      ) : null}
      {data.projectsError ? (
        <InlineError retry={{ onRetry: data.reload, label: t("Try again") }}>
          {t("Could not read projects. Previous results may be out of date.")}
        </InlineError>
      ) : null}
      {data.needsHumanError ? (
        <InlineError retry={{ onRetry: data.reload, label: t("Try again") }}>
          {t("Could not check whether accounts need your attention.")}
        </InlineError>
      ) : null}
      {data.checkedAt ? (
        <Text size="caption" tone="secondary">
          {t("Last checked: {p1}", { p1: dateTimeFormat().format(data.checkedAt) })}
        </Text>
      ) : null}
      {snapshot && !hostOnline ? (
        <InlineMessage tone="warning" live="off">
          {t("Scheduling is offline. Scheduled posts and replies wait until the Host is back.")}
        </InlineMessage>
      ) : null}
      <section className="social-accounts-section" aria-label={t("Accounts")}>
        {!snapshot && data.loading ? (
          <LoadingText delay={false} className="social-muted">
            {t("Loading…")}
          </LoadingText>
        ) : null}
        {accounts.length ? (
          <ul className="social-account-list">
            {accounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                selected={account.id === selectedId}
                capabilities={snapshot?.capabilities[account.id] ?? []}
                health={accountHealth({
                  account,
                  capabilities: snapshot?.capabilities[account.id] ?? [],
                  needsHuman: data.needsHumanKnown ? data.needsHumanIds.has(account.id) : undefined,
                  now: data.now,
                })}
                onOpen={() => setSelectedId(account.id)}
              />
            ))}
          </ul>
        ) : snapshot ? (
          <EmptyHint
            message={t("No accounts yet. Connect one to start.")}
            action={{
              label: t("Connect account"),
              onClick: () => setConnectOpen(true),
              ...connectGate,
            }}
          />
        ) : null}
      </section>
      {snapshot ? (
        <GeneralSettings
          client={client}
          snapshot={snapshot}
          hostOnline={hostOnline}
          projectId={projectId}
          onChanged={data.reload}
        />
      ) : null}
      {selected && snapshot ? (
        <Sheet title={selected.name} size="42rem" onClose={() => setSelectedId(undefined)}>
          <AccountDetail
            key={selected.id}
            client={client}
            account={selected}
            snapshot={snapshot}
            projects={data.projects}
            needsHuman={data.needsHumanKnown ? data.needsHumanIds.has(selected.id) : undefined}
            now={data.now}
            hostOnline={hostOnline}
            onChanged={data.reload}
          />
        </Sheet>
      ) : null}
      {connectOpen ? (
        <ConnectAccountDialog
          client={client}
          projects={data.projects}
          initialProjectId={projectId}
          onClose={() => setConnectOpen(false)}
          onCreated={(accountId) => {
            setConnectOpen(false);
            setSelectedId(accountId);
            data.reload();
          }}
        />
      ) : null}
    </div>
  );
}
