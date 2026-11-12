import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { pathKey } from "../../../shared/lib/paths";
import { ScrollArea } from "../../../shared/ui/ScrollArea";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Surface } from "../../../shared/ui/Surface";
import type { SkillEntry } from "../model/skillLibrary";
import { SkillMachineColumns } from "./SkillRow";
import styles from "./SkillsPage.module.css";

type SkillGroup = { scope: "project" | "user" | "builtin"; entries: SkillEntry[] };

/** One scroll owner for every scope; headings remain in the same scrolling flow as rows. */
export function SkillList({
  cwd,
  groups,
  machineNames,
  renderRow,
  loading,
  children,
  groupedContent,
}: {
  cwd: string;
  groups: SkillGroup[];
  machineNames: string[];
  renderRow: (entry: SkillEntry) => ReactNode;
  loading: boolean;
  children?: ReactNode;
  groupedContent?: ReactNode;
}) {
  useLocale();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const [position, setPosition] = useRetainedState(
    `skills:${pathKey(cwd)}:list-scroll`,
    () => ({ top: 0 }),
    "view",
  );
  const scroll = useRef({ top: position.top });
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Retain the DOM scroll position across navigation without rerendering rows on every scroll.
  useEffect(() => {
    const current = scroll.current;
    return () => setPosition({ top: current.top });
  }, [setPosition]);
  return (
    <div className={styles.listPane}>
      <ScrollArea
        className={styles.list}
        gutter="stable"
        aria-label={t("Skills")}
        aria-busy={loading}
        data-skill-list=""
        ref={(element) => {
          lockOverscroll(element);
          if (element) element.scrollTop = scroll.current.top;
        }}
        onScroll={(event) => {
          scroll.current.top = event.currentTarget.scrollTop;
        }}
      >
        {children}
        {machineNames.length && groups.length ? <SkillMachineColumns names={machineNames} /> : null}
        {groupedContent ??
          groups.map((group) => (
            <SkillListGroup key={group.scope} group={group} renderRow={renderRow} />
          ))}
      </ScrollArea>
    </div>
  );
}

function SkillListGroup({
  group,
  renderRow,
}: {
  group: SkillGroup;
  renderRow: (entry: SkillEntry) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const id = useId();
  const label =
    group.scope === "project"
      ? t("Project")
      : group.scope === "user"
        ? t("Personal")
        : t("Managed");
  return (
    <section>
      <Surface
        variant="workspace-panel"
        padding="none"
        frame="none"
        radius="none"
        className={styles.groupHeader}
      >
        <SectionLabel
          collapsible
          expanded={expanded}
          onExpandedChange={setExpanded}
          controls={id}
          count={group.entries.length}
        >
          {label}
        </SectionLabel>
      </Surface>
      <div id={id} hidden={!expanded}>
        {group.entries.map((entry) => (
          <div key={entry.key}>{renderRow(entry)}</div>
        ))}
      </div>
    </section>
  );
}
