import {
  BROWSER_VIEWPORT_MAX_HEIGHT,
  BROWSER_VIEWPORT_MAX_WIDTH,
  BROWSER_VIEWPORT_MIN,
  BROWSER_VIEWPORT_PRESETS,
  validBrowserViewportDimension,
} from "../../../shared/lib/browserViewport";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Tab, TabList, TabPanel, Tabs } from "../../../shared/ui/Tabs";
import { toolSettingsTabForAnchor, type ToolSettingsTab } from "../model/toolSettingsSections";
import {
  resetToolPreferences,
  toolPreferences,
  ToolPreferencesResetError,
  browserViewportPresetName,
  validBrowserHome,
  validBrowserSearchTemplate,
} from "../../host-tools/public/toolPreferences";
import type { ToolPreferenceKey } from "../../host-tools/public/toolPreferences";
import { TextField } from "../../../shared/ui/TextField";
import { NumberField } from "../../../shared/ui/NumberField";
import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import { formatNumber, t, useLocale } from "../../../shared/i18n";
import {
  Group,
  Row,
  Select,
  SettingsFeedback,
  Toggle,
  RevealedSetting,
  useSettingsPageReset,
} from "../../../shared/ui/settings";

import { BrowserProfileSettings } from "./BrowserProfileSettings";
import { AgentDevicesRow, DeviceSourcesGroup } from "./DeviceSourcesSettings";
import {
  AGENT_DEVICE_VERSION,
  DEVICE_HUB_VERSION,
} from "../../../shared/model/host-contracts/native-devices";

const ActiveToolSettingsTab = createContext<ToolSettingsTab | null>(null);
const ToolSettingsResetVersion = createContext(0);

/** One navigation destination; only the active topic owns the page reset action. */
export function ToolSettingsPage({ revealRequest = 0 }: { revealRequest?: number }) {
  useLocale();
  const revealed = useContext(RevealedSetting);
  const [tab, setTab] = useState<ToolSettingsTab>(
    () => toolSettingsTabForAnchor(revealed) ?? "browser",
  );
  const [revealInputs, setRevealInputs] = useState({ revealed, revealRequest });
  if (revealInputs.revealed !== revealed || revealInputs.revealRequest !== revealRequest) {
    setRevealInputs({ revealed, revealRequest });
    const next = toolSettingsTabForAnchor(revealed);
    if (next && next !== tab) setTab(next);
  }
  return (
    <ActiveToolSettingsTab.Provider value={tab}>
      <Tabs value={tab} onValueChange={setTab}>
        <TabList label={t("Conversation tools")} scroll="auto">
          <Tab value="browser" className="shrink-0">
            {t("Browser")}
          </Tab>
          <Tab value="devices" className="shrink-0">
            {t("Devices")}
          </Tab>
          <Tab value="logs" className="shrink-0">
            {t("Logs")}
          </Tab>
          <Tab value="devServers" className="shrink-0">
            {t("Development servers")}
          </Tab>
        </TabList>
        <TabPanel value="browser" keepMounted>
          <BrowserProfileSettings />
          <BrowserSettingsPage />
        </TabPanel>
        <TabPanel value="devices" keepMounted>
          <DevicesSettingsPage />
        </TabPanel>
        <TabPanel value="logs" keepMounted>
          <LogsSettingsPage />
        </TabPanel>
        <TabPanel value="devServers" keepMounted>
          <DevServersSettingsPage />
        </TabPanel>
      </Tabs>
    </ActiveToolSettingsTab.Provider>
  );
}

type Preference<T> = {
  defaultValue: T;
  load: () => T;
  save: (value: T) => void;
  subscribe: (change: () => void) => () => void;
};

function useToolPreference<T>(preference: Preference<T>) {
  const [value, setValue] = useStoredPreferenceState(preference.load, preference.subscribe);
  const [failed, setFailed] = useState(false);
  const save = (next: T) => {
    try {
      preference.save(next);
      setFailed(false);
    } catch {
      setFailed(true);
    }
    setValue(preference.load());
  };
  return {
    value,
    save,
    feedback: failed ? (
      <SettingsFeedback state="error">{t("Could not save tool preferences.")}</SettingsFeedback>
    ) : undefined,
  };
}

