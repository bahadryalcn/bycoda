import { useRef, type KeyboardEvent } from "react";
import { Button } from "../../../shared/ui/Button";

export type RecoveryTab = {
  value: string;
  label: string;
  count?: number;
  disabled?: boolean;
  /** Why the tab cannot be chosen right now; shown as its tooltip. */
  disabledReason?: string;
};

export const recoveryTabId = (prefix: string, value: string) => `${prefix}-tab-${value}`;
export const recoveryPanelId = (prefix: string, value: string) => `${prefix}-panel-${value}`;

/**
 * Top navigation between recovery kinds. It is a tab strip (not a filter): choosing a tab
 * changes what is being recovered, while each pane's own toolbar filters its list.
 */
export function RecoveryTabs({
  label,
  idPrefix,
  value,
  tabs,
  onChange,
}: {
  label: string;
  idPrefix: string;
  value: string;
  tabs: readonly RecoveryTab[];
  onChange: (value: string) => void;
}) {
  const nodes = useRef(new Map<string, HTMLButtonElement>());
  const enabled = tabs.filter((tab) => !tab.disabled);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = enabled.findIndex((tab) => tab.value === value);
    let next = -1;
    if (event.key === "ArrowRight") next = (current + 1) % enabled.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + enabled.length) % enabled.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = enabled.length - 1;
    if (next < 0 || !enabled[next]) return;
    event.preventDefault();
    onChange(enabled[next].value);
    nodes.current.get(enabled[next].value)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      className="recovery-tabs"
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <Button
            key={tab.value}
            ref={(node) => {
              if (node) nodes.current.set(tab.value, node);
              else nodes.current.delete(tab.value);
            }}
            type="button"
            variant="tab"
            size="sm"
            role="tab"
            id={recoveryTabId(idPrefix, tab.value)}
            aria-controls={recoveryPanelId(idPrefix, tab.value)}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            selected={selected}
            disabled={tab.disabled}
            title={tab.disabled ? tab.disabledReason : undefined}
            onClick={() => onChange(tab.value)}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span className="ms-1.5 tabular-nums text-(--ui-text-secondary)">{tab.count}</span>
            ) : null}
          </Button>
        );
      })}
    </div>
  );
}
