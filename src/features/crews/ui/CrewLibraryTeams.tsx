import { Text } from "../../../shared/ui/Text";
import { useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import type { DropdownMenuAction } from "../../../shared/ui/dropdownMenuModel";
import { ChevronDown } from "../../../shared/ui/icons";
import type { CrewDefinition, SavedCrewAgent } from "../model/crew";
import { planAdd, planRemove } from "../model/crewAssignment";
import { CrewAvatar } from "./CrewAvatar";
import type { CrewAssignment } from "./useCrewAssignment";

const SHOWN_TEAMS = 2;

/** The teams a library member is in: small crew icons with names, `+N` for the rest. */
export function CrewMemberTeams({ teams }: { teams: readonly CrewDefinition[] }) {
  useLocale();
  if (!teams.length) return <Text weight="regular">{t("Not in a team")}</Text>;
  const hidden = teams.slice(SHOWN_TEAMS);
  return (
    <Text
      weight="regular"
      className="flex min-w-0 items-center gap-2"
      aria-label={t("Teams")}
      role="group"
    >
      {teams.slice(0, SHOWN_TEAMS).map((team) => (
        <span key={team.id} className="flex min-w-0 items-center gap-1">
          <CrewAvatar crew={team} className="icon-sm shrink-0" />
          <Text size="inherit" tone="inherit" truncate className="min-w-0">
            {team.name}
          </Text>
        </span>
      ))}
      {hidden.length ? (
        <span className="shrink-0" title={hidden.map((team) => team.name).join(", ")}>
          {t("+{p0}", { p0: hidden.length })}
        </span>
      ) : null}
    </Text>
  );
}

function teamItem(
  prefix: "add" | "remove",
  team: CrewDefinition,
  reason: string | undefined,
): DropdownMenuAction {
  return {
    kind: "item",
    id: `${prefix}:${team.id}`,
    label: team.name,
    icon: <CrewAvatar crew={team} className="icon-sm" />,
    disabled: !!reason,
    description: reason,
  };
}

/** Add to / remove from team menu for one library member, with its own pending and error state. */
export function CrewMemberTeamMenu({
  agent,
  definitions,
  memberTeamIds,
  assignment,
}: {
  agent: SavedCrewAgent;
  definitions: readonly CrewDefinition[];
  memberTeamIds: readonly string[];
  assignment: CrewAssignment;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  if (!definitions.length) return null;
  const addable = definitions.filter((team) => !memberTeamIds.includes(team.id));
  const removable = definitions.filter((team) => memberTeamIds.includes(team.id));
  const reason = (plan: ReturnType<typeof planAdd>) => (plan.ok ? undefined : plan.reason);
  return (
    <>
      <Button
        ref={trigger}
        variant="ghost"
        endIcon={<ChevronDown className="icon-sm" />}
        aria-label={t("Teams of {p0}", { p0: agent.name })}
        aria-haspopup="menu"
        aria-expanded={open}
        loading={assignment.busy === agent.id}
        disabled={assignment.busy !== null}
        onClick={() => {
          assignment.clearError(agent.id);
          setOpen(true);
        }}
      >
        {t("Teams")}
      </Button>
      {open ? (
        <DropdownMenu
          anchor={trigger}
          label={t("Teams of {p0}", { p0: agent.name })}
          width={260}
          items={[
            {
              kind: "group",
              id: "add",
              label: t("Add to team"),
              items: addable.map((team) => teamItem("add", team, reason(planAdd(team, agent)))),
            },
            {
              kind: "group",
              id: "remove",
              label: t("Remove from team"),
              items: removable.map((team) =>
                teamItem("remove", team, reason(planRemove(team, agent))),
              ),
            },
          ]}
          onPick={(id) => {
            const [kind, teamId] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
            if (kind === "add") void assignment.add(agent, teamId);
            else void assignment.remove(agent, teamId);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/** A failed or refused team change for one row. */
export function CrewMemberTeamError({
  assignment,
  id,
}: {
  assignment: CrewAssignment;
  id: string;
}) {
  const message = assignment.errors[id];
  return message ? (
    <Alert tone="danger" className="mt-1">
      <span className="break-words [overflow-wrap:anywhere]">{message}</span>
    </Alert>
  ) : null;
}

/** Bulk "Add to team…": one save per chosen team, with every skipped member and why. */
export function CrewBulkTeamAdd({
  selected,
  definitions,
  assignment,
}: {
  selected: readonly SavedCrewAgent[];
  definitions: readonly CrewDefinition[];
  assignment: CrewAssignment;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{
    team: string;
    added: string[];
    skipped: { name: string; reason: string }[];
  } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const failure = assignment.errors.bulk;
  return (
    <>
      <Button
        ref={trigger}
        variant="ghost"
        endIcon={<ChevronDown className="icon-sm" />}
        aria-haspopup="menu"
        aria-expanded={open}
        loading={assignment.busy === "bulk"}
        disabled={assignment.busy !== null || !selected.length || !definitions.length}
        onClick={() => {
          setResult(null);
          assignment.clearError("bulk");
          setOpen(true);
        }}
      >
        {t("Add to team…")}
      </Button>
      {open ? (
        <DropdownMenu
          anchor={trigger}
          label={t("Add to team")}
          width={260}
          items={definitions.map((team) => teamItem("add", team, undefined))}
          onPick={(id) => {
            const team = definitions.find((item) => `add:${item.id}` === id);
            if (!team) return;
            void assignment.bulkAdd(selected, team.id).then((outcome) => {
              if (outcome)
                setResult({ team: team.name, added: outcome.added, skipped: outcome.skipped });
            });
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
      {failure ? (
        <div className="basis-full">
          <Alert tone="danger">{failure}</Alert>
        </div>
      ) : null}
      {result?.added.length ? (
        <div className="basis-full">
          <Alert tone="success">
            {t("Added {p0} to {p1}", { p0: result.added.join(", "), p1: result.team })}
          </Alert>
        </div>
      ) : null}
      {result?.skipped.length ? (
        <div className="basis-full">
          <Alert tone="warning">
            <p>{t("Skipped {p0}:", { p0: result.skipped.length })}</p>
            <ul className="mt-1 list-disc pl-4">
              {result.skipped.map((skip, index) => (
                <li key={`${index}:${skip.name}`} className="break-words [overflow-wrap:anywhere]">
                  {skip.name}: {skip.reason}
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      ) : null}
    </>
  );
}
