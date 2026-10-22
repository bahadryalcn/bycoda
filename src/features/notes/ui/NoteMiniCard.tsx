import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { File, X } from "../../../shared/ui/icons";
import { useState } from "react";
import { ProjectLogoIcon } from "../../projects/ui/ProjectLogoIcon";
import { ProjectMascot } from "../../projects/ui/ProjectMascot";
import { useTabGroupLogos } from "../../projects/hooks/useTabGroupLogos";
import { noteSourceProject, type NoteCardMeta } from "../notes";
import { projectKey } from "../../../shared/lib/paths";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupLogo,
  resolveTabGroupMascot,
} from "../../workspace/model/tabGroups";

type Props = {
  card: NoteCardMeta;
  onDismiss?: () => void;
  embedded?: boolean;
};

export function NoteMiniCard({ card, onDismiss, embedded = false }: Props) {
  useLocale();
  const logos = useTabGroupLogos();
  const [mascots] = useState(loadTabGroupMascots);
  const [colors] = useState(loadTabGroupColors);
  const [customColors] = useState(loadTabGroupCustomColors);
  const project = noteSourceProject(card.sourceCwd);
  const key = card.sourceCwd ? projectKey(card.sourceCwd) : null;
  const logoPath = key ? resolveTabGroupLogo(key, logos) : null;
  const mascotName = key ? resolveTabGroupMascot(key, mascots) : null;
  const mascotColor =
    key && project ? resolveTabGroupColor(key, colors, customColors, project) : undefined;

  const inner = (
    <div
      style={{ background: "var(--ui-surface)", borderColor: "var(--color-stroke)" }}
      className={`relative rounded-md border px-2.5 py-2 ${onDismiss ? "pr-8" : ""}`}
    >
      <div className="flex w-full flex-col text-left">
        <span className="flex min-w-0 items-center gap-1.5">
          <File className="size-3.5 shrink-0 text-content/45" strokeWidth={1.75} />
          <span className="min-w-0 truncate text-[11px] text-content/50">
            {t("Note")}
            {!embedded && card.slug ? ` · ${card.slug}` : ""}
          </span>
        </span>
        <span className="mt-1 line-clamp-1 text-[13px] font-semibold leading-snug text-content">
          {card.title || t("Untitled")}
        </span>
        {!embedded && project ? (
          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-content/45">
            {logoPath ? (
              <ProjectLogoIcon
                path={logoPath}
                className="size-3.5 shrink-0 rounded-sm"
                imageClassName="size-3.5"
              />
            ) : (
              <ProjectMascot
                project={project}
                color={mascotColor}
                name={mascotName}
                className="size-3 shrink-0"
              />
            )}
            <span className="min-w-0 truncate">{project}</span>
          </span>
        ) : null}
      </div>
      {onDismiss ? (
        <Button
          variant="ghost"
          size="sm"
          type="button"
          title={t("Remove")}
          aria-label={t("Remove note {p0}", { p0: card.title || "Untitled" })}
          onClick={onDismiss}
          iconOnly
          label={t("Remove note {p0}", { p0: card.title || "Untitled" })}
          className="absolute right-1.5 top-1.5"
        >
          <X className="size-3" strokeWidth={2} />
        </Button>
      ) : null}
    </div>
  );

  if (embedded) return inner;
  return <div className="px-3 pt-2">{inner}</div>;
}
