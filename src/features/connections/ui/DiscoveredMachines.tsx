import { useState } from "react";
import { Apple, Laptop, Smartphone, Terminal } from "../../../shared/ui/icons";
import { useAccount } from "../../account";
import { t, useLocale } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Surface } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import {
  accountPairPlan,
  sshAddPlan,
  type CandidateSource,
  type DiscoveredMachine,
  type SshAddPlan,
} from "../model/machineCandidates";
import type { AccountPairPlan } from "../model/accountDesktopPairing";
import { AccountPairDialog } from "./AccountPairDialog";
import { useDiscoveredMachines } from "./useDiscoveredMachines";
import type { RemoteMachine } from "../model/protocol";

const SOURCE_LABEL: Record<CandidateSource, string> = {
  account: "Account",
  tailscale: "Tailscale",
  "ssh-config": "SSH config",
  "known-hosts": "Known hosts",
  servers: "Servers",
};

function MachineIcon({ machine }: { machine: DiscoveredMachine }) {
  if (machine.group === "mobile") return <Smartphone aria-hidden className="icon-md" />;
  if (machine.os === "macos") return <Apple aria-hidden className="icon-md" />;
  if (machine.os === "linux") return <Terminal aria-hidden className="icon-md" />;
  return <Laptop aria-hidden className="icon-md" />;
}

function CandidateRow({
  machine,
  busy,
  onAdd,
  onPair,
}: {
  machine: DiscoveredMachine;
  busy: boolean;
  onAdd: (plan: SshAddPlan) => void;
  onPair: (plan: AccountPairPlan) => void;
}) {
  const plan = sshAddPlan(machine);
  const pair = plan ? null : accountPairPlan(machine);
  const sources = [...new Set(machine.sources.map((source) => SOURCE_LABEL[source]))];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
      <MachineIcon machine={machine} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Text wrap="anywhere" weight="medium" tone="primary">
          {machine.name}
        </Text>
        <div className="flex flex-wrap items-center gap-1">
          {sources.map((source) => (
            <Badge key={source} size="xs">
              {t(source)}
            </Badge>
          ))}
        </div>
      </div>
      {machine.online !== undefined ? (
        <Badge variant="dot" size="sm" tone={machine.online ? "success" : "neutral"}>
          {machine.online ? t("Online") : t("Offline")}
        </Badge>
      ) : null}
      <div className="flex shrink-0 items-center gap-1">
        <Button
          stableWidth
          variant="secondary"
          disabled={busy || (!plan && !pair)}
          onClick={() => (plan ? onAdd(plan) : pair && onPair(pair))}
        >
          {t("Add")}
        </Button>
        {plan || pair ? null : (
          <InfoPopover label={t("Why Add is unavailable")} width={280}>
            <p>{t("This computer has no SSH address to set it up from here yet.")}</p>
          </InfoPopover>
        )}
      </div>
    </div>
  );
}

function Rows({
  machines,
  busy,
  onAdd,
  onPair,
}: {
  machines: DiscoveredMachine[];
  busy: boolean;
  onAdd: (plan: SshAddPlan) => void;
  onPair: (plan: AccountPairPlan) => void;
}) {
  return (
    <Surface variant="outline" padding="none" dividers="card" className="overflow-hidden">
      {machines.map((machine) => (
        <CandidateRow
          key={machine.key}
          machine={machine}
          busy={busy}
          onAdd={onAdd}
          onPair={onPair}
        />
      ))}
    </Surface>
  );
}

/**
 * Machines the desktop found that are not added yet: the account's computers first, then
 * Tailscale and SSH candidates. Add starts the SSH setup with the address filled in; a computer
 * only the account knows is added by asking it through the account, with no address typed.
 */
export function DiscoveredMachines({
  saved,
  active,
  busy,
  onAdd,
  onPaired,
}: {
  saved: RemoteMachine[];
  /** The list is visible; it refreshes only then. */
  active: boolean;
  busy: boolean;
  onAdd: (plan: SshAddPlan) => void;
  /** An account-paired machine was saved; the caller refreshes its machine list. */
  onPaired: () => void;
}) {
  useLocale();
  const [pairing, setPairing] = useState<AccountPairPlan | null>(null);
  const { signIn } = useAccount();
  const { machines, loading, signedOut } = useDiscoveredMachines(saved, active);
  const open = machines.filter((machine) => !machine.alreadyAdded);
  const main = open.filter((machine) => !machine.group);
  const shared = open.filter((machine) => machine.group === "shared");
  const mobile = open.filter((machine) => machine.group === "mobile");
  return (
    <section aria-label={t("Machines found")} className="flex flex-col gap-2">
      <SectionLabel>{t("Machines found")}</SectionLabel>
      {signedOut ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Text tone="muted">{t("Sign in to see your other computers.")}</Text>
          <Button variant="secondary" onClick={() => void signIn().catch(() => undefined)}>
            {t("Sign in")}
          </Button>
        </div>
      ) : null}
      {main.length > 0 ? (
        <Rows machines={main} busy={busy} onAdd={onAdd} onPair={setPairing} />
      ) : null}
      {main.length === 0 && loading ? (
        <LoadingText>{t("Looking for machines…")}</LoadingText>
      ) : null}
      {main.length === 0 && !loading && !signedOut ? (
        <EmptyState size="inline" kind="empty" description={t("No new machines found")} />
      ) : null}
      {shared.length > 0 ? (
        <Disclosure
          size="sm"
          textSize="caption"
          tone="muted"
          summary={t("Shared with you")}
          count={shared.length}
        >
          <Rows machines={shared} busy={busy} onAdd={onAdd} onPair={setPairing} />
        </Disclosure>
      ) : null}
      {mobile.length > 0 ? (
        <Disclosure
          size="sm"
          textSize="caption"
          tone="muted"
          summary={t("Phones and tablets")}
          count={mobile.length}
        >
          <Rows machines={mobile} busy={busy} onAdd={onAdd} onPair={setPairing} />
        </Disclosure>
      ) : null}
      {pairing ? (
        <AccountPairDialog
          plan={pairing}
          onClose={() => setPairing(null)}
          onPaired={() => {
            setPairing(null);
            onPaired();
          }}
        />
      ) : null}
    </section>
  );
}
