import { useState, type ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { Popover } from "../../../shared/ui/Popover";
import type { AgentModel, ModelSetting } from "../model/models";
import { HARNESS_TITLE, type HarnessId } from "../model/session";
import { ModelAccountControl, ModelAccountList, usePanelAccounts } from "./ModelAccountSwitcher";
import { ModelBrowser, type ModelBrowserProps } from "./ModelBrowser";
import { ModelSettingHelp, ModelSettingsColumn } from "./ModelSettingsColumn";

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
            header={
              <div className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3 pt-1.5 pb-1">
                <span className="shrink-0 text-ui-micro font-medium tracking-wide text-(--ui-text-secondary) uppercase">
                  {title}
                </span>
                {browser.query.trim() ? null : (
                  <ModelAccountControl
                    accounts={shownAccounts}
                    accountId={accountId}
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
                  now={now}
                  onSelect={pickAccount}
                />
              ) : undefined
            }
          />
          {settings ? <ModelSettingsColumn {...settings} onExplain={setExplained} /> : null}
        </div>
      </div>
      {settings ? <ModelSettingHelp setting={explained} /> : null}
    </Popover>
  );
}
