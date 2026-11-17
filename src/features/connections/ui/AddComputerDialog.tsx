import { useState, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Modal } from "../../../shared/ui/Modal";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { Tab, TabList, TabPanel, Tabs } from "../../../shared/ui/Tabs";
import type { SshAddPlan } from "../model/machineCandidates";
import type { RemoteMachine } from "../model/protocol";
import { DiscoveredMachines } from "./DiscoveredMachines";

/**
 * Adding a computer in one dialog: computers found on the account, Tailscale, SSH config and
 * known hosts, or an address typed by hand. The saved list on the page stays uncluttered.
 */
export function AddComputerDialog({
  saved,
  busy,
  form,
  onAdd,
  onPaired,
  onClose,
  initialView = "found",
}: {
  saved: RemoteMachine[];
  /** Opens on the typed address when a draft is already there. */
  initialView?: "found" | "manual";
  busy: boolean;
  /** The manual SSH / Host URL form; its drafts live with the page so they survive closing. */
  form: ReactNode;
  onAdd: (plan: SshAddPlan) => void;
  onPaired: () => void;
  onClose: () => void;
}) {
  useLocale();
  const [view, setView] = useState<string>(initialView);
  const [query, setQuery] = useState("");
  return (
    <Modal
      title={t("Add a computer")}
      size="lg"
      fitViewport
      fieldEscape="field"
      closeDisabled={busy}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <Tabs value={view} onValueChange={setView}>
          <TabList label={t("How to add a computer")}>
            <Tab value="found">{t("Found")}</Tab>
            <Tab value="manual">{t("Enter address")}</Tab>
          </TabList>
          <TabPanel value="found" tabIndex={-1} className="connections-view">
            <SearchInput
              standalone
              appearance="field"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              textSize="secondary"
              placeholder={t("Search by name or address")}
              aria-label={t("Search by name or address")}
            />
            <DiscoveredMachines
              saved={saved}
              active
              busy={busy}
              query={query}
              onAdd={onAdd}
              onPaired={onPaired}
            />
          </TabPanel>
          <TabPanel value="manual" tabIndex={-1} className="connections-view">
            {form}
          </TabPanel>
        </Tabs>
      </div>
    </Modal>
  );
}
