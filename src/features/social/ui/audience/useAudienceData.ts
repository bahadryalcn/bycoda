import { useCallback, useEffect, useRef, useState } from "react";
import type { SocialList, SocialPerson } from "../../model/audience";
import type { SocialAccount } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import type { PeopleListInput } from "../../model/socialActions";
import { errorMessage, peopleScope } from "./audienceModel";

export const PEOPLE_PAGE_SIZE = 100;
const SEARCH_DELAY_MS = 250;

export type AudienceData = {
  lists: SocialList[];
  accounts: SocialAccount[];
  people: SocialPerson[];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error?: string;
  loadMore: () => void;
  reload: () => void;
  /** Replaces one loaded row after a successful edit, without a round trip. */
  patchPerson: (person: SocialPerson) => void;
  removePeople: (personIds: readonly string[]) => void;
};

/** The people query for a list and a text search. The search is part of the filter. */
export function audienceQuery(list: SocialList | undefined, query: string): PeopleListInput {
  const scope = peopleScope(list);
  const text = query.trim();
  if (!text) return scope;
  return { ...scope, filter: { ...scope.filter, query: text } };
}

/**
 * Lists, accounts and one page at a time of people for the selected list and search text.
 * Responses that arrive after the selection changed are dropped, so an old list never
 * overwrites the one on screen.
 */
export function useAudienceData(
  client: SocialClient,
  selection: { listId: string | null; query: string },
): AudienceData {
  const { listId, query } = selection;
  const [lists, setLists] = useState<SocialList[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [people, setPeople] = useState<SocialPerson[]>([]);
  const [next, setNext] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const requestRef = useRef(0);
  const queryRef = useRef<PeopleListInput>({});

  useEffect(() => {
    const request = ++requestRef.current;
    const timer = window.setTimeout(
      () => {
        setLoading(true);
        setLoadingMore(false);
        setError(undefined);
        Promise.all([client.lists.list(), client.snapshot()])
          .then(async ([listResult, snapshot]) => {
            if (request !== requestRef.current) return;
            const list = listResult.items.find((item) => item.id === listId);
            const input = audienceQuery(list, query);
            queryRef.current = input;
            const page = await client.people.list({ ...input, limit: PEOPLE_PAGE_SIZE });
            if (request !== requestRef.current) return;
            setLists(listResult.items);
            setAccounts(snapshot.accounts);
            setPeople(page.items);
            setNext(page.next);
          })
          .catch((err: unknown) => {
            if (request === requestRef.current) setError(errorMessage(err));
          })
          .finally(() => {
            if (request === requestRef.current) setLoading(false);
          });
      },
      query ? SEARCH_DELAY_MS : 0,
    );
    return () => window.clearTimeout(timer);
  }, [client, listId, query, revision]);

  const loadMore = useCallback(() => {
    if (!next || loadingMore) return;
    const request = requestRef.current;
    setLoadingMore(true);
    client.people
      .list({ ...queryRef.current, cursor: next, limit: PEOPLE_PAGE_SIZE })
      .then((page) => {
        if (request !== requestRef.current) return;
        setPeople((rows) => [...rows, ...page.items]);
        setNext(page.next);
      })
      .catch((err: unknown) => {
        if (request === requestRef.current) setError(errorMessage(err));
      })
      .finally(() => {
        if (request === requestRef.current) setLoadingMore(false);
      });
  }, [client, next, loadingMore]);

  const reload = useCallback(() => setRevision((value) => value + 1), []);

  const patchPerson = useCallback((person: SocialPerson) => {
    setPeople((rows) => rows.map((row) => (row.id === person.id ? person : row)));
  }, []);

  const removePeople = useCallback((personIds: readonly string[]) => {
    const removed = new Set(personIds);
    setPeople((rows) => rows.filter((row) => !removed.has(row.id)));
  }, []);

  return {
    lists,
    accounts,
    people,
    hasMore: Boolean(next),
    loading,
    loadingMore,
    error,
    loadMore,
    reload,
    patchPerson,
    removePeople,
  };
}
