import { createStore } from "../../../shared/lib/store";
import type { InboxItem } from "./githubTasks";

const requests = createStore<[InboxItem]>({ snapshot: true });
let pending: InboxItem | null = null;

/** Asks the shell to open the Inbox on `item`; the Inbox takes it once mounted. */
export function requestInboxItem(item: InboxItem): void {
  pending = item;
  requests.notify(item);
}

export function subscribeInboxItemRequests(listener: (item: InboxItem) => void): () => void {
  return requests.subscribe(listener);
}

/** Hands the newest request to one consumer; later calls see `null`. */
export function takeInboxItemRequest(): InboxItem | null {
  const item = pending;
  pending = null;
  return item;
}
