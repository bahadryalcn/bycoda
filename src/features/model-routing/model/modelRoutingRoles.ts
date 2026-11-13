import {
  MODEL_ROUTING_DELEGATION_KEYS,
  type ModelRoutingChoice,
  type ModelRoutingDraft,
  type ModelRoutingRole,
  type ModelRoutingTarget,
} from "../../../shared/model/host-contracts/model-routing";

export const MODEL_ROLE_GROUPS = [
  "Unattended work",
  "Assistant and voice",
  "Helper models",
] as const;
type RoleMetadata = {
  role: ModelRoutingRole;
  group: (typeof MODEL_ROLE_GROUPS)[number];
  labelKey: string;
  descriptionKey: string;
};

export const MODEL_ROLE_METADATA: readonly RoleMetadata[] = [
  {
    role: "task.worker",
    group: "Unattended work",
    labelKey: "Task worker",
    descriptionKey: "Runs tasks.",
  },
  {
    role: "task.reviewer",
    group: "Unattended work",
    labelKey: "Task reviewer",
    descriptionKey: "Reviews task changes.",
  },
  {
    role: "goal.planner",
    group: "Unattended work",
    labelKey: "Epic planner",
    descriptionKey: "Plans work for an epic.",
  },
  {
    role: "goal.finalReview",
    group: "Unattended work",
    labelKey: "Epic final review",
    descriptionKey: "Reviews a completed epic.",
  },
  {
    role: "steward",
    group: "Unattended work",
    labelKey: "Steward",
    descriptionKey: "Runs project stewardship.",
  },
  {
    role: "automation",
    group: "Unattended work",
    labelKey: "Automation",
    descriptionKey: "Runs scheduled automations.",
  },
  {
    role: "crew.member",
    group: "Unattended work",
    labelKey: "Crew member",
    descriptionKey: "Runs crew members.",
  },
  {
    role: "assistant.worker",
    group: "Assistant and voice",
    labelKey: "Assistant worker",
    descriptionKey: "Carries out assistant work.",
  },
  {
    role: "assistant.planning",
    group: "Assistant and voice",
    labelKey: "Assistant planning",
    descriptionKey: "Plans assistant work.",
  },
  {
    role: "assistant.chief",
    group: "Assistant and voice",
    labelKey: "Assistant chief",
    descriptionKey: "Coordinates assistant work.",
  },
  {
    role: "assistant.reply",
    group: "Assistant and voice",
    labelKey: "Assistant reply",
    descriptionKey: "Writes assistant replies.",
  },
  {
    role: "voice.reply",
    group: "Assistant and voice",
    labelKey: "Voice reply",
    descriptionKey: "Writes voice replies.",
  },
  {
    role: "text.translation",
    group: "Helper models",
    labelKey: "Translation",
    descriptionKey: "Translates text.",
  },
  {
    role: "text.reprompt",
    group: "Helper models",
    labelKey: "Reprompt",
    descriptionKey: "Rewrites prompts.",
  },
  {
    role: "text.title",
    group: "Helper models",
    labelKey: "Title",
    descriptionKey: "Names conversations.",
  },
  {
    role: "text.git",
    group: "Helper models",
    labelKey: "Git text",
    descriptionKey: "Writes Git text.",
  },
  {
    role: "text.skillGrouping",
    group: "Helper models",
    labelKey: "Skill grouping",
    descriptionKey: "Groups skills.",
  },
  {
    role: "text.themeGenerator",
    group: "Helper models",
    labelKey: "Theme generator",
    descriptionKey: "Generates themes.",
  },
];

export function effectiveRoleChoice(
  roles: ModelRoutingDraft["roles"],
  role: ModelRoutingRole,
): ModelRoutingChoice | undefined {
  return roles[role] ?? (role.startsWith("text.") ? undefined : { kind: "order" });
}

export function modelChoicesEqual(
  a: ModelRoutingChoice | undefined,
  b: ModelRoutingChoice | undefined,
  role?: ModelRoutingRole,
): boolean {
  if (role?.startsWith("text.") && (!a || !b)) return a === b;
  const left = a ?? { kind: "order" };
  const right = b ?? { kind: "order" };
  if (left.kind !== right.kind) return false;
  if (left.kind === "pool" && right.kind === "pool") return left.poolId === right.poolId;
  if (left.kind === "fixed" && right.kind === "fixed") {
    const x = left.target;
    const y = right.target;
    return (
      x.harness === y.harness &&
      x.model === y.model &&
      x.providerAccountId === y.providerAccountId &&
      Object.keys(x.modelSettings).length === Object.keys(y.modelSettings).length &&
      Object.entries(x.modelSettings).every(([key, value]) => y.modelSettings[key] === value)
    );
  }
  return true;
}

/** Missing pools revert to the role default (Automatic for helpers); inputs are never mutated. */
export function pruneMissingPoolBindings(
  roles: ModelRoutingDraft["roles"],
  pools: ModelRoutingDraft["pools"],
): ModelRoutingDraft["roles"] {
  const ids = new Set(pools.map((pool) => pool.id));
  return Object.fromEntries(
    Object.entries(roles).filter(([, choice]) => choice.kind !== "pool" || ids.has(choice.poolId)),
  );
}

export function withoutDelegation(target: ModelRoutingTarget): ModelRoutingTarget {
  return {
    ...target,
    modelSettings: Object.fromEntries(
      Object.entries(target.modelSettings).filter(
        ([key]) => !MODEL_ROUTING_DELEGATION_KEYS.some((reserved) => reserved === key),
      ),
    ),
  };
}

/** Keep explicit helper order bindings; omit other order defaults. Sanitize every fixed target. */
export function roleBindingsForSave(roles: ModelRoutingDraft["roles"]): ModelRoutingDraft["roles"] {
  return Object.fromEntries(
    Object.entries(roles).flatMap(([role, choice]) =>
      choice.kind === "order" && !role.startsWith("text.")
        ? []
        : [
            [
              role,
              choice.kind === "fixed"
                ? { ...choice, target: withoutDelegation(choice.target) }
                : choice,
            ],
          ],
    ),
  );
}
