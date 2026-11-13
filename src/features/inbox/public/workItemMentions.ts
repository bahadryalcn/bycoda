/** Work-item mention contract for chat composer and outgoing turns. */
export type { InboxItem, InboxProvider } from "../model/githubTasks";
export { InboxProviderMark } from "../ui/InboxProviderMark";
export {
  WORK_ITEM_ALIASES,
  providerForAlias,
  parseWorkItemQuery,
  workItemAliasHints,
  workItemMentionToken,
  findWorkItemMentions,
  rankWorkItemMentions,
  connectedWorkItemProviders,
  workItemMentionCandidates,
  peekWorkItemMentionCandidates,
  mergeWorkItemMentionCandidates,
  applyWorkItemMentionsToTurn,
  type WorkItemMention,
} from "../model/workItemMentions";
export {
  lookupWorkItemMention,
  parseWorkItemMentionToken,
  peekWorkItemMention,
  rememberWorkItemMention,
} from "../model/workItemMentionLookup";
export { requestInboxItem, subscribeInboxItemRequests } from "../model/inboxItemRequest";
