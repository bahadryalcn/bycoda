import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Settings } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import { Text } from "../../../shared/ui/Text";
import {
  providerAccountLabel,
  providerAccounts,
  subscribeProviderAccounts,
  supportsProviderAccounts,
} from "../../providers/public/providerAccounts";
import { openProviderSettings } from "../../providers/public/providerSettingsLink";
import {
  hasProjectDefaults,
  isModelDefault,
  modelDefault,
  type ModelDefault,
} from "../model/modelDefaultMark";
import { subscribeModels, type AgentModel, type ModelSetting } from "../model/models";
import {
  clearProjectDefault,
  pinProjectDefault,
  subscribeProjectProviders,
} from "../model/projectProviders";
import { HARNESS_TITLE, type HarnessId } from "../model/session";
import { ModelAccountControl, ModelAccountList, usePanelAccounts } from "./ModelAccountSwitcher";
import { ModelBrowser, type ModelBrowserProps, type ModelDefaultMark } from "./ModelBrowser";
import { ModelSettingHelp, ModelSettingsColumn } from "./ModelSettingsColumn";
import { useModelSource } from "./modelSource";

const PANEL_WIDTH = 600;
const PANEL_HEIGHT = 460;

export type ModelPanelSettings = {
  current: AgentModel;
  settings: ModelSetting[];
  values: Record<string, string>;
  locked: (setting: ModelSetting) => boolean;
  onChoose: (setting: ModelSetting, value: string) => void;
};

/**
 * The composer's model panel: providers, models with the provider's account control, and the
 * selected model's options side by side on one frosted surface.
 */
export function ModelPanel({
  anchor,
  side,
  project,
  browser,
  leading,
  accountHarness,
  accountId,
  accountListOpen,
  onAccountListOpen,
  onSelectAccount,
  settings,
  onDismiss,
}: {
  anchor: { current: HTMLButtonElement | null };
  side: "top" | "bottom";
  /** Project whose default the panel marks and lets the owner pin; none without a project. */
  project?: string;
  browser: Omit<ModelBrowserProps, "header" | "leading" | "body" | "footer">;
  /** First list row, e.g. an inherit choice. */
  leading?: ReactNode;
  /** Provider whose accounts the header offers; none on the mixed Favorites tab. */
  accountHarness?: HarnessId;
  accountId: string;
  accountListOpen: boolean;
  onAccountListOpen: (open: boolean) => void;
  onSelectAccount: (accountId: string) => void;
  /** Absent while an inherited choice has no model to configure. */
  settings?: ModelPanelSettings;
  onDismiss: (reason: "outside" | "escape") => void;
}) {
  const t = useT();
  const [explained, setExplained] = useState<ModelSetting | null>(null);
  const { accounts, now } = usePanelAccounts(
    accountHarness ?? browser.harnesses[0],
    !!accountHarness,
  );
  const shownAccounts = accountHarness ? accounts : [];
  const listOpen = accountListOpen && shownAccounts.length > 2;
  const title = browser.query.trim()
    ? t("Results")
    : browser.tab === "favorites"
      ? t("Favorites")
      : HARNESS_TITLE[browser.tab];

  const defaultMark = useDefaultMark(
    project,
    browser.tab,
    accountHarness && shownAccounts.length > 1 ? accountId : undefined,
  );
  const defaultAccountId =
    defaultMark && defaultMark.value.harness === accountHarness
      ? defaultMark.value.accountId
      : undefined;

  const pickAccount = (id: string) => {
    onAccountListOpen(false);
    onSelectAccount(id);
  };

  return (
    <Popover
      anchor={anchor}
      side={side}
      width={PANEL_WIDTH}
      maxHeight={PANEL_HEIGHT}
      frosted
      dismissOnEscape={false}
      onDismiss={onDismiss}
      role="dialog"
      aria-label={t("Model and settings")}
      data-model-picker
      data-model-panel
      style={{ height: PANEL_HEIGHT }}
      className="flex min-h-0 flex-col overflow-hidden font-sans"
    >
      {/* Narrow panels stack the settings under the list instead of squeezing the list. */}
      <div className="@container/model-panel flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 @max-[32rem]/model-panel:flex-col">
          <ModelBrowser
            {...browser}
            defaultMark={defaultMark?.mark}
            header={
              <div className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3 pt-1.5 pb-1">
                <Text
                  as="span"
                  size="micro"
                  weight="medium"
                  tone="secondary"
                  tracking="wide"
                  className="shrink-0 uppercase"
                >
                  {title}
                </Text>
                {browser.query.trim() ? null : (
                  <ModelAccountControl
                    accounts={shownAccounts}
                    accountId={accountId}
                    defaultAccountId={defaultAccountId}
                    listOpen={listOpen}
                    onSelect={pickAccount}
                    onToggleList={() => onAccountListOpen(!listOpen)}
                  />
                )}
              </div>
            }
            leading={leading}
            body={
              listOpen ? (
                <ModelAccountList
                  accounts={shownAccounts}
                  accountId={accountId}
                  defaultAccountId={defaultAccountId}
                  now={now}
                  onSelect={pickAccount}
                />
              ) : undefined
            }
          />
          {settings ? <ModelSettingsColumn {...settings} onExplain={setExplained} /> : null}
        </div>
      </div>
      {settings ? (
        <ModelSettingHelp
          setting={explained}
          trailing={
            <Button
              iconOnly
              variant="ghost"
              size="sm"
              type="button"
              label={t("Provider settings")}
              data-model-provider-settings
              className="-my-1 -mr-1.5 shrink-0"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onDismiss("outside");
                openProviderSettings();
              }}
            >
              <Settings className="icon-sm" strokeWidth={1.75} />
            </Button>
          }
        />
      ) : null}
    </Popover>
  );
}

