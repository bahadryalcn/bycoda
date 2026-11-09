import {
  AiIdea,
  CheckList,
  Shield,
  UserRound,
  Wrench,
  type IconProps,
} from "../../../shared/ui/icons";
import type { CrewRole } from "../model/crew";

/**
 * Structural responsibility cue for member rows (CR-I01). It names the role in the
 * crew, never the provider or the crew mascot. Decorative: the row text carries
 * the role label, so the glyph never stands alone.
 */
export function CrewRoleIcon({
  role,
  className = "icon-xs shrink-0",
  ...props
}: { role: CrewRole | undefined } & Omit<IconProps, "ref">) {
  const Icon =
    role === "coordinator"
      ? CheckList
      : role === "reviewer"
        ? Shield
        : role === "advisor"
          ? AiIdea
          : role === "specialist"
            ? Wrench
            : UserRound;
  return <Icon aria-hidden="true" className={className} {...props} />;
}
