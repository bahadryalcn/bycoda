import { useSyncExternalStore } from "react";
import { storedFlag } from "../lib/storedSetting";

// Long commands and output wrap by default; aligned output (tables, diffs) can opt out, and the choice persists.
const outputWrap = storedFlag("bycoda.toolOutputWrap", true, "bycoda:tool-output-wrap", true);
const loadOutputWrap = () => outputWrap.load() ?? true;
const saveOutputWrap = (wrap: boolean) => outputWrap.save(wrap);

/** The reader's persisted wrap choice, shared by every command and tool output view. */
export function useOutputWrap(): readonly [boolean, (wrap: boolean) => void] {
  const wrap = useSyncExternalStore(outputWrap.subscribe, loadOutputWrap, () => true);
  return [wrap, saveOutputWrap];
}
