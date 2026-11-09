import { useContext, useLayoutEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Tab, TabList, TabPanel, Tabs } from "../../../shared/ui/Tabs";
import { Button } from "../../../shared/ui/Button";
import { RevealedSetting, settingDomId, SettingsFeedback } from "./settingsControls";
import type { AppearanceSettings } from "./useAppearanceSettings";
import { ThemeSection } from "./appearance/sections/ThemeSection";
import { BackgroundSection } from "./appearance/sections/BackgroundSection";
import { InterfaceSection } from "./appearance/sections/InterfaceSection";
import { TypographySection } from "./appearance/sections/TypographySection";
import { MotionSection } from "./appearance/sections/MotionSection";
import { ThemeGenerator } from "./appearance/controls/ThemeGenerator";
import "./AppearanceSettings.css";

export { AccentColorPicker, ACCENT_COLOR_PRESETS } from "./appearance/controls/AccentColorPicker";
export { ChatBackgroundCard } from "./appearance/sections/BackgroundSection";

type Section = "theme" | "background" | "interface" | "typography" | "motion";
let selectedSection: Section = "theme";

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
  // Sticky children below the pinned generator offset by its live height, which changes as it wraps.
  useLayoutEffect(() => {
    const element = generator.current;
    const host = root.current;
    if (!element || !host || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() =>
      host.style.setProperty("--appearance-generator-height", `${element.offsetHeight}px`),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // A hairline marks the generator only while it is pinned: a sentinel above it scrolls out of view
  // beneath the sticky offset exactly then.
  const sentinel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const marker = sentinel.current;
    const element = generator.current;
    if (!marker || !element || typeof IntersectionObserver === "undefined") return;
    const top = Number.parseFloat(getComputedStyle(element).insetBlockStart) || 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        element.toggleAttribute(
          "data-stuck",
          !entry.isIntersecting && entry.boundingClientRect.top < top,
        );
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
  useLayoutEffect(() => {
    if (!revealed) return;
    const target = document.getElementById(settingDomId(revealed));
    const panel =
      target && root.current?.contains(target)
        ? target.closest<HTMLElement>("[data-appearance-section]")
        : null;
    const value = panel?.dataset.appearanceSection as Section | undefined;
    if (value) {
      selectedSection = value;
      setSection(value);
    }
  }, [revealed, revealRequest]);
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
          action={<Button onClick={appearance.retryPreferenceRead}>{t("Retry")}</Button>}
        >
          {t(
            "Appearance preferences are unavailable. Retry reading before replacing saved choices.",
          )}
        </SettingsFeedback>
      ) : null}
      {appearance.preferencesDirty ? (
        <SettingsFeedback
          state="error"
          action={
            <Button onClick={() => appearance.onPreferences(appearance.preferences)}>
              {t("Retry save")}
            </Button>
          }
        >
          {t("Could not save changes. Your previous appearance remains active.")}
        </SettingsFeedback>
      ) : null}
      {/* The tabs lead the page; generation edits every topic, so its toolbar stays pinned with them. */}
      <div ref={sentinel} aria-hidden="true" className="appearance-generator-sentinel" />
      <Tabs value={section} onValueChange={select}>
        <div ref={generator} className="appearance-generator">
          <TabList label={t("Appearance")}>
            {sections.map(({ id, label }) => (
              <Tab key={id} value={id}>
                {label}
              </Tab>
            ))}
          </TabList>
          <ThemeGenerator appearance={appearance} />
        </div>
        {sections.map(({ id, content }) => (
          <TabPanel key={id} value={id} keepMounted data-appearance-section={id}>
            {content}
          </TabPanel>
        ))}
      </Tabs>
    </div>
  );
}