function DraftPreference<T extends string | number>({
  id,
  label,
  description,
  dependsOn,
  preference,
  parse,
  valid,
  invalidMessage,
  bounds,
}: {
  id: string;
  label: string;
  preference: Preference<T>;
  parse: (draft: string) => T;
  valid: (draft: string) => boolean;
  invalidMessage: string;
  bounds?: { min: number; max: number };
  description?: string;
  dependsOn?: boolean;
}) {
  const [value] = useStoredPreferenceState(preference.load, preference.subscribe);
  const [draft, setDraft] = useState(String(value));
  const [previousValue, setPreviousValue] = useState(value);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resetVersion = useContext(ToolSettingsResetVersion);
  const [previousResetVersion, setPreviousResetVersion] = useState(resetVersion);
  if (previousResetVersion !== resetVersion) {
    setPreviousResetVersion(resetVersion);
    setPreviousValue(value);
    setDraft(String(value));
    setDirty(false);
    setError(null);
  } else if (previousValue !== value) {
    setPreviousValue(value);
    if (!dirty) setDraft(String(value));
  }
  const commit = (text = draft) => {
    if (!valid(text)) {
      setError(invalidMessage);
      return;
    }
    try {
      preference.save(parse(text));
      setDraft(String(preference.load()));
      setDirty(false);
      setError(null);
    } catch {
      setError(t("Could not save tool preferences."));
    }
  };
  const props = {
    label,
    hideLabel: true,
    value: draft,
    error: error ?? undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      setDraft(event.target.value);
      setDirty(true);
      setError(null);
    },
    onBlur: () => {
      if (dirty) commit();
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        commit();
      }
    },
  };
  return (
    <Row
      id={id}
      label={label}
      description={description}
      dependsOn={dependsOn}
      stacked
      modified={value !== preference.defaultValue || dirty}
      onReset={() => commit(String(preference.defaultValue))}
    >
      {bounds ? (
        <NumberField {...props} min={bounds.min} max={bounds.max} step={1} />
      ) : (
        <TextField {...props} maxLength={2048} />
      )}
    </Row>
  );
}

function BooleanPreference({
  id,
  label,
  description,
  preference,
}: {
  id: string;
  label: string;
  description?: string;
  preference: Preference<boolean>;
}) {
  const { value, save, feedback } = useToolPreference(preference);
  return (
    <Row
      id={id}
      label={label}
      description={description}
      descriptionVisible={!!description}
      modified={value !== preference.defaultValue}
      onReset={() => save(preference.defaultValue)}
      feedback={feedback}
    >
      <Toggle label={label} on={value} onChange={save} />
    </Row>
  );
}

function ChoicePreference<T extends string | number>({
  id,
  label,
  preference,
  options,
  description,
}: {
  id: string;
  label: string;
  preference: Preference<T>;
  options: { value: T; label: string }[];
  description?: string;
}) {
  const { value, save, feedback } = useToolPreference(preference);
  return (
    <Row
      id={id}
      label={label}
      description={description}
      modified={value !== preference.defaultValue}
      onReset={() => save(preference.defaultValue)}
      feedback={feedback}
    >
      <Select
        hideLabel
        label={label}
        value={String(value)}
        options={options.map((option) => ({ value: String(option.value), label: option.label }))}
        onChange={(next) => {
          const option = options.find((item) => String(item.value) === next);
          if (option) save(option.value);
        }}
      />
    </Row>
  );
}

