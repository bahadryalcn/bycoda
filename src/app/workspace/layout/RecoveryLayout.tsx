import { Tab, TabList, Tabs } from "../../../shared/ui/Tabs";

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
  return (
    <Tabs value={value} onValueChange={onChange} id={idPrefix}>
      <TabList label={label} className="recovery-tabs">
        {tabs.map((tab) => (
          <Tab
            key={tab.value}
            value={tab.value}
            count={tab.count}
            disabled={tab.disabled}
            disabledReason={tab.disabledReason}
          >
            {tab.label}
          </Tab>
        ))}
      </TabList>
    </Tabs>
  );
}
