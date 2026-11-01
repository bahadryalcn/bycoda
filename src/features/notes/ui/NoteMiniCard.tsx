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

  // Same identity as the session notes panel: file mark, title, project.
  const inner = (
    <div data-note-card className="note-mini-card flex items-start gap-2 rounded-(--ui-radius-card) border border-(--ui-editor-border) bg-(--ui-surface) px-2.5 py-2">
      <File className="icon-sm mt-0.5 shrink-0 text-(--ui-text-secondary)" strokeWidth={1.75} />
      <div className="flex min-w-0 flex-1 flex-col text-left">
        <span className="line-clamp-1 text-ui-secondary font-medium leading-snug text-content">
          {card.title || t("Untitled")}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-ui-micro text-(--ui-text-secondary)">
          <span className="shrink-0">{t("Note")}</span>
          {!embedded && card.slug ? <span className="min-w-0 truncate">· {card.slug}</span> : null}
          {!embedded && project ? (
            <span className="flex min-w-0 items-center gap-1.5">
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
        </span>
      </div>
      {onDismiss ? (
        <Button
          variant="ghost"
          size="sm"
          type="button"
          tooltip={t("Remove")}
          aria-label={t("Remove note {p0}", { p0: card.title || "Untitled" })}
          onClick={onDismiss}
          iconOnly
          label={t("Remove note {p0}", { p0: card.title || "Untitled" })}
          className="-my-0.5 -me-1 shrink-0"
        >
          <X className="icon-sm" strokeWidth={2} />
        </Button>
      ) : null}
    </div>
  );

  if (embedded) return inner;
  return <div className="px-3 pt-2">{inner}</div>;
}
