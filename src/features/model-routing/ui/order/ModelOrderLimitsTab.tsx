import { useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { useT } from "../../../../shared/i18n";
import {
  HOST_USAGE_PLAN_SHARE,
  type PlanShareWindow,
} from "../../../../shared/model/host-contracts/usage-plan-share";
import { SegmentedControl } from "../../../../shared/ui/SegmentedControl";
import { Group } from "../../../../shared/ui/settings";
import { machineCapabilities } from "../../../automations/public/hostMachines";
import { isLocalSyncMachine } from "../../../connections/public/localSync";
import type { RemoteMachine } from "../../../connections/public/protocol";
import {
  PROVIDER_ACCOUNT_PROVIDERS,
  providerAccounts,
  subscribeProviderAccounts,
} from "../../../providers/public/providerAccounts";
import type { MachineLimits } from "../../../tasks/public/hostSettings";
import { useModelSource } from "../../../sessions/public/modelSource";
import type { OrderDraft } from "../../model/modelRoutingDraft";
import type { HostProviders } from "../../model/hostProviders";
import { ModelOrderLimits } from "./ModelOrderLimits";
import { PlanShareList } from "../limits/PlanShareList";

const labelsSnapshot = () =>
  JSON.stringify(
    Object.fromEntries(
      PROVIDER_ACCOUNT_PROVIDERS.flatMap((provider) =>
        providerAccounts(provider).map((account) => [`${provider}:${account.id}`, account.label]),
      ),
    ),
  );

/** Work limits, then the estimated plan share each job used (when the Host can attribute it). */
export function ModelOrderLimitsTab({
  machineId,
  machine,
  draft,
  usage,
  onChange,
  hostProviders,
  onFieldInvalid,
}: {
  machineId: string;
  /** The Host's settings machine; plan share needs its capability list. */
  machine?: RemoteMachine;
  draft: OrderDraft;
  usage: MachineLimits;
  /** The edited Host's providers; the limits table rows follow it. */
  hostProviders?: HostProviders;
  onChange: (draft: OrderDraft) => void;
  /** A limit field reports by key whether it shows a value the draft could not take. */
  onFieldInvalid: (key: string, invalid: boolean) => void;
}) {
  const t = useT();
  const [quotaWindow, setQuotaWindow] = useState<PlanShareWindow>("fiveHour");
  const source = useModelSource();
  const localLabels = useSyncExternalStore(
    subscribeProviderAccounts,
    labelsSnapshot,
    labelsSnapshot,
  );
  const labels: Record<string, string> = source.accounts
    ? Object.fromEntries(
        Object.entries(source.accounts).flatMap(([provider, accounts]) =>
          accounts.map((account) => [`${provider}:${account.id}`, account.label]),
        ),
      )
    : JSON.parse(localLabels);
  const capable = useQuery({
    queryKey: ["usage-plan-share-capability", machineId],
    queryFn: async () => (await machineCapabilities(machine!)).includes(HOST_USAGE_PLAN_SHARE),
    enabled: machine !== undefined,
    retry: false,
  });
  const supported = capable.data === true;
  return (
    <div className="flex flex-col gap-4">
      <ModelOrderLimits
        draft={draft}
        usage={usage}
        hostProviders={hostProviders}
        onChange={onChange}
        onFieldInvalid={onFieldInvalid}
      />
      {supported && machine ? (
        <Group
          title={t("Plan share by job")}
          layout="full"
          info={t(
            "An estimate of how much of each account's plan window the biggest jobs used. Providers report only a total, so every value is approximate.",
          )}
          action={
            <SegmentedControl
              label={t("Plan window")}
              value={quotaWindow}
              onValueChange={(next) => setQuotaWindow(next === "weekly" ? "weekly" : "fiveHour")}
              options={[
                { value: "fiveHour", label: t("5 hours") },
                { value: "weekly", label: t("Weekly") },
              ]}
            />
          }
        >
          <div className="px-4 py-3">
            <PlanShareList
              machineId={machineId}
              host={{ name: machine.name, local: isLocalSyncMachine(machine) }}
              supported={supported}
              window={quotaWindow}
              accountLabels={labels}
            />
          </div>
        </Group>
      ) : null}
    </div>
  );
}
