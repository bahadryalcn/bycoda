import { Text } from "../../../shared/ui/Text";
import { t, useLocale } from "../../../shared/i18n";
import type { CrewDefinition } from "../model/crew";
import type { CrewRunView } from "../model/crewClient";
import { crewSavedTeamChanged } from "../model/crewPresentation";
import { CrewFaces } from "./CrewFaces";

const TEAM_FACES = 6;

/**
 * The team this work started with (an immutable snapshot) as one strip of faces. Names, roles
 * and models are told by the sessions and the message recipient list; the strip only says who
 * was on the team and when the saved crew has changed since.
 */
export function CrewWorkTeam({ run, savedCrew }: { run: CrewRunView; savedCrew?: CrewDefinition }) {
  useLocale();
  const agents = run.definition.agents;
  return (
    <Text as="div" className="mt-4 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <Text size="inherit" tone="inherit" weight="medium">
        {t("Team")}
      </Text>
      <CrewFaces members={agents} max={TEAM_FACES} />
      {crewSavedTeamChanged(run, savedCrew) ? (
        <span>{t("The saved crew has changed since.")}</span>
      ) : null}
    </Text>
  );
}