function ToolSettingsGroup({
  tab,
  title,
  description,
  keys,
  children,
}: {
  tab: ToolSettingsTab;
  title: string;
  description?: string;
  /** Every preference this topic restores; nothing outside it is touched. */
  keys: readonly ToolPreferenceKey[];
  children: ReactNode;
}) {
  const [failed, setFailed] = useState<"none" | "unchanged" | "partial">("none");
  const activeTab = useContext(ActiveToolSettingsTab);
  const [resetVersion, setResetVersion] = useState(0);
  useSettingsPageReset(
    activeTab === null || activeTab === tab
      ? () => {
          try {
            resetToolPreferences(keys);
            setFailed("none");
            setResetVersion((value) => value + 1);
          } catch (error) {
            // Drafts stay: a failed reset must not discard what the owner typed.
            setFailed(error instanceof ToolPreferencesResetError ? "partial" : "unchanged");
          }
        }
      : null,
  );
  return (
    <Group
      title={title}
      layout="full"
      description={description}
      feedback={
        failed === "none" ? undefined : (
          <SettingsFeedback state="error">
            {failed === "partial"
              ? t("Some settings could not be reset. Retry to finish restoring defaults.")
              : t("Could not save tool preferences.")}
          </SettingsFeedback>
        )
      }
    >
      <ToolSettingsResetVersion.Provider value={resetVersion}>
        {children}
      </ToolSettingsResetVersion.Provider>
    </Group>
  );
}

export function BrowserSettingsPage() {
  useLocale();
  const [viewport] = useStoredPreferenceState(
    toolPreferences.browserViewport.load,
    toolPreferences.browserViewport.subscribe,
  );
  const [searchEngine] = useStoredPreferenceState(
    toolPreferences.browserSearchEngine.load,
    toolPreferences.browserSearchEngine.subscribe,
  );
  const revealed = useContext(RevealedSetting);
  const showDimensions =
    viewport === "custom" ||
    revealed === "browser-viewport-width" ||
    revealed === "browser-viewport-height";
  const showSearchTemplate = searchEngine === "custom" || revealed === "browser-search-template";
  return (
    <ToolSettingsGroup
      tab="browser"
      title={t("Browser")}
      keys={[
        "browserViewport",
        "browserLiveView",
        "browserActualSize",
        "browserViewportWidth",
        "browserViewportHeight",
        "browserHomeUrl",
        "browserSearchEngine",
        "browserSearchTemplate",
      ]}
    >
      <ChoicePreference
        id="browser-viewport"
        label={t("Default viewport")}
        preference={toolPreferences.browserViewport}
        options={[
          ...BROWSER_VIEWPORT_PRESETS.map((preset) => ({
            value: preset.id,
            label: `${browserViewportPresetName(preset)} (${preset.width} × ${preset.height})`,
          })),
          { value: "custom", label: t("Custom") },
        ]}
      />
      <div hidden={!showDimensions}>
        <DraftPreference
          id="browser-viewport-width"
          label={t("Width")}
          dependsOn={viewport === "custom"}
          preference={toolPreferences.browserViewportWidth}
          parse={Number}
          valid={(draft) =>
            validBrowserViewportDimension(Number(draft), BROWSER_VIEWPORT_MAX_WIDTH)
          }
          invalidMessage={t("Viewport dimensions must fit the supported limits.")}
          bounds={{ min: BROWSER_VIEWPORT_MIN, max: BROWSER_VIEWPORT_MAX_WIDTH }}
        />
        <DraftPreference
          id="browser-viewport-height"
          label={t("Height")}
          dependsOn={viewport === "custom"}
          preference={toolPreferences.browserViewportHeight}
          parse={Number}
          valid={(draft) =>
            validBrowserViewportDimension(Number(draft), BROWSER_VIEWPORT_MAX_HEIGHT)
          }
          invalidMessage={t("Viewport dimensions must fit the supported limits.")}
          bounds={{ min: BROWSER_VIEWPORT_MIN, max: BROWSER_VIEWPORT_MAX_HEIGHT }}
        />
      </div>
      <DraftPreference
        id="browser-home-url"
        label={t("Initial address")}
        preference={toolPreferences.browserHomeUrl}
        parse={(draft) => draft}
        valid={validBrowserHome}
        invalidMessage={t("Enter an HTTP or HTTPS address without credentials.")}
      />
      <ChoicePreference
        id="browser-search-engine"
        label={t("Search engine")}
        description={t("Search terms use this engine when you open them from the address bar.")}
        preference={toolPreferences.browserSearchEngine}
        options={[
          { value: "disabled", label: t("Disabled") },
          { value: "duckduckgo", label: "DuckDuckGo" },
          { value: "google", label: "Google" },
          { value: "bing", label: "Bing" },
          { value: "custom", label: t("Custom") },
        ]}
      />
      <div hidden={!showSearchTemplate}>
        <DraftPreference
          id="browser-search-template"
          label={t("Search URL template")}
          description={t("{p0} is replaced with your encoded search terms.", { p0: "{query}" })}
          dependsOn={searchEngine === "custom"}
          preference={toolPreferences.browserSearchTemplate}
          parse={(draft) => draft}
          valid={validBrowserSearchTemplate}
          invalidMessage={t(
            "Enter an HTTP or HTTPS URL with exactly one {p0} placeholder and no credentials.",
            { p0: "{query}" },
          )}
        />
      </div>
      <BooleanPreference
        id="browser-live-view"
        label={t("Live view by default")}
        preference={toolPreferences.browserLiveView}
      />
      <BooleanPreference
        id="browser-actual-size"
        label={t("Actual size by default")}
        preference={toolPreferences.browserActualSize}
      />
    </ToolSettingsGroup>
  );
}