function subscribeDefaultMark(onChange: () => void): () => void {
  const unsubscribe = [subscribeModels, subscribeProjectProviders, subscribeProviderAccounts].map(
    (subscribe) => subscribe(onChange),
  );
  return () => unsubscribe.forEach((off) => off());
}

/** The project's default and its account label, read from browser storage as one comparable string. */
function readDefaultMark(project: string | undefined, local: boolean): string {
  if (!hasProjectDefaults(project)) return "";
  const value = modelDefault(project, !local);
  const { harness, accountId } = value;
  // The account joins the path only when the provider has more than one to choose from.
  const accountName =
    local && accountId && supportsProviderAccounts(harness) && providerAccounts(harness).length > 1
      ? providerAccountLabel(harness, accountId)
      : undefined;
  return JSON.stringify({ value, accountName });
}

/**
 * The project's default as rail, account and row marks. `accountId` is the account the browsed
 * provider's rows run on, when the panel offers a choice of accounts.
 */
function useDefaultMark(
  project: string | undefined,
  tab: ModelBrowserProps["tab"],
  accountId: string | undefined,
): { value: ModelDefault; mark: ModelDefaultMark } | undefined {
  const source = useModelSource();
  const local = source.accounts === undefined;
  const snapshot = useSyncExternalStore(
    subscribeDefaultMark,
    () => readDefaultMark(project, local),
    () => readDefaultMark(project, local),
  );
  if (!hasProjectDefaults(project) || !snapshot) return undefined;
  const { value, accountName } = JSON.parse(snapshot) as {
    value: ModelDefault;
    accountName?: string;
  };
  const { harness } = value;
  const path = [HARNESS_TITLE[harness], accountName, source.resolve(harness, value.model).name]
    .filter(Boolean)
    .join(" › ");
  const onPin = (item: AgentModel) => {
    const viewed = tab === item.harness ? accountId : undefined;
    if (value.pinned && isModelDefault(value, item.harness, item.id, viewed)) {
      clearProjectDefault(project);
      return;
    }
    pinProjectDefault(project, item.harness, item.id, local ? viewed : undefined);
  };
  return {
    value,
    mark: {
      harness,
      pinned: value.pinned,
      path,
      isDefault: (item) =>
        isModelDefault(value, item.harness, item.id, tab === item.harness ? accountId : undefined),
      onPin,
    },
  };
}
