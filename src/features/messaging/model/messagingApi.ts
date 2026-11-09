import { invoke } from "@tauri-apps/api/core";
import type {
  BrowserSignInPoll,
  BrowserSignInPurpose,
  BrowserSignInStart,
  MessageThread,
  MessagingAccount,
  MicrosoftDevicePoll,
  MicrosoftDevicePurpose,
  MicrosoftDeviceStart,
  SaveMessagingAccountInput,
  ThreadMessage,
} from "./messagingTypes";

/** Fired after an account is added, edited or removed so Settings and Inbox stay in step. */
export const MESSAGING_ACCOUNTS_CHANGE_EVENT = "bycoda:messaging-accounts-change";

export function notifyMessagingAccountsChange(): void {
  window.dispatchEvent(new Event(MESSAGING_ACCOUNTS_CHANGE_EVENT));
}

export function listMessagingAccounts(): Promise<MessagingAccount[]> {
  return invoke<MessagingAccount[]>("messaging_list_accounts");
}

export async function saveMessagingAccount(
  input: SaveMessagingAccountInput,
): Promise<MessagingAccount> {
  const account = await invoke<MessagingAccount>("messaging_save_account", { input });
  notifyMessagingAccountsChange();
  return account;
}

export async function removeMessagingAccount(accountId: string): Promise<void> {
  await invoke("messaging_remove_account", { accountId });
  notifyMessagingAccountsChange();
}

export function listMessageThreads(accountId: string, limit?: number): Promise<MessageThread[]> {
  return invoke<MessageThread[]>("messaging_list_threads", { accountId, limit });
}

export function listThreadMessages(accountId: string, threadId: string): Promise<ThreadMessage[]> {
  return invoke<ThreadMessage[]>("messaging_thread_messages", { accountId, threadId });
}

/** `requestId` must stay the same across retries of one send so it is never sent twice. */
export function replyToThread(
  accountId: string,
  threadId: string,
  body: string,
  requestId: string,
): Promise<ThreadMessage> {
  return invoke<ThreadMessage>("messaging_reply", { accountId, threadId, body, requestId });
}

export function startMicrosoftDeviceSignIn(
  purpose: MicrosoftDevicePurpose,
  clientId?: string,
  tenant?: string,
): Promise<MicrosoftDeviceStart> {
  return invoke<MicrosoftDeviceStart>("messaging_microsoft_device_start", {
    purpose,
    clientId: clientId?.trim() || null,
    tenant: tenant?.trim() || null,
  });
}

export function pollMicrosoftDeviceSignIn(handle: string): Promise<MicrosoftDevicePoll> {
  return invoke<MicrosoftDevicePoll>("messaging_microsoft_device_poll", { handle });
}

export function startBrowserSignIn(
  purpose: BrowserSignInPurpose,
  options: { clientId?: string; clientSecret?: string; loginHint?: string } = {},
): Promise<BrowserSignInStart> {
  return invoke<BrowserSignInStart>("messaging_browser_sign_in_start", {
    purpose,
    clientId: options.clientId?.trim() || null,
    clientSecret: options.clientSecret?.trim() || null,
    loginHint: options.loginHint?.trim() || null,
  });
}

export function pollBrowserSignIn(handle: string): Promise<BrowserSignInPoll> {
  return invoke<BrowserSignInPoll>("messaging_browser_sign_in_poll", { handle });
}

export function cancelBrowserSignIn(handle: string): Promise<void> {
  return invoke("messaging_browser_sign_in_cancel", { handle });
}
