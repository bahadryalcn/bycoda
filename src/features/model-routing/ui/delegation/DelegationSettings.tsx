import { useRef, useState } from "react";
import { useT } from "../../../../shared/i18n";
import { HARNESS_TITLE } from "../../../../shared/model/harnessIdentity";
import { Button } from "../../../../shared/ui/Button";
import { DropdownMenu } from "../../../../shared/ui/DropdownMenu";
import { Plus, X } from "../../../../shared/ui/icons";
import { Group } from "../../../../shared/ui/settings";
import { Text } from "../../../../shared/ui/Text";
import { providerAccounts, supportsProviderAccounts } from "../../../providers/public/providerAccounts";
import {
  inheritedValues,
  layerId,
  overrideTargets,
  readLayer,
  sameLayer,
  setLayerKey,
  storedOverrides,
  withDelegation,
  writeLayer,
  type DelegationLayer,
} from "../../model/delegationDraft";
import type { OrderDraft } from "../../model/modelRoutingDraft";
import { DelegationLayerRows } from "./DelegationLayerRows";

/** Without a provider, the global layer lists every provider's accounts, so any provider works. */
const GLOBAL_HARNESS = "codex";

/**
 * Subagents, advisor, subagent max effort and image models for background work: the global
 * defaults, then per-provider and per-account overrides that show only the keys they set.
 * Edits the draft's `routing.delegation`; saving stays with the page.
 */
export function DelegationSettings({
  draft,
  disabled = false,
  onChange,
}: {
  draft: OrderDraft;
  disabled?: boolean;
  onChange: (draft: OrderDraft) => void;
}) {
  const t = useT();
  const delegation = draft.routing.delegation;
  // An override without keys is not stored, so a freshly added one lives here until it has a key.
  const [pending, setPending] = useState<DelegationLayer[]>([]);
  const stored = storedOverrides(delegation);
  const layers = [...stored, ...pending.filter((layer) => !stored.some((s) => sameLayer(s, layer)))];
  const free = overrideTargets(draft.routing.entries).filter(
    (target) => !layers.some((layer) => sameLayer(layer, target)),
  );
  const update = (next: typeof delegation) => onChange(withDelegation(draft, next));
  return (
    <>
      <Group title={t("Defaults")} layout="full">
        <DelegationLayerRows
          harness={GLOBAL_HARNESS}
          values={delegation.global}
          inherited={{}}
          override={false}
          disabled={disabled}
          onSet={(key, value) => update(setLayerKey(delegation, { kind: "global" }, key, value))}
        />
      </Group>
      <Group
        title={t("Overrides")}
        layout="full"
        action={
          <AddOverrideMenu
            targets={free}
            disabled={disabled}
            onPick={(layer) => setPending((current) => [...current, layer])}
          />
        }
      >
        {layers.map((layer) => (
          <div key={layerId(layer)}>
            <div className="flex min-h-8 items-center justify-between gap-2">
              <Text size="caption" weight="medium" truncate className="min-w-0">
                {layerLabel(layer)}
              </Text>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                type="button"
                label={t("Remove override")}
                tooltip={t("Remove override")}
                disabled={disabled}
                onClick={() => {
                  setPending((current) => current.filter((item) => !sameLayer(item, layer)));
                  update(writeLayer(delegation, layer, {}));
                }}
              >
                <X className="icon-xs" />
              </Button>
            </div>
            <DelegationLayerRows
              harness={layer.kind === "global" ? GLOBAL_HARNESS : layer.harness}
              values={readLayer(delegation, layer)}
              inherited={inheritedValues(delegation, layer)}
              override
              disabled={disabled}
              onSet={(key, value) => update(setLayerKey(delegation, layer, key, value))}
            />
          </div>
        ))}
      </Group>
    </>
  );
}

/** "Claude" for a provider override, "Claude · Work" for an account override. */
function layerLabel(layer: DelegationLayer): string {
  if (layer.kind === "global") return "";
  const provider = HARNESS_TITLE[layer.harness];
  if (layer.kind === "provider") return provider;
  const account = (supportsProviderAccounts(layer.harness) ? providerAccounts(layer.harness) : []).find((item) => item.id === layer.accountId);
  return `${provider} · ${account?.label || layer.accountId}`;
}

function AddOverrideMenu({
  targets,
  disabled,
  onPick,
}: {
  targets: readonly DelegationLayer[];
  disabled: boolean;
  onPick: (layer: DelegationLayer) => void;
}) {
  const t = useT();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (targets.length === 0) return null;
  return (
    <>
      <Button
        ref={anchor}
        variant="ghost"
        size="sm"
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        expanded={open}
        onClick={() => setOpen((next) => !next)}
      >
        <Plus className="icon-xs" />
        {t("Add override")}
      </Button>
      {open ? (
        <DropdownMenu
          anchor={anchor}
          label={t("Add override")}
          items={targets.map((target) => ({
            kind: "item" as const,
            id: layerId(target),
            label: layerLabel(target),
          }))}
          onPick={(id) => {
            const target = targets.find((item) => layerId(item) === id);
            if (target) onPick(target);
          }}
          onClose={() => setOpen(false)}
          returnFocusRef={anchor}
          side="bottom"
          align="end"
          width="content"
        />
      ) : null}
    </>
  );
}
