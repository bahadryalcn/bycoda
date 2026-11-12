import { Text } from "../../../shared/ui/Text";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { useT } from "../../../shared/i18n";
import { HARNESS_TITLE, type HarnessId } from "../model/session";
import { modelAccountLabelWith } from "../model/accountModelChoices";
import { supportsProviderAccounts } from "../../providers/public/providerAccounts";
import { useProviderAccounts } from "../../providers/public/useProviderAccounts";
import { useModelSource } from "./modelSource";

export function SessionAgentIdentity({
  harness,
  model,
  accountId,
  running,
  showAccount,
}: {
  harness: HarnessId;
  model: string;
  accountId?: string;
  running: boolean;
  showAccount: boolean;
}) {
  const t = useT();
  const accounts = useProviderAccounts(supportsProviderAccounts(harness) ? harness : null);
  const source = useModelSource();
  const resolved = source.resolve(harness, model);
  const label = `${HARNESS_TITLE[harness]} · ${showAccount ? modelAccountLabelWith(resolved, accountId, accounts, t) : resolved.name}`;
  return (
    <Text
      as="span"
      size="caption"
      tone="secondary"
      leading="normal"
      data-session-agent
      aria-label={`${t(running ? "Running agent" : "Session agent")}: ${label}`}
      className="flex min-w-0 items-center gap-1.5"
      title={`${t(running ? "Running agent" : "Session agent")}: ${label}`}
    >
      {running ? <StatusDot label={t("Running agent")} aria-hidden /> : null}
      <Text size="inherit" tone="inherit" truncate>
        {label}
      </Text>
    </Text>
  );
}
