import { surfaceAttributes } from "../../../shared/ui/Surface";
import type { CSSProperties } from "react";
import { Badge } from "../../../shared/ui/Badge";
import { resolveTeamAvatars } from "../model/memberAvatarTraits";
import { DEFAULT_MEMBER_AVATARS } from "../model/memberAvatarDefaults";
import type { CrewAgent } from "../model/crew";
import { MemberAvatar } from "./MemberAvatar";

/** Faces overlap by this share of their size; the earlier face sits on top. */
const OVERLAP = 0.35;

/** Coordinator first, then reviewer, then the other members in the given order. */
function orderFaces(members: readonly CrewAgent[]): CrewAgent[] {
  const rank = (m: CrewAgent) => (m.role === "coordinator" ? 0 : m.role === "reviewer" ? 1 : 2);
  return members
    .map((member, index) => ({ member, index }))
    .sort((a, b) => rank(a.member) - rank(b.member) || a.index - b.index)
    .map(({ member }) => member);
}

/**
 * A crew as overlapping member faces: up to `max` portraits, the coordinator on top, and a
 * "+N" chip for the rest. The wrapper is one image named by `label`, or by the member names
 * in crew order; the faces and chip are decorative. `activeIds` members blink.
 * @group display
 * @use A compact crew identity in rails, rows and headers.
 * @avoid One member's portrait: MemberAvatar. A plain list of names: BadgeList.
 */
export function CrewFaces({
  members,
  size = 24,
  max = 3,
  activeIds,
  label,
  className,
  reserve = false,
}: {
  members: CrewAgent[];
  size?: number;
  max?: number;
  activeIds?: ReadonlySet<string>;
  label?: string;
  className?: string;
  /** Keeps the width of `max` faces plus the chip, so stacked rows line up their text. */
  reserve?: boolean;
}) {
  const ordered = orderFaces(members);
  const traits = resolveTeamAvatars(ordered, DEFAULT_MEMBER_AVATARS);
  const shown = ordered.slice(0, max);
  const hidden = ordered.length - shown.length;
  const step = size * (1 - OVERLAP);
  const faceStyle = (index: number): CSSProperties => ({
    width: size,
    height: size,
    marginInlineStart: index ? -(size - step) : undefined,
    zIndex: ordered.length - index,
  });
  const name = label ?? ordered.map((member) => member.name).join(", ");
  const wrapperStyle: CSSProperties | undefined = reserve
    ? { minWidth: size + step * max }
    : undefined;

  return (
    <span
      role="img"
      aria-label={name}
      style={wrapperStyle}
      className={["inline-flex shrink-0 items-center", className].filter(Boolean).join(" ")}
    >
      {shown.map((member, index) => {
        const traitsOf = traits.get(member.id);
        if (!traitsOf) return null;
        return (
          <span
            key={member.id}
            aria-hidden
            {...surfaceAttributes(
              { radius: "pill", variant: "raised" },
              "relative grid place-items-center overflow-hidden ring-2 ring-(--ui-surface-panel)",
            )}
            style={faceStyle(index)}
          >
            <MemberAvatar
              traits={traitsOf}
              size={size}
              active={activeIds?.has(member.id)}
              className="block"
            />
          </span>
        );
      })}
      {hidden > 0 ? (
        <Badge
          aria-hidden
          size="xs"
          appearance="subtle"
          className="relative justify-center p-0 whitespace-nowrap ring-2 ring-(--ui-surface-panel)"
          leading="none"
          minWidth={size}
          style={faceStyle(shown.length)}
        >
          {`+${hidden}`}
        </Badge>
      ) : null}
    </span>
  );
}
