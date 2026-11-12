import { Text } from "../../../shared/ui/Text";
import { useMemo, type ComponentProps } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import type { CrewDefinition } from "../model/crew";
import type { CrewRunView } from "../model/crewClient";
import { crewSavedTeamChanged } from "../model/crewPresentation";
import { crewRunUsage } from "../model/crewUsage";
import { teamTraits } from "../model/memberAvatars";
import { roleLabel } from "./CrewMemberForm";
import { CrewModelTag } from "./CrewModelTag";
import { crewUsageText } from "./CrewWorkTimeline";
import { MemberAvatar } from "./MemberAvatar";

type HostModelCatalog = ComponentProps<typeof CrewModelTag>["catalog"];

/**
 * The team this work started with (an immutable snapshot) as one strip of faces. Name, role,
 * model and spend sit in each face's tooltip; choosing a face addresses that member in the
 * message box. Without a `onPick` the faces only describe.
 */
export function CrewWorkTeam({
  run,
  catalog,
  savedCrew,
  pickedId,
  onPick,
}: {
  run: CrewRunView;
  catalog: HostModelCatalog;
  savedCrew?: CrewDefinition;
  pickedId?: string;
  onPick?: (id: string) => void;
}) {
  useLocale();
  const agents = run.definition.agents;
  const looks = useMemo(() => teamTraits(agents), [agents]);
  const usage = useMemo(() => crewRunUsage(run), [run]);
  return (
    <div className="mt-4 flex min-w-0 flex-col gap-1">
      <Text as="div" className="flex items-baseline gap-2">
        <Text size="inherit" tone="inherit" weight="medium">
          {t("Team")}
        </Text>
        <span className="tabular-nums">{agents.length}</span>
        {crewSavedTeamChanged(run, savedCrew) ? (
          <span>{t("The saved crew has changed since.")}</span>
        ) : null}
      </Text>
      <div role="group" aria-label={t("Team")} className="flex flex-wrap gap-0.5">
        {agents.map((agent) => {
          const spent = usage.perMember[agent.id];
          const role =
            agent.name.trim().toLocaleLowerCase() === roleLabel(agent.role).toLocaleLowerCase()
              ? ""
              : roleLabel(agent.role);
          return (
            <Button
              key={agent.id}
              variant="ghost"
              iconOnly
              motion="none"
              selected={pickedId === agent.id}
              label={role ? `${agent.name} · ${role}` : agent.name}
              tooltipDetails={[
                <CrewModelTag key="model" catalog={catalog} agent={agent} />,
                spent ? crewUsageText(spent) : "",
              ].filter(Boolean)}
              onClick={() => onPick?.(agent.id)}
            >
              <MemberAvatar traits={looks.get(agent.id)!} size={24} />
            </Button>
          );
        })}
      </div>
    </div>
  );
}
