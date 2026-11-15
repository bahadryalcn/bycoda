import { t } from "../../../../shared/i18n";
import { TabStrip } from "../../../../shared/ui/Tabs";
import {
  CalendarDays,
  Briefcase,
  MessageMultiple,
  File,
  Brain,
  Clock,
  PanelTop,
} from "../../../../shared/ui/icons";
import styles from "./RoomTabs.module.css";
import type { View } from "./assistantRoomHelpers";

/** One strip for every Room destination; a view never needs a second tab row. */
export function RoomNavigation({
  view,
  onChange,
  activeJobs,
}: {
  view: View;
  onChange: (view: View) => void;
  activeJobs: number;
}) {
  return (
    <div className={styles.primary}>
      <TabStrip
        label={t("Room sections")}
        value={view}
        onValueChange={onChange}
        controls="assistant-content"
        items={[
          { value: "Today", label: t("Today"), icon: <CalendarDays /> },
          { value: "Jobs", label: t("Jobs"), icon: <Briefcase />, count: activeJobs || null },
          { value: "Sessions", label: t("Sessions"), icon: <PanelTop /> },
          { value: "Conversations", label: t("Conversations"), icon: <MessageMultiple /> },
          { value: "Notes", label: t("Notes"), icon: <File /> },
          { value: "Memory", label: t("Memory"), icon: <Brain /> },
          { value: "History", label: t("History"), icon: <Clock /> },
        ]}
      />
    </div>
  );
}