export function DevicesSettingsPage() {
  useLocale();
  return (
    <>
      <ToolSettingsGroup
        tab="devices"
        title={t("Devices")}
        keys={["devicesEnabled", "deviceAutoLive", "devicePreviewScale", "deviceHiddenMachines"]}
      >
        <BooleanPreference
          id="device-enabled"
          label={t("Use devices")}
          description={t("Show simulators and emulators in the Devices panel. Hub: v{p1}", {
            p1: DEVICE_HUB_VERSION,
          })}
          preference={toolPreferences.devicesEnabled}
        />
        <AgentDevicesRow
          description={t(
            "Agents can open and drive devices through this computer's Host. agent-device: v{p1}",
            { p1: AGENT_DEVICE_VERSION },
          )}
        />
        <BooleanPreference
          id="device-auto-live"
          label={t("Live view by default")}
          preference={toolPreferences.deviceAutoLive}
        />
        <ChoicePreference
          id="device-preview-scale"
          label={t("Preview scale")}
          preference={toolPreferences.devicePreviewScale}
          options={([1, 1.5, 2, 3] as const).map((value) => ({
            value,
            label: formatNumber(value, { style: "percent" }),
          }))}
        />
      </ToolSettingsGroup>
      <DeviceSourcesGroup />
    </>
  );
}

export function LogsSettingsPage() {
  useLocale();
  return (
    <ToolSettingsGroup
      tab="logs"
      title={t("Logs")}
      keys={["logsFollow", "logsGrouped", "logsRefreshInterval"]}
    >
      <BooleanPreference
        id="logs-follow"
        label={t("Follow new logs")}
        preference={toolPreferences.logsFollow}
      />
      <BooleanPreference
        id="logs-grouped"
        label={t("Group repeated logs")}
        preference={toolPreferences.logsGrouped}
      />
      <ChoicePreference
        id="logs-refresh-interval"
        label={t("Refresh interval")}
        preference={toolPreferences.logsRefreshInterval}
        options={[
          { value: 1500, label: t("1.5 seconds") },
          { value: 3000, label: t("3 seconds") },
          { value: 5000, label: t("5 seconds") },
        ]}
      />
    </ToolSettingsGroup>
  );
}

export function DevServersSettingsPage() {
  useLocale();
  return (
    <ToolSettingsGroup
      tab="devServers"
      title={t("Development servers")}
      keys={["serversAutoRefresh", "serversRefreshInterval"]}
    >
      <BooleanPreference
        id="servers-auto-refresh"
        label={t("Automatic refresh")}
        preference={toolPreferences.serversAutoRefresh}
      />
      <ChoicePreference
        id="servers-refresh-interval"
        label={t("Refresh interval")}
        preference={toolPreferences.serversRefreshInterval}
        options={[
          { value: 15000, label: t("15 seconds") },
          { value: 30000, label: t("30 seconds") },
          { value: 60000, label: t("1 minute") },
        ]}
      />
    </ToolSettingsGroup>
  );
}

export function BykitSettingsPage() {
  useLocale();
  return (
    <Group title={t("Agent behavior")}>
      <BooleanPreference
        id="bykit-instructions"
        label={t("Tell agents to use bykit")}
        preference={toolPreferences.bykitInstructions}
      />
    </Group>
  );
}
