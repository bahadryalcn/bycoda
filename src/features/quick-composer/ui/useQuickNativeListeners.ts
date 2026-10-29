import { useEffect, type Dispatch, type SetStateAction } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import type { HarnessId } from "../../sessions/model/session";
import {
  applyQuickCatalog,
  initialQuickChoice,
  initialQuickProject,
  loadQuickProjects,
  QUICK_COMPOSER_CATALOG_EVENT,
  QUICK_COMPOSER_CATALOG_REQUEST_EVENT,
  QUICK_COMPOSER_SHOWN_EVENT,
} from "../model/quickComposer";
import type { QuickComposerDraft, QuickComposerOwner } from "../model/quickComposerClosure";
import { loadQuickProjectAppearance } from "./QuickProjectIcon";

export interface QuickNativeListeners {
  owner: QuickComposerOwner;
  onShown: () => void;
  focusPrompt: () => void;
  /** Clears transient picker/slash/error UI. Must be referentially stable. */
  resetTransient: () => void;
  setProjects: Dispatch<SetStateAction<string[]>>;
  setProjectAppearance: Dispatch<SetStateAction<ReturnType<typeof loadQuickProjectAppearance>>>;
  setCwd: (value: SetStateAction<string | null>) => void;
  setChoice: (value: QuickComposerDraft["choice"]) => void;
  setModelSettings: (value: Record<string, string>) => void;
  setAvailableHarnesses: (harnesses: HarnessId[]) => void;
}

/**
 * Native window events. Projects and defaults can change in the workspace
 * between shows, so each show re-reads them; the draft survives a dismiss, like
 * Spotlight's query. Model lists come from the CLIs, which only workspace
 * windows talk to.
 */
export function useQuickNativeListeners({
  owner,
  onShown,
  focusPrompt,
  resetTransient,
  setProjects,
  setProjectAppearance,
  setCwd,
  setChoice,
  setModelSettings,
  setAvailableHarnesses,
}: QuickNativeListeners) {
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen(QUICK_COMPOSER_SHOWN_EVENT, () => {
      onShown();
      if (!owner.canMutate()) return;
      const nextProjects = loadQuickProjects();
      const nextChoice = initialQuickChoice();
      setProjects(nextProjects);
      setProjectAppearance(loadQuickProjectAppearance());

      setCwd((current) =>
        current && nextProjects.includes(current) ? current : initialQuickProject(nextProjects),
      );
      setChoice(nextChoice);
      setModelSettings({});
      resetTransient();
      void emit(QUICK_COMPOSER_CATALOG_REQUEST_EVENT, nextChoice.harness);
      focusPrompt();
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    focusPrompt();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [
    focusPrompt,
    onShown,
    owner,
    resetTransient,
    setChoice,
    setCwd,
    setModelSettings,
    setProjectAppearance,
    setProjects,
  ]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen(QUICK_COMPOSER_CATALOG_EVENT, (event) => {
      const available = applyQuickCatalog(event.payload);
      if (available) setAvailableHarnesses(available);
    }).then((stop) => {
      if (disposed) {
        stop();
        return;
      }
      unlisten = stop;
      void emit(QUICK_COMPOSER_CATALOG_REQUEST_EVENT, initialQuickChoice().harness);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [setAvailableHarnesses]);
}
