import { useId, useState } from "react";
import { Apple, Laptop, Smartphone, Terminal } from "../../../shared/ui/icons";
import { useAccount } from "../../account";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { SearchInput } from "../../../shared/ui/SearchInput";
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
import { MACHINE_SEARCH_FROM } from "./machineListSearch";
import { useDiscoveredMachines } from "./useDiscoveredMachines";
import type { RemoteMachine } from "../model/protocol";

const sourceLabel = (source: CandidateSource) =>
  ({
    account: t("Account"),
    tailscale: t("Tailscale"),
    "ssh-config": t("SSH config"),
    "known-hosts": t("Known hosts"),
    servers: t("Servers"),
  })[source];

function MachineIcon({ machine }: { machine: DiscoveredMachine }) {
  if (machine.group === "mobile") return <Smartphone aria-hidden className="icon-md" />;
  if (machine.os === "macos") return <Apple aria-hidden className="icon-md" />;
  if (machine.os === "linux") return <Terminal aria-hidden className="icon-md" />;
  return <Laptop aria-hidden className="icon-md" />;
}

function CandidateRow({
  machine,
  busy,
  showSource,
  onAdd,
  onPair,
}: {
  machine: DiscoveredMachine;
  busy: boolean;
  /** The group label does not already name the source, so the row does. */
  showSource: boolean;
  onAdd: (plan: SshAddPlan) => void;
  onPair: (plan: AccountPairPlan) => void;
}) {
  const plan = sshAddPlan(machine);
  const pair = plan ? null : accountPairPlan(machine);
  const sources = [...new Set(machine.sources.map((source) => sourceLabel(source)))];
  if (machine.group === "shared") sources.unshift(t("Shared with you"));
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <MachineIcon machine={machine} />
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <Text truncate weight="medium" tone="primary">
          {machine.name}
        </Text>
        {showSource ? (
          <Text truncate size="caption" tone="muted">
            {sources.join(" · ")}
          </Text>
        ) : null}
      </div>
      <Button
        stableWidth
        variant="secondary"
        disabled={busy || (!plan && !pair)}
        disabledReason={
          !plan && !pair
            ? machine.sources.includes("account")
              ? t(
                  "Computers connect to each other over HTTPS. On that computer, turn on Let my signed-in devices find this computer under Devices, then choose Create link under Sharing and share Remote access. Or add it by its SSH address.",
                )
              : t("This computer has no SSH address to set it up from here yet.")
            : busy
              ? t("Working…")
              : undefined
        }
        onClick={() => (plan ? onAdd(plan) : pair && onPair(pair))}
      >
        {t("Add")}
      </Button>
    </div>
  );
}

const GROUP_ORDER = { shared: 1, mobile: 2 } as const;

/** Splits rows into sections by shared/phone group, else by their first source, keeping order. */
function groupBySource(machines: DiscoveredMachine[]) {
  const groups = new Map<string, DiscoveredMachine[]>();
  for (const machine of machines) {
    const label =
      machine.group === "shared"
        ? t("Shared with you")
        : machine.group === "mobile"
          ? t("Phones")
          : sourceLabel(machine.sources[0] ?? "account");
    groups.set(label, [...(groups.get(label) ?? []), machine]);
  }
  return [...groups].map(([label, rows]) => ({ label, machines: rows }));
}

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
  const [query, setQuery] = useState("");
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
  const [showUnreachable, setShowUnreachable] = useState(false);
  const unreachableId = useId();
  const searching = query.trim() !== "";
  const found = open.filter((machine) => matches(machine, query));
  // SSH setup needs a connection, so rows that did not answer wait in a closed section.
  const shown = found.filter((machine) => machine.online !== false);
  const unreachable = found.filter((machine) => machine.online === false);
  const unreachableOpen = showUnreachable || (searching && shown.length === 0);
  const showGroupLabels = groupBySource(shown).length > 1 || unreachable.length > 0;
  const row = (machine: DiscoveredMachine, showSource: boolean) => (
    <CandidateRow
      key={machine.key}
      machine={machine}
      busy={busy}
      showSource={showSource}
      onAdd={onAdd}
      onPair={setPairing}
    />
  );
  return (
    <section aria-label={t("Available to add")} className="flex flex-col gap-2">
      {/* Search earns its row only once the list is long enough to scan. */}
      {open.length > MACHINE_SEARCH_FROM || searching ? (
        <SearchInput
          standalone
          appearance="field"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          textSize="secondary"
          placeholder={t("Search by name or address")}
          aria-label={t("Search by name or address")}
        />
      ) : null}
      {signedOut ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Text tone="muted">{t("Sign in to also find computers on your account.")}</Text>
          <Button variant="secondary" onClick={() => void signIn().catch(() => undefined)}>
            {t("Sign in")}
          </Button>
        </div>
      ) : null}
      {shown.length > 0
        ? groupBySource(shown).map(({ label, machines: rows }) => (
            <div key={label} className="flex flex-col gap-1">
              {showGroupLabels ? <SectionLabel count={rows.length}>{label}</SectionLabel> : null}
              <Surface variant="card" padding="none" dividers="card" className="overflow-hidden">
                {rows.map((machine) => row(machine, !showGroupLabels))}
              </Surface>
            </div>
          ))
        : null}
      {shown.length === 0 && loading ? (
        <LoadingText>{t("Looking for machines…")}</LoadingText>
      ) : null}
      {found.length === 0 && !loading && searching ? (
        <EmptyState size="inline" kind="empty" description={t("No matches")} />
      ) : null}
      {shown.length === 0 && !loading && !searching && !signedOut ? (
        <EmptyState
          size="inline"
          kind="empty"
          description={
            unreachable.length > 0 ? t("No reachable computers found") : t("No new machines found")
          }
        />
      ) : null}
      {unreachable.length > 0 ? (
        <div className="flex flex-col gap-1">
          <SectionLabel
            collapsible
            expanded={unreachableOpen}
            onExpandedChange={setShowUnreachable}
            controls={unreachableId}
            count={unreachable.length}
          >
            {t("Not reachable now")}
          </SectionLabel>
          {unreachableOpen ? (
            <Surface
              id={unreachableId}
              variant="card"
              padding="none"
              dividers="card"
              className="overflow-hidden"
            >
              {unreachable.map((machine) => row(machine, true))}
            </Surface>
          ) : null}
        </div>
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
