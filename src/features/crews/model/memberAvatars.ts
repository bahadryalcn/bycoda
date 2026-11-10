import { DEFAULT_MEMBER_AVATARS } from "./memberAvatarDefaults";
import {
  memberAvatarSeed,
  resolveMemberAvatar,
  resolveTeamAvatars,
  type MemberAvatarChoice,
  type MemberAvatarTraits,
} from "./memberAvatarTraits";

type AvatarMember = { id: string; source?: { id: string }; avatar?: MemberAvatarChoice };

/** One member's look: its saved choice, else the shipped default, else the seeded one. */
export function memberTraits(member: AvatarMember): MemberAvatarTraits {
  const seed = memberAvatarSeed(member);
  return resolveMemberAvatar(seed, member.avatar, DEFAULT_MEMBER_AVATARS[seed]);
}

/** Looks for a whole roster, so members without choices never look the same. */
export function teamTraits(members: readonly AvatarMember[]): Map<string, MemberAvatarTraits> {
  return resolveTeamAvatars(members, DEFAULT_MEMBER_AVATARS);
}
