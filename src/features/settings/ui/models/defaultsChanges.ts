import { t } from "../../../../shared/i18n";
import type { PendingChange } from "../../../../shared/ui/settings";
import { HARNESS_TITLE } from "../../../sessions";
import type { HarnessId } from "../../../sessions/public/session";
import { defaultModelId, resolveModel } from "../../../sessions/public/models";
import {
  providerAccounts,
  supportsProviderAccounts,
} from "../../../providers/public/providerAccounts";
import {
  draftChangeItems,
  withoutDraftItem,
  type DefaultsDraft,
  type DraftChangeItem,
} from "../../model/providerDefaultsDraft";

const FIELD_LABEL: Record<Exclude<DraftChangeItem["field"], "extra">, string> = {
  defaultProvider: "Default provider",
  model: "Model",
  effort: "Effort",
  runtimeMode: "Permissions",
  hidden: "Show in picker",
  account: "Account",
};
const DELEGATION_LABEL: Record<string, string> = {
  crossSubagents: "Subagents",
  crossAdvisor: "Advisor",
  crossSubagentMaxEffort: "Subagent max effort",
  imageModels: "Image models",
};

function extraLabel(harness: HarnessId, key: string): string {
  if (DELEGATION_LABEL[key]) return t(DELEGATION_LABEL[key]);
  const setting = resolveModel(harness, defaultModelId(harness)).settings?.find(
    (candidate) => candidate.id === key,
  );
  return setting ? t(setting.label) : key;
}

function scopeLabel(item: DraftChangeItem): string | undefined {
  if (!item.harness) return undefined;
  const provider = HARNESS_TITLE[item.harness];
  if (!item.accountId || !supportsProviderAccounts(item.harness)) return provider;
  const account = providerAccounts(item.harness).find((entry) => entry.id === item.accountId);
  return `${provider} · ${account?.label ?? item.accountId}`;
}

function detail(item: DraftChangeItem): string | undefined {
  if (item.field === "defaultProvider")
    return typeof item.value === "string" ? HARNESS_TITLE[item.value as HarnessId] : undefined;
  if (item.value === null) return t("Reset to inherited");
  if (typeof item.value === "boolean") return item.value ? t("On") : t("Off");
  // Long encoded values (subagent lists) say nothing useful in one line.
  return typeof item.value === "string" && item.value.length <= 40 ? item.value : undefined;
}

/** Every unsaved field of the Defaults draft, grouped by provider and account, each revertible. */
export function defaultsDraftChanges(
  draft: DefaultsDraft,
  onDraftChange: (draft: DefaultsDraft) => void,
): PendingChange[] {
  return draftChangeItems(draft).map((item) => ({
    id: item.id,
    scope: scopeLabel(item),
    label:
      item.field === "extra"
        ? extraLabel(item.harness!, item.extraKey ?? "")
        : t(FIELD_LABEL[item.field]),
    detail: detail(item),
    revert: () => onDraftChange(withoutDraftItem(draft, item)),
  }));
}
