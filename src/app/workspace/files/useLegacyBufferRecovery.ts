import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  legacyBufferRecovery,
  legacyBufferReportKey,
  type LegacyBufferDetails,
  type LegacyBufferReport,
} from "../../../features/files/data/legacyBufferRecovery";

type Api = Pick<typeof legacyBufferRecovery, "available" | "list" | "read">;
type Options = {
  enabled: boolean;
  /** Metadata has no trustworthy project origin; deny while any origin is concealed. */
  canInspect(): boolean;
  /** Synchronous store identity, changed for every privacy invalidation, including ABA. */
  getPrivacySnapshot(): unknown;
  api?: Api;
};
type Page = { records: readonly LegacyBufferReport[]; next: number | null; after: number | null };
export function useLegacyBufferRecovery(options: Options) {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  const mounted = useRef(false);
  const generation = useRef(0);
  const reading = useRef<string | null>(null);
  const listing = useRef(false);
  const [page, setPage] = useState<Page>({ records: [], next: null, after: null });
  const [loadedRecords, setLoadedRecords] = useState<readonly LegacyBufferReport[]>([]);
  const [previous, setPrevious] = useState<readonly (number | null)[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [details, setDetails] = useState<LegacyBufferDetails | null>(null);
  const [checked, setChecked] = useState(false);
  const visible = options.enabled && options.canInspect();
  const privacySnapshot = options.getPrivacySnapshot();
  const [renderPolicy, setRenderPolicy] = useState({ visible, privacySnapshot });
  if (renderPolicy.visible !== visible || renderPolicy.privacySnapshot !== privacySnapshot) {
    setRenderPolicy({ visible, privacySnapshot });
    if (!visible || renderPolicy.privacySnapshot !== privacySnapshot) {
      setPending(null);
      setDetails(null);
      setReadError(null);
      setPage({ records: [], next: null, after: null });
      setLoadedRecords([]);
      setPrevious([]);
      setChecked(false);
    }
  }
  const api = options.api ?? legacyBufferRecovery;
  const available = api.available();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  useLayoutEffect(() => {
    generation.current++;
    reading.current = null;
  }, [visible, privacySnapshot]);
  const allowed = useCallback(
    () => mounted.current && latest.current.enabled && latest.current.canInspect(),
    [],
  );
  const load = useCallback(
    async (after: number | null, direction: "refresh" | "next" | "previous") => {
      if (!allowed() || listing.current) return;
      const privacy = latest.current.getPrivacySnapshot();
      const samePrivacy = () => privacy === latest.current.getPrivacySnapshot();
      const current = ++generation.current;
      listing.current = true;
      reading.current = null;
      setPending(null);
      setReadError(null);
      setDetails(null);
      setLoading(true);
      setError(false);
      try {
        const result = await (latest.current.api ?? legacyBufferRecovery).list({
          after,
          limit: 25,
        });
        if (!allowed() || !samePrivacy() || current !== generation.current) return;
        if (direction === "refresh") setPrevious([]);
        else if (direction === "next") setPrevious((old) => [...old.slice(-31), page.after]);
        else setPrevious((old) => old.slice(0, -1));
        if (direction === "refresh") setLoadedRecords(result.records);
        else
          setLoadedRecords((old) => {
            const known = new Set(old.map(legacyBufferReportKey));
            const added = result.records.filter(
              (record) => !known.has(legacyBufferReportKey(record)),
            );
            return direction === "previous" ? [...added, ...old] : [...old, ...added];
          });
        setPage({ ...result, after });
        setChecked(true);
      } catch {
        if (allowed() && samePrivacy() && current === generation.current) setError(true);
      } finally {
        listing.current = false;
        if (mounted.current) setLoading(false);
      }
    },
    [allowed, page.after],
  );
  const inspect = useCallback(
    async (record: LegacyBufferReport) => {
      if (!allowed() || listing.current || reading.current || !record.source || !record.inspectable)
        return;
      const key = legacyBufferReportKey(record);
      const privacy = latest.current.getPrivacySnapshot();
      const samePrivacy = () => privacy === latest.current.getPrivacySnapshot();
      const current = ++generation.current;
      reading.current = key;
      setPending(key);
      setReadError(null);
      setDetails(null);
      try {
        const result = await (latest.current.api ?? legacyBufferRecovery).read(record.source);
        if (allowed() && samePrivacy() && current === generation.current) setDetails(result);
      } catch {
        if (allowed() && samePrivacy() && current === generation.current) setReadError(key);
      } finally {
        if (reading.current === key) reading.current = null;
        if (mounted.current && current === generation.current) setPending(null);
      }
    },
    [allowed],
  );
  // The dialog requests inspection explicitly; there is no background source
  // read, automatic disk open, Source resolve or implicit fence release.
  return {
    available,
    visible,
    records: visible ? loadedRecords : [],
    details: visible ? details : null,
    pending: visible ? pending : null,
    readError: visible ? readError : null,
    error: visible && error,
    loading,
    loaded: checked,
    hasNext: page.next !== null,
    hasPrevious: previous.length > 0,
    refresh: () => load(null, "refresh"),
    next: () => (page.next !== null ? load(page.next, "next") : Promise.resolve()),
    previous: () =>
      previous.length ? load(previous[previous.length - 1]!, "previous") : Promise.resolve(),
    inspect,
    detailsAreCurrent: () => allowed() && privacySnapshot === latest.current.getPrivacySnapshot(),
    closeDetails: () => {
      generation.current++;
      reading.current = null;
      setPending(null);
      setDetails(null);
      setReadError(null);
    },
  };
}
