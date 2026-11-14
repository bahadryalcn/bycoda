import { t } from "../../../../shared/i18n";
import { TabStrip } from "../../../../shared/ui/Tabs";
import {
  CalendarDays,
  Briefcase,
  MessageMultiple,
  FolderOpen,
  File,
  Brain,
  Clock,
  PanelTop,
} from "../../../../shared/ui/icons";
import styles from "./RoomTabs.module.css";
import type { View } from "./assistantRoomHelpers";

/** Keeps existing Room destinations while giving work and records a compact hierarchy. */
export function RoomNavigation({
  view,
  onChange,
  activeJobs,
}: {
  view: View;
  onChange: (view: View) => void;
  activeJobs: number;
}) {
  const records = view === "Notes" || view === "Memory" || view === "History";
  const work = view === "Jobs" || view === "Sessions";
  return (
    <>
      <div className={styles.primary}>
        <TabStrip
          label={t("Room sections")}
          value={records ? "Notes" : work ? "Jobs" : view}
          onValueChange={onChange}
          controls="assistant-content"
          responsive
          items={[
            { value: "Today", label: t("Today"), icon: <CalendarDays /> },
            { value: "Jobs", label: t("Work"), icon: <Briefcase />, count: activeJobs || null },
            { value: "Conversations", label: t("Conversations"), icon: <MessageMultiple /> },
            { value: "Notes", label: t("Records"), icon: <FolderOpen /> },
          ]}
        />
      </div>
      {work && (
        <div className={styles.secondary}>
          <TabStrip
            label={t("Work")}
            value={view}
            onValueChange={onChange}
            controls="assistant-content"
            items={[
              { value: "Jobs", label: t("Jobs"), icon: <Briefcase /> },
              { value: "Sessions", label: t("Sessions"), icon: <PanelTop /> },
            ]}
          />
        </div>
      )}
      {records && (
        <div className={styles.secondary}>
          <TabStrip
            label={t("Records")}
            value={view}
            onValueChange={onChange}
            controls="assistant-content"
            items={[
              { value: "Notes", label: t("Notes"), icon: <File /> },
              { value: "Memory", label: t("Memory"), icon: <Brain /> },
              { value: "History", label: t("What I did"), icon: <Clock /> },
            ]}
          />
        </div>
      )}
    </>
  );
}
