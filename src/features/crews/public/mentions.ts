/** Public crews contract for chat mentions; exports stay explicit to preserve load isolation. */
export { HOST_CREWS } from "../model/crew";
export type { CrewDefinition, CrewRole, SavedCrewAgent } from "../model/crew";
export { CREW_HANDLE_PATTERN } from "../model/crewIdentity";
export { memberTraits } from "../model/memberAvatars";
export { CrewFaces } from "../ui/CrewFaces";
export { MemberAvatar } from "../ui/MemberAvatar";
