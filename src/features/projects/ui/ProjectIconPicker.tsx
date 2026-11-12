import { Text } from "../../../shared/ui/Text";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { Select } from "../../../shared/ui/Select";
import { Button } from "../../../shared/ui/Button";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { LiveText } from "../../../shared/ui/LiveText";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { useT } from "../../../shared/i18n";
import { useState } from "react";
import { PROJECT_ICON_CATEGORIES, type ProjectIconCategory } from "../model/projectCodeIcons";
import { filterProjectMascots, projectMascot } from "../model/projectMascots";
import { ProjectMascot } from "./ProjectMascot";

export function ProjectIconPicker({
  project,
  name,
  color,
  onPick,
}: {
  project: string;
  name: string | null;
  color?: string;
  onPick: (name: string | null) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ProjectIconCategory | "All">("All");
  const selected = projectMascot(project, name);
  const icons = filterProjectMascots(query, category);
  return (
    <div className="flex flex-col gap-2 px-0.5" data-project-icon-picker>
      <div className="flex items-center gap-2">
        <ProjectMascot
          project={project}
          name={selected.name}
          color={color}
          className="size-6 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <Text as="p" size="micro" tone="secondary">
            {t("Project icon")}
          </Text>
          <OverflowTooltip label={selected.label}>
            <Text truncate as="p" size="caption" tone="primary">
              {selected.label}
            </Text>
          </OverflowTooltip>
        </div>
        <Button
          variant="ghost"
          motion="none"
          type="button"
          aria-label={t("Use automatic project icon")}
          aria-pressed={name === null}
          onClick={() => onPick(null)}
        >
          {t("Auto")}
        </Button>
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <SearchInput
          standalone
          appearance="field"
          type="search"
          aria-label={t("Search project icons")}
          placeholder={t("Search icons…")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          containerClassName="min-w-0 flex-1"
        />
        <Select
          hideLabel
          label={t("Project icon category")}
          value={category}
          onValueChange={(next) => setCategory(next as ProjectIconCategory | "All")}
          className="w-24 shrink-0"
          options={[
            { value: "All", label: t("All types") },
            ...PROJECT_ICON_CATEGORIES.map((group) => ({ value: group, label: group })),
          ]}
        />
      </div>
      <div className="max-h-44 overflow-y-auto overscroll-contain">
        <RadioGroup
          variant="tiles"
          label={t("Project icons")}
          value={selected.name}
          onValueChange={onPick}
          tile={{ motion: "none", layout: "stacked" }}
          className="grid grid-cols-5 gap-1"
          options={icons.map((icon) => ({
            value: icon.name,
            tooltip: `${icon.label} · ${icon.category}`,
            ariaLabel: t("Project icon: {p0}", { p0: icon.label }),
            content: (
              <>
                <ProjectMascot project={project} name={icon.name} className="size-6 shrink-0" />
                <Text truncate size="micro" tone="secondary" className="max-w-full">
                  {icon.label.split(" / ")[0]}
                </Text>
              </>
            ),
          }))}
        />
        {icons.length === 0 ? (
          <EmptyState
            size="inline"
            kind="filtered"
            className="justify-center py-5"
            description={t("No matching icons")}
          />
        ) : null}
      </div>
      <p className="sr-only">
        <LiveText
          text={`${icons.length}${t(" icons · ")}${category === "All" ? t("All types") : category}`}
        />
      </p>
    </div>
  );
}
