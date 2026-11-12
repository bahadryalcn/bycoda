import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { File, X } from "../../../shared/ui/icons";
import { useState } from "react";
import { Surface } from "../../../shared/ui/Surface";
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
    <Surface
      data-note-card
      variant="outline"
      padding="sm"
      className="note-mini-card flex items-start gap-2"
    >
      <File className="icon-sm mt-0.5 shrink-0" tone="secondary" strokeWidth={1.75} />
      <div className="flex min-w-0 flex-1 flex-col text-left">
        <Text size="secondary" tone="primary" weight="medium" leading="snug" truncate>
          {card.title || t("Untitled")}
        </Text>
        <Text size="micro" tone="secondary" className="mt-0.5 flex min-w-0 items-center gap-1.5">
          <span className="shrink-0">{t("Note")}</span>
          {!embedded && card.slug ? (
            <Text size="inherit" tone="inherit" truncate className="min-w-0">
              · {card.slug}
            </Text>
          ) : null}
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
              <Text size="inherit" tone="inherit" truncate className="min-w-0">
                {project}
              </Text>
            </span>
          ) : null}
        </Text>
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
    </Surface>
  );

  if (embedded) return inner;
  return <div className="px-3 pt-2">{inner}</div>;
}
