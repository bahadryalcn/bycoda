import { useSyncExternalStore } from "react";
import { cloneRepo, isLocalDirectory, pickFolders } from "../../../platform/tauri/fs";
import { t } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { markContributeDone } from "./contribute";

/** Window event asking the app to open a folder as a project (handled in `useProjectOpen`). */
export const OPEN_PROJECT_PATH_EVENT = "bycoda:open-project-path";

export type ContributeFlowState =
  | { status: "idle" }
  | { status: "cloning" }
  | { status: "opened"; path: string; existed: boolean }
  | { status: "failed"; reason: "git-missing" | "failed"; message: string };

export type ContributeDeps = {
  repositoryUrl: string | null;
  pickParent: () => Promise<string | null>;
  clone: (url: string, parent: string) => Promise<string>;
  isDirectory: (path: string) => Promise<boolean>;
  open: (path: string) => void;
  onCloning?: () => void;
};

/** The folder `git clone` creates for this URL, mirroring the native `repo_name`. */
export function repositoryFolderName(url: string): string | null {
  const name = url
    .trim()
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .split(/[/:]/)
    .pop()
    ?.trim();
  return name && name !== "." && name !== ".." ? name : null;
}

const joinPath = (parent: string, name: string) => `${parent.replace(/[\\/]+$/, "")}/${name}`;

/**
 * Picks a parent folder, clones the repository into it and opens the clone as a project. A
 * folder that already holds a git checkout is opened as it is; any other existing folder of
 * that name is reported rather than touched.
 */
export async function runContribution(deps: ContributeDeps): Promise<ContributeFlowState | null> {
  const url = deps.repositoryUrl;
  const name = url ? repositoryFolderName(url) : null;
  if (!url || !name) {
    return { status: "failed", reason: "failed", message: "No repository is configured." };
  }
  const parent = await deps.pickParent();
  if (!parent) return null;
  const dest = joinPath(parent, name);
  try {
    if (await deps.isDirectory(dest)) {
      if (!(await deps.isDirectory(`${dest}/.git`))) {
        return { status: "failed", reason: "failed", message: `${dest} already exists` };
      }
      deps.open(dest);
      return { status: "opened", path: dest, existed: true };
    }
    deps.onCloning?.();
    const path = await deps.clone(url, parent);
    deps.open(path);
    return { status: "opened", path, existed: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "failed",
      reason: /git is not installed/i.test(message) ? "git-missing" : "failed",
      message,
    };
  }
}

let state: ContributeFlowState = { status: "idle" };
const listeners = new Set<() => void>();
function set(next: ContributeFlowState) {
  state = next;
  for (const listener of Array.from(listeners)) listener();
}

export function useContributeFlow(): ContributeFlowState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

export const dismissContributeFlow = () => {
  if (state.status !== "cloning") set({ status: "idle" });
};

/** The app's folder picker, then clone and open. One run at a time. */
export async function startContribution(): Promise<void> {
  if (state.status === "cloning") return;
  const result = await runContribution({
    repositoryUrl: PRODUCT_IDENTITY.repositoryUrl,
    pickParent: async () =>
      (await pickFolders(t("Choose where to clone bycoda"), false))[0] ?? null,
    clone: cloneRepo,
    isDirectory: isLocalDirectory,
    open: (path) =>
      window.dispatchEvent(new CustomEvent(OPEN_PROJECT_PATH_EVENT, { detail: { path } })),
    onCloning: () => set({ status: "cloning" }),
  }).catch((error: unknown): ContributeFlowState => ({
    status: "failed",
    reason: "failed",
    message: error instanceof Error ? error.message : String(error),
  }));
  if (result?.status === "opened") markContributeDone();
  set(result ?? { status: "idle" });
}
