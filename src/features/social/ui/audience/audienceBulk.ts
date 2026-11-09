/** Bulk actions on selected people. Each person is one Host call; failures are collected, not thrown. */
import type { SocialPerson } from "../../model/audience";
import type { SocialClient } from "../../model/socialClient";
import type { Sequence } from "../../model/outreach";
import { errorMessage, uniqueTags } from "./audienceModel";

export type BulkResult = { done: number; failed: { personId: string; reason: string }[] };

/** Runs one call per person, one after another, so the Host sees a steady rate. */
export async function runPerPerson(
  personIds: readonly string[],
  run: (personId: string) => Promise<unknown>,
): Promise<BulkResult> {
  const result: BulkResult = { done: 0, failed: [] };
  for (const personId of personIds) {
    try {
      await run(personId);
      result.done += 1;
    } catch (error) {
      result.failed.push({ personId, reason: errorMessage(error) });
    }
  }
  return result;
}

export async function addToList(
  client: SocialClient,
  listId: string,
  personIds: readonly string[],
): Promise<number> {
  const { changed } = await client.lists.addMembers({ listId, personIds: [...personIds] });
  return changed;
}

export async function removeFromList(
  client: SocialClient,
  listId: string,
  personIds: readonly string[],
): Promise<number> {
  const { changed } = await client.lists.removeMembers({ listId, personIds: [...personIds] });
  return changed;
}

/** Adds the tag to each person; the current tags come from the loaded rows. */
export function addTag(
  client: SocialClient,
  people: readonly Pick<SocialPerson, "id" | "tags">[],
  tag: string,
): Promise<BulkResult> {
  const byId = new Map(people.map((person) => [person.id, person]));
  return runPerPerson([...byId.keys()], (personId) => {
    const person = byId.get(personId)!;
    return client.people.update({
      personId,
      patch: { tags: uniqueTags([...person.tags, tag]) },
    });
  });
}

/** A sequence runs over its list, so putting people into the sequence means adding them to that list. */
export async function addToSequence(
  client: SocialClient,
  sequence: Pick<Sequence, "listId">,
  personIds: readonly string[],
): Promise<number> {
  return addToList(client, sequence.listId, personIds);
}

/** Manual opt-out on every channel. The Host checks suppression before every outbound send. */
export function suppressPeople(
  client: SocialClient,
  personIds: readonly string[],
): Promise<BulkResult> {
  return runPerPerson(personIds, (personId) =>
    client.suppressions.add({ personId, channel: "all", reason: "manual" }),
  );
}
