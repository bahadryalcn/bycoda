import { useSyncExternalStore } from "react";
import {
  providerAccounts,
  subscribeProviderAccounts,
  supportsProviderAccounts,
} from "../../providers/public/providerAccounts";
import { modelAccountIdentities } from "../model/accountModelChoices";
import { useModelIdentity } from "../model/modelHooks";
import { effortSetting, settingValueLabel } from "../model/modelPickerData";
import type { HarnessId, Session } from "../model/session";
import type { ModelAccountIdentity } from "./ModelAccountIdentity";

/** The fields of a delegated child that say which account and effort it runs with. */
export type SubagentRunSession = Partial<
  Pick<Session, "harness" | "providerAccountId" | "modelSettings" | "runningModelTarget">
>;

/** A value-stable snapshot: the account list lives in storage. Only several accounts get a number. */
function accountSnapshot(provider: HarnessId | undefined, accountId: string | undefined): string {
  if (!provider || !accountId || !supportsProviderAccounts(provider)) return "";
  const identity = modelAccountIdentities(provider, providerAccounts(provider)).find(
    (account) => account.id === accountId,
  );
  return identity ? JSON.stringify(identity) : "";
}

/**
 * Account and effort of a delegated child, preferring what its live turn captured. A native
 * subagent records only its model, so both stay empty for it rather than guessing from the parent,
 * which may run with different settings.
 */
export function useSubagentRunIdentity(
  session: SubagentRunSession | undefined,
  modelId: string | undefined,
): { account?: ModelAccountIdentity; effort?: string } {
  const running = session?.runningModelTarget;
  const provider = running?.harness ?? session?.harness;
  const accountId = running?.providerAccountId ?? session?.providerAccountId;
  const accountJson = useSyncExternalStore(
    subscribeProviderAccounts,
    () => accountSnapshot(provider, accountId),
    () => "",
  );
  const model = useModelIdentity(session ? (running?.model ?? modelId) : undefined);
  const settings = running?.modelSettings ?? session?.modelSettings;
  const setting = model ? effortSetting(model) : undefined;
  const effort =
    settings && setting && settings[setting.id] ? settingValueLabel(setting, settings) : undefined;
  return {
    account: accountJson ? (JSON.parse(accountJson) as ModelAccountIdentity) : undefined,
    effort,
  };
}
