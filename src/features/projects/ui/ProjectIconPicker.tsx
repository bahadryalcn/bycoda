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
          <p className="text-[11px] text-content/50">{t("Project icon")}</p>
          <p className="truncate text-xs text-content/85" title={selected.label}>
            {selected.label}
          </p>
        </div>
        <button
          type="button"
          aria-label={t("Use automatic project icon")}
          aria-pressed={name === null}
          onClick={() => onPick(null)}
          className="rounded px-1.5 py-1 text-[10px] text-content/55 hover:bg-content/8 focus-visible:ring-1 focus-visible:ring-accent"
        >
          {t("Auto")}
        </button>
      </div>
      <div className="mb-2 flex gap-1.5">
        <input
          type="search"
          aria-label={t("Search project icons")}
          placeholder={t("Search icons…")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-content/10 bg-content/5 px-2 py-1.5 text-xs text-content outline-none focus:ring-1 focus:ring-accent/40"
        />
        <select
          aria-label={t("Project icon category")}
          value={category}
          onChange={(event) => setCategory(event.target.value as ProjectIconCategory | "All")}
          className="max-w-28 rounded-md border border-content/10 bg-background-base px-1 py-1 text-[11px] text-content outline-none focus:ring-1 focus:ring-accent/40"
        >
          <option value="All">{t("All types")}</option>
          {PROJECT_ICON_CATEGORIES.map((group) => (
            <option key={group}>{group}</option>
          ))}
        </select>
      </div>
      <div
        className="h-[140px] overflow-y-auto overscroll-contain p-1"
        role="group"
        aria-label={t("Project icons")}
      >
        <div className="grid grid-cols-4 gap-1">
          {icons.map((icon) => (
            <button
              key={icon.name}
              type="button"
              title={`${icon.label} · ${icon.category}`}
              aria-label={t("Project icon: {p0}", { p0: icon.label })}
              aria-pressed={selected.name === icon.name}
              onClick={() => onPick(icon.name)}
              className={`flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${selected.name === icon.name ? "bg-selection-hover ring-1 ring-content/40" : "hover:bg-content/8"}`}
            >
              <ProjectMascot project={project} name={icon.name} className="size-7 shrink-0" />
              <span className="max-w-full truncate text-[10px] text-content/70">
                {icon.label.split(" / ")[0]}
              </span>
            </button>
          ))}
        </div>
        {icons.length === 0 ? (
          <p className="py-5 text-center text-xs text-content/50">{t("No matching icons")}</p>
        ) : null}
      </div>
      <p className="mt-1 text-[10px] text-content/40" aria-live="polite">
        {icons.length}
        {t(" icons · ")}
        {category === "All" ? t("All types") : category}
      </p>
    </div>
  );
}
