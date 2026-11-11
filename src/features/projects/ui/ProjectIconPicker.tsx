import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { Select } from "../../../shared/ui/Select";
import { Button } from "../../../shared/ui/Button";
import { LiveText } from "../../../shared/ui/LiveText";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { t, useLocale } from "../../../shared/i18n";
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
  useLocale();
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
          <p className="text-ui-micro text-(--ui-text-secondary)">{t("Project icon")}</p>
          <OverflowTooltip label={selected.label}>
            <p className="truncate text-ui-caption text-[var(--color-content)]">{selected.label}</p>
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
      <div
        className="max-h-44 overflow-y-auto overscroll-contain"
        role="group"
        aria-label={t("Project icons")}
      >
        <div className="grid grid-cols-5 gap-1">
          {icons.map((icon) => (
            <Button
              variant="item"
              motion="none"
              layout="stacked"
              key={icon.name}
              type="button"
              tooltip={`${icon.label} · ${icon.category}`}
              aria-label={t("Project icon: {p0}", { p0: icon.label })}
              aria-pressed={selected.name === icon.name}
              onClick={() => onPick(icon.name)}
              className="flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 px-0.5"
            >
              <ProjectMascot project={project} name={icon.name} className="size-6 shrink-0" />
              <span className="max-w-full truncate text-ui-micro text-(--ui-text-secondary)">
                {icon.label.split(" / ")[0]}
              </span>
            </Button>
          ))}
        </div>
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
