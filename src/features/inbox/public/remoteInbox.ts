/** Public contract for running inbox work on behalf of another device. */
export {
  REMOTE_INBOX_PROVIDERS,
  REMOTE_INBOX_VERSION,
  inboxOperationWrites,
  nativeInboxCommand,
  safeInboxError,
  type DesktopInboxJob,
  type DesktopInboxPayload,
  type DesktopInboxReply,
  type RemoteInboxList,
  type RemoteInboxOperation,
  type RemoteInboxQuery,
} from "../model/remoteInbox";
