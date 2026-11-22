import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Activity, useContext, useLayoutEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Tab, TabList, TabPanel, Tabs } from "../../../shared/ui/Tabs";
import { RevealedSetting, settingDomId, SettingsFeedback } from "../../../shared/ui/settings";
import type { AppearanceSettings } from "./useAppearanceSettings";
import { ThemeSection } from "./appearance/sections/ThemeSection";
import { BackgroundSection } from "./appearance/sections/BackgroundSection";
import { InterfaceSection } from "./appearance/sections/InterfaceSection";
import { TypographySection } from "./appearance/sections/TypographySection";
import { MotionSection } from "./appearance/sections/MotionSection";
import {
  AppearanceGenerationDialog,
  AppearanceGenerationDock,
  AppearanceGenerationLauncher,
  useAppearanceGenerationPanel,
} from "./appearance/controls/AppearanceGenerationPanel";
import { observeResize } from "../../../shared/lib/observeResize";
import "./AppearanceSettings.css";

export { AccentColorPicker, ACCENT_COLOR_PRESETS } from "./appearance/controls/AccentColorPicker";
export { ChatBackgroundCard } from "./appearance/sections/BackgroundSection";

type Section = "theme" | "background" | "interface" | "typography" | "motion";
let selectedSection: Section = "theme";

/** The appearance tab whose panel holds the revealed setting, once that row is in the DOM. */
function sectionHolding(revealed: string, root: HTMLElement | null): Section | undefined {
  const target = document.getElementById(settingDomId(revealed));
  const panel =
    target && root?.contains(target)
      ? target.closest<HTMLElement>("[data-appearance-section]")
      : null;
  return panel?.dataset.appearanceSection as Section | undefined;
}

export function AppearancePage({
  appearance,
  revealRequest = 0,
}: {
  appearance: AppearanceSettings;
  revealRequest?: number;
}) {
  useLocale();
  const revealed = useContext(RevealedSetting);
  const root = useRef<HTMLDivElement>(null);
  const generator = useRef<HTMLDivElement>(null);
  const generationPanel = useAppearanceGenerationPanel();
  // Keep sticky typography samples below the measured Appearance toolbar.
  useLayoutEffect(() => {
    const element = generator.current;
    const host = root.current;
    if (!element || !host) return;
    return observeResize(element, () =>
      host.style.setProperty("--appearance-generator-height", `${element.offsetHeight}px`),
    );
  }, []);
  // A hairline marks the generator only while it is pinned: a sentinel above it scrolls out of view
  // beneath the sticky offset exactly then.
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useLayoutEffect(() => {
    const marker = sentinel.current;
    const element = generator.current;
    if (!marker || !element || typeof IntersectionObserver === "undefined") return;
    const top = Number.parseFloat(getComputedStyle(element).insetBlockStart) || 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        setStuck(!entry.isIntersecting && entry.boundingClientRect.top < top);
      },
      { rootMargin: `-${Math.ceil(top)}px 0px 0px 0px` },
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, []);
  const [section, setSection] = useState<Section>(selectedSection);
  const select = (value: Section) => {
    selectedSection = value;
    setSection(value);
  };
  // Hidden tabs pre-render at idle priority, so a revealed setting may not be in the DOM yet.
  // Rendering every tab for one pass lets the lookup below find it whichever tab holds it.
  const [renderAll, setRenderAll] = useState(false);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- reads the rendered DOM to show the tab holding the revealed setting
  useLayoutEffect(() => {
    if (!revealed) return;
    const value = sectionHolding(revealed, root.current);
    if (!value) {
      setRenderAll(true);
      return;
    }
    selectedSection = value;
    setSection(value);
  }, [revealed, revealRequest]);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- repeats that DOM lookup after every tab rendered once
  useLayoutEffect(() => {
    if (!renderAll) return;
    const value = revealed ? sectionHolding(revealed, root.current) : undefined;
    if (value) {
      selectedSection = value;
      setSection(value);
    }
    setRenderAll(false);
  }, [renderAll, revealed]);
  const sections = [
    { id: "theme", label: t("Theme"), content: <ThemeSection appearance={appearance} /> },
    {
      id: "background",
      label: t("Background"),
      content: <BackgroundSection appearance={appearance} />,
    },
    {
      id: "interface",
      label: t("Interface"),
      content: <InterfaceSection appearance={appearance} />,
    },
    {
      id: "typography",
      label: t("Typography"),
      content: <TypographySection appearance={appearance} />,
    },
    { id: "motion", label: t("Motion"), content: <MotionSection /> },
  ] as const;
  return (
    <div className="appearance-settings" ref={root}>
      {appearance.preferencesUnavailable ? (
        <SettingsFeedback
          state="warning"
          action={{ label: t("Retry"), onClick: appearance.retryPreferenceRead }}
        >
          {t(
            "Appearance preferences are unavailable. Retry reading before replacing saved choices.",
          )}
        </SettingsFeedback>
      ) : null}
      {appearance.preferencesDirty ? (
        <SettingsFeedback
          state="error"
          action={{
            label: t("Retry save"),
            onClick: () => appearance.onPreferences(appearance.preferences),
          }}
        >
          {t("Could not save changes. Your previous appearance remains active.")}
        </SettingsFeedback>
      ) : null}
      {/* The tabs and generator entry share a compact sticky toolbar. */}
      <div ref={sentinel} aria-hidden="true" className="appearance-generator-sentinel" />
      <Tabs value={section} onValueChange={select}>
        <div
          ref={generator}
          data-stuck={stuck ? "" : undefined}
          {...surfaceAttributes(
            {
              variant: "canvas",
              frame: stuck ? "pane" : "transparent",
              edge: "block-end",
              elevation: "sticky-mask",
            },
            "appearance-generator",
          )}
        >
          <TabList label={t("Appearance")} scroll="auto" scrollbar="hidden" className="appearance-tabs">
            {sections.map(({ id, label }) => (
              <Tab key={id} value={id}>
                {label}
              </Tab>
            ))}
          </TabList>
          <AppearanceGenerationLauncher panel={generationPanel} />
        </div>
        {sections.map(({ id, content }) => (
          <TabPanel key={id} value={id} keepMounted data-appearance-section={id}>
            {/* Hidden tabs keep their DOM for search reveal, but their renders wait and their
                canvases and effects pause, so a change re-renders only the visible tab. */}
            <Activity mode={section === id || renderAll ? "visible" : "hidden"}>{content}</Activity>
          </TabPanel>
        ))}
      </Tabs>
      <AppearanceGenerationDock panel={generationPanel} />
      <AppearanceGenerationDialog panel={generationPanel} appearance={appearance} />
    </div>
  );
}
