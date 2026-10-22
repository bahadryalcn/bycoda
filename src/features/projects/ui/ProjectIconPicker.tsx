import { NativeSelect } from "../../../shared/ui/Select";
import { Button } from "../../../shared/ui/Button";
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
    <div className="mb-2 px-0.5" data-project-icon-picker>
      <div className="mb-2 flex items-center gap-2">
        <ProjectMascot
          project={project}
          name={selected.name}
          color={color}
          className="size-7 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-(--ui-text-secondary)">{t("Project icon")}</p>
          <p className="truncate text-xs text-[var(--color-content)]" title={selected.label}>
            {selected.label}
          </p>
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
      <div className="mb-2 flex gap-1.5">
        <SearchInput
          standalone
          type="search"
          aria-label={t("Search project icons")}
          placeholder={t("Search icons…")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          containerClassName="min-w-0 flex-1"
        />
        <NativeSelect
          aria-label={t("Project icon category")}
          value={category}
          onChange={(event) => setCategory(event.target.value as ProjectIconCategory | "All")}
          className="max-w-28"
        >
          <option value="All">{t("All types")}</option>
          {PROJECT_ICON_CATEGORIES.map((group) => (
            <option key={group}>{group}</option>
          ))}
        </NativeSelect>
      </div>
      <div
        className="h-[140px] overflow-y-auto overscroll-contain p-1"
        role="group"
        aria-label={t("Project icons")}
      >
        <div className="grid grid-cols-4 gap-1">
          {icons.map((icon) => (
            <Button
              variant="item"
              motion="none"
              layout="stacked"
              key={icon.name}
              type="button"
              title={`${icon.label} · ${icon.category}`}
              aria-label={t("Project icon: {p0}", { p0: icon.label })}
              aria-pressed={selected.name === icon.name}
              onClick={() => onPick(icon.name)}
              className={` flex min-h-16 min-w-0 flex-col items-center justify-center gap-1    `}
            >
              <ProjectMascot project={project} name={icon.name} className="size-7 shrink-0" />
              <span className="max-w-full truncate text-(length:--ui-font-caption) text-(--ui-text-secondary)">
                {icon.label.split(" / ")[0]}
              </span>
            </Button>
          ))}
        </div>
        {icons.length === 0 ? (
          <p className="py-5 text-center text-xs text-(--ui-text-secondary)">
            {t("No matching icons")}
          </p>
        ) : null}
      </div>
      <p
        className="mt-1 text-(length:--ui-font-caption) text-(--ui-text-secondary)"
        aria-live="polite"
      >
        {icons.length}
        {t(" icons · ")}
        {category === "All" ? t("All types") : category}
      </p>
    </div>
  );
}
