import { useRef, useState } from "react";
import { useT } from "../../../../shared/i18n";
import { HARNESS_TITLE } from "../../../../shared/model/harnessIdentity";
import { Button } from "../../../../shared/ui/Button";
import { DropdownMenu } from "../../../../shared/ui/DropdownMenu";
import { Plus, X } from "../../../../shared/ui/icons";
import { Group } from "../../../../shared/ui/settings";
import { Text } from "../../../../shared/ui/Text";
import { useModelSource, type ModelSource } from "../../../sessions/public/modelSource";
import { entryProviderAccount } from "../order/useEntryAccount";
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
  const source = useModelSource();
  const delegation = draft.routing.delegation;
  // An override without keys is not stored, so a freshly added one lives here until it has a key.
  const [pending, setPending] = useState<DelegationLayer[]>([]);
  const stored = storedOverrides(delegation);
  const layers = [
    ...stored,
    ...pending.filter((layer) => !stored.some((s) => sameLayer(s, layer))),
  ];
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
            source={source}
            disabled={disabled}
            onPick={(layer) => setPending((current) => [...current, layer])}
          />
        }
      >
        {layers.length === 0 ? (
          <Text as="p" size="secondary" tone="secondary" className="px-4 py-3">
            {t("Every provider and account uses the defaults above.")}
          </Text>
        ) : null}
        {layers.map((layer) => (
          <div key={layerId(layer)} role="group" aria-label={layerLabel(layer, source)}>
            <div className="flex min-h-8 items-center justify-between gap-2">
              <Text size="caption" weight="medium" truncate className="min-w-0">
                {layerLabel(layer, source)}
              </Text>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                type="button"
                label={t("Remove all {p0} overrides", { p0: layerLabel(layer, source) })}
                disabled={disabled}
                onClick={() => {
                  setPending((current) => current.filter((item) => !sameLayer(item, layer)));
                  update(writeLayer(delegation, layer, {}));
                }}
              >
                <X className="icon-sm" aria-hidden />
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
function layerLabel(layer: DelegationLayer, source: ModelSource): string {
  if (layer.kind === "global") return "";
  const provider = HARNESS_TITLE[layer.harness];
  if (layer.kind === "provider") return provider;
  const account = entryProviderAccount(
    {
      harness: layer.harness,
      providerAccountId: layer.accountId,
    },
    source,
  );
  return `${provider} · ${account?.label || layer.accountId}`;
}

function AddOverrideMenu({
  targets,
  source,
  disabled,
  onPick,
}: {
  targets: readonly DelegationLayer[];
  source: ModelSource;
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
        startIcon={<Plus />}
        disabled={disabled}
        aria-haspopup="menu"
        expanded={open}
        onClick={() => setOpen((next) => !next)}
      >
        {t("Add override")}
      </Button>
      {open ? (
        <DropdownMenu
          anchor={anchor}
          label={t("Add override")}
          items={targets.map((target) => ({
            kind: "item" as const,
            id: layerId(target),
            label: layerLabel(target, source),
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
