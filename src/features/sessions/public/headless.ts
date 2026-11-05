/** Session contracts consumed by the headless Host; no renderer UI exports. */
export type { Session } from "../model/session";
export { newSession, sessionWorkCwd } from "../model/session";
export { isTurnInterruptMessage } from "../model/inFlight";
export { sessionActivityAt } from "../model/sessionActivity";
export { persistableAttachment } from "../model/attachments";
export { buildConversationReplay } from "../model/conversationRewind";
export { appendReadyHandoff, buildDeterministicHandoff } from "../model/handoff";
