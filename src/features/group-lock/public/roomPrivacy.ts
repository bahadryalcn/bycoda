/** Public room-privacy fence: local group writes run inside it. */
export {
  getRoomPrivacyStatus,
  settleHeldRoomPrivacyProjection,
  withRoomPrivacyMutation,
} from "../model/roomPrivacyProjection";
