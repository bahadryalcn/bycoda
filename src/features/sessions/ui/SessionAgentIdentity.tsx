import { useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { HARNESS_TITLE, type HarnessId } from "../model/session";
import { accountChoicesSnapshot, modelAccountLabel } from "../model/accountModelChoices";
import { subscribeProviderAccounts } from "../../providers/model/providerAccounts";
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
  useLocale();
  useSyncExternalStore(subscribeProviderAccounts, accountChoicesSnapshot, accountChoicesSnapshot);
  const source = useModelSource();
  const resolved = source.resolve(harness, model);
  const label = `${HARNESS_TITLE[harness]} · ${showAccount ? modelAccountLabel(resolved, accountId) : resolved.name}`;
  return (
    <span
      data-session-agent
      aria-label={`${t(running ? "Running agent" : "Session agent")}: ${label}`}
      className="session-agent-identity flex min-w-0 items-center gap-1.5"
      title={`${t(running ? "Running agent" : "Session agent")}: ${label}`}
    >
      {running ? (
        <span className="size-1.5 shrink-0 rounded-full bg-(--ui-tone-success-fg)" aria-hidden />
      ) : null}
      <span className="truncate">{label}</span>
    </span>
  );
}
