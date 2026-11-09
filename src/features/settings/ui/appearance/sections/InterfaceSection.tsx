import { t, useLocale } from "../../../../../shared/i18n";
import { InterfaceBehaviorGroup } from "../controls/InterfaceBehaviorGroup";
import { InterfaceReadabilityGroup } from "../controls/InterfaceReadabilityGroup";
import { InterfaceSizeGroup } from "../controls/InterfaceSizeGroup";
import { ScrollbarGroup } from "../controls/ScrollbarGroup";
import "../controls/InterfaceSections.css";
import { AppearanceSaveFeedback, type AppearanceSettings } from "../../useAppearanceSettings";

import { AppearanceSection } from "./AppearanceSection";
export function InterfaceSection({ appearance }: { appearance: AppearanceSettings }) {
  useLocale();
  return (
    <AppearanceSection id="reading" title={t("Interface")}>
      <div className="interface-grid">
        <InterfaceSizeGroup appearance={appearance} />
        <div className="interface-column">
          <InterfaceReadabilityGroup appearance={appearance} />
          <InterfaceBehaviorGroup appearance={appearance} />
          <ScrollbarGroup />
        </div>
      </div>
      <AppearanceSaveFeedback settingIds={["ui-scale", "diff-palette", "scrollbar-style"]} />
    </AppearanceSection>
  );
}
