import type { AssistantMessage } from "../../../../shared/model/host-contracts/assistant";
import type { MessageTimelineItem } from "../../../../shared/ui/MessageTimeline";
import { conversationMessageItem } from "./ConversationMessage";

type JobLink = { id: string; title: string };
type Shared = Omit<Parameters<typeof conversationMessageItem>[0], "message" | "jobs">;
type Context = Shared & { locale: string };
type Entry = { message: AssistantMessage; jobs: readonly JobLink[]; item: MessageTimelineItem };

const noJobs: readonly JobLink[] = [];

function sameJobs(a: readonly JobLink[], b: readonly JobLink[]): boolean {
  return (
    a.length === b.length &&
    a.every((job, index) => job.id === b[index].id && job.title === b[index].title)
  );
}

function sameContext(a: Context, b: Context): boolean {
  return (Object.keys(a) as (keyof Context)[]).every((key) => a[key] === b[key]);
}

/**
 * Timeline items for the visible messages that keep their identity while nothing they show
 * changed. A message depends on itself, the title of each job it links and the shared context
 * (name, locale, handlers), never on the rest of the Assistant snapshot, so a job update
 * rebuilds only the messages that link that job. `locale` only invalidates: it is not an input
 * of the item, the translated strings are.
 */
export function createMessageProjection() {
  let context: Context | undefined;
  let cache = new Map<string, Entry>();
  return (
    messages: readonly AssistantMessage[],
    jobsById: ReadonlyMap<string, JobLink>,
    next: Context,
  ): MessageTimelineItem[] => {
    if (!context || !sameContext(context, next)) cache = new Map();
    context = next;
    const previous = cache;
    cache = new Map();
    const { locale: _locale, ...shared } = next;
    return messages.map((message) => {
      const jobs = message.jobIds.length
        ? message.jobIds.flatMap((id) => {
            const job = jobsById.get(id);
            return job ? [job] : [];
          })
        : noJobs;
      const hit = previous.get(message.id);
      if (hit && hit.message === message && sameJobs(hit.jobs, jobs)) {
        cache.set(message.id, hit);
        return hit.item;
      }
      const item = conversationMessageItem({ ...shared, message, jobs });
      cache.set(message.id, { message, jobs, item });
      return item;
    });
  };
}
