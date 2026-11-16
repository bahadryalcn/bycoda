import { useState } from "react";
import { Apple, Laptop, Smartphone, Terminal } from "../../../shared/ui/icons";
import { useAccount } from "../../account";
import { t, useLocale } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
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
  const sources = [...new Set(machine.sources.map((source) => t(SOURCE_LABEL[source])))];
  if (machine.group === "shared") sources.unshift(t("Shared with you"));
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <MachineIcon machine={machine} />
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <Text truncate weight="medium" tone="primary">
          {machine.name}
        </Text>
        <Text truncate size="caption" tone="muted">
          {sources.join(" · ")}
        </Text>
      </div>
      {machine.online !== undefined ? (
        <Badge variant="dot" size="sm" tone={machine.online ? "success" : "neutral"}>
          {machine.online ? t("Online") : t("Offline")}
        </Badge>
      ) : null}
      <div className="flex shrink-0 items-center gap-1">
        {plan || pair ? null : (
          <InfoPopover label={t("Why Add is unavailable")} width={280}>
            <p>{t("This computer has no SSH address to set it up from here yet.")}</p>
          </InfoPopover>
        )}
        <Button
          stableWidth
          variant="secondary"
          disabled={busy || (!plan && !pair)}
          onClick={() => (plan ? onAdd(plan) : pair && onPair(pair))}
        >
          {t("Add")}
        </Button>
      </div>
    </div>
  );
}

/** Rows shown before Show all; a search always shows every match. */
const COLLAPSED_ROWS = 5;
const GROUP_ORDER = { shared: 1, mobile: 2 } as const;

/** Whether a found machine matches the search: name or any of its addresses. */
function matches(machine: DiscoveredMachine, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [machine.name, ...machine.routes.map((route) => route.address)].some((value) =>
    value?.toLowerCase().includes(needle),
  );
}

/**
 * Machines the desktop found that are not added yet, as one list: the account's computers
 * first, then shared machines and phones. Add starts the SSH setup with the address filled
 * in; a computer only the account knows is added by asking it through the account.
 */
export function DiscoveredMachines({
  saved,
  active,
  busy,
  query = "",
  onAdd,
  onPaired,
}: {
  saved: RemoteMachine[];
  /** The list is visible; it refreshes only then. */
  active: boolean;
  busy: boolean;
  /** The page search; rows filter by name and address. */
  query?: string;
  onAdd: (plan: SshAddPlan) => void;
  /** An account-paired machine was saved; the caller refreshes its machine list. */
  onPaired: () => void;
}) {
  useLocale();
  const [pairing, setPairing] = useState<AccountPairPlan | null>(null);
  const [expanded, setExpanded] = useState(false);
  const { signIn } = useAccount();
  const { machines, loading, signedOut } = useDiscoveredMachines(saved, active);
  const open = machines
    .filter((machine) => !machine.alreadyAdded)
    .map((machine, index) => ({ machine, index }))
    .sort(
      (a, b) =>
        (a.machine.group ? GROUP_ORDER[a.machine.group] : 0) -
          (b.machine.group ? GROUP_ORDER[b.machine.group] : 0) || a.index - b.index,
    )
    .map(({ machine }) => machine);
  const searching = query.trim() !== "";
  const found = open.filter((machine) => matches(machine, query));
  const shown = searching || expanded ? found : found.slice(0, COLLAPSED_ROWS);
  const hidden = found.length - shown.length;
  return (
    <section aria-label={t("Available to add")} className="flex flex-col gap-2">
      <SectionLabel count={found.length || undefined}>{t("Available to add")}</SectionLabel>
      {signedOut ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Text tone="muted">{t("Sign in to also find computers on your account.")}</Text>
          <Button variant="secondary" onClick={() => void signIn().catch(() => undefined)}>
            {t("Sign in")}
          </Button>
        </div>
      ) : null}
      {shown.length > 0 ? (
        <Surface variant="card" padding="none" dividers="card" className="overflow-hidden">
          {shown.map((machine) => (
            <CandidateRow
              key={machine.key}
              machine={machine}
              busy={busy}
              onAdd={onAdd}
              onPair={setPairing}
            />
          ))}
        </Surface>
      ) : null}
      {hidden > 0 ? (
        <Button variant="ghost" className="self-start" onClick={() => setExpanded(true)}>
          {t("Show all ({p0})", { p0: found.length })}
        </Button>
      ) : null}
      {expanded && !searching && found.length > COLLAPSED_ROWS ? (
        <Button variant="ghost" className="self-start" onClick={() => setExpanded(false)}>
          {t("Show less")}
        </Button>
      ) : null}
      {found.length === 0 && loading ? (
        <LoadingText>{t("Looking for machines…")}</LoadingText>
      ) : null}
      {found.length === 0 && !loading && searching ? (
        <EmptyState size="inline" kind="empty" description={t("No matches")} />
      ) : null}
      {found.length === 0 && !loading && !searching && !signedOut ? (
        <EmptyState size="inline" kind="empty" description={t("No new machines found")} />
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
