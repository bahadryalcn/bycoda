import { SearchInput } from "../../../shared/ui/SearchInput";
import { errorText } from "../../../shared/lib/errors";
import { t, useLocale } from "../../../shared/i18n/git";
import { useState, type FormEvent } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { Check, GitBranch, Plus } from "../../../shared/ui/icons";
import { Modal } from "../../../shared/ui/Modal";
import {
  gitCheckout,
  gitCreateBranch,
  gitDeleteRemoteBranch,
  gitMerge,
  gitRebase,
  gitRenameBranch,
  notifyGitChanged,
  type GitBranchInfo,
} from "../../../platform/tauri/fs";
import { useProjectBranchesState } from "../hooks/useProjectBranches";
import { deleteLocalBranch } from "../model/deleteBranch";
import { appName } from "../../../shared/lib/appName";
import { useGitPanelState, withGitOperation } from "../model/gitPanelState";

type Props = {
  cwd: string;
  onClose: () => void;
};

/** What git calls the branch: `name` locally, `remote/name` for a remote one. */
function branchRef(branch: GitBranchInfo): string {
  return branch.remote ? `${branch.remote}/${branch.name}` : branch.name;
}

const ACTION =
  "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] text-content/65 hover:bg-content/10 hover:text-content disabled:opacity-40";

const INPUT =
  "h-6 min-w-0 flex-1 rounded-md border border-content/10 bg-content/5 px-2 font-sans text-[12px] text-content outline-none placeholder:text-content/30 focus:border-content/25";

/** The branch being created, or renamed from `from`. */
type Editing = { kind: "create" } | { kind: "rename"; from: string };

/** Switch to, merge, rebase, create, rename, and delete branches. Needs git.actions on a project on another machine. */
export function BranchManagerDialog({ cwd, onClose }: Props) {
  useLocale();
  const { branches } = useProjectBranchesState(cwd, true);
  const [localBusy, setBusy] = useState(false);
  const [checkoutBusy] = useGitPanelState(cwd, "busy");
  const busy = localBusy || !!checkoutBusy;
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState("");
  const current = branches?.detached ? null : (branches?.current ?? null);

  const needle = query.trim().toLowerCase();
  const listed = (branches?.branches ?? []).filter(
    (branch) => !needle || branchRef(branch).toLowerCase().includes(needle),
  );
  const localRows = listed.filter((branch) => !branch.remote);
  const remoteRows = listed.filter((branch) => branch.remote);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await withGitOperation(cwd, "Updating branches…", work);
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    } finally {
      setBusy(false);
      // Also after a failure: a conflicted merge or rebase changed the tree.
      notifyGitChanged(cwd, "refs");
    }
  };

  const checkout = async (branch: GitBranchInfo) => {
    if (await run(() => gitCheckout(cwd, branch.name, branch.remote))) onClose();
  };

  const removeRemote = async (branch: GitBranchInfo) => {
    const { remote, name } = branch;
    if (!remote) return;
    const confirmed = await ask(
      `Delete branch ${name} on ${remote}? This removes it from the remote for everyone who uses it.`,
      { title: appName(), kind: "warning", okLabel: "Delete" },
    );
    if (!confirmed) return;
    await run(() => gitDeleteRemoteBranch(cwd, remote, name));
  };

  const startEditing = (next: Editing) => {
    setError(null);
    setDraft(next.kind === "rename" ? next.from : "");
    setEditing(next);
  };

  const submitEditing = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = draft.trim();
    if (!editing || !name || busy) return;
    const done = await run(() =>
      editing.kind === "rename"
        ? gitRenameBranch(cwd, editing.from, name)
        : gitCreateBranch(cwd, name),
    );
    if (!done) return;
    setEditing(null);
    // A new branch is checked out, so there is nothing left to manage here.
    if (editing.kind === "create") onClose();
  };

  const renderForm = (label: string, submitLabel: string) => (
    <form
      className="flex h-8 items-center gap-1.5 px-1"
      onSubmit={(event) => void submitEditing(event)}
    >
      <input
        type="text"
        value={draft}
        autoFocus
        aria-label={label}
        placeholder={label}
        spellCheck={false}
        autoComplete="off"
        disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          setEditing(null);
        }}
        className={INPUT}
      />
      <button type="submit" disabled={busy || !draft.trim()} className={ACTION}>
        {submitLabel}
      </button>
      <button type="button" disabled={busy} onClick={() => setEditing(null)} className={ACTION}>
        {t("Cancel")}
      </button>
    </form>
  );

  const renderRow = (branch: GitBranchInfo) => {
    const reference = branchRef(branch);
    const isCurrent = !branch.remote && branch.name === current;
    if (editing?.kind === "rename" && !branch.remote && editing.from === branch.name) {
      return <li key={reference}>{renderForm(`New name for ${branch.name}`, "Save")}</li>;
    }
    return (
      <li key={reference} className="flex h-8 items-center gap-1 px-1">
        {isCurrent ? (
          <Check className="size-3.5 shrink-0" strokeWidth={1.75} />
        ) : (
          <GitBranch className="size-3.5 shrink-0 text-content/50" strokeWidth={1.75} />
        )}
        <span
          title={reference}
          className={`min-w-0 flex-1 truncate text-[13px] text-content ${
            isCurrent ? "font-medium" : ""
          }`}
        >
          {reference}
        </span>
        {isCurrent ? null : (
          <button
            type="button"
            disabled={busy}
            title={
              branch.remote
                ? t("Check out {p0} as a local branch", { p0: reference })
                : t("Switch to {p0}", { p0: reference })
            }
            onClick={() => void checkout(branch)}
            className={ACTION}
          >
            {t("Checkout")}
          </button>
        )}
        {current && !isCurrent ? (
          <>
            <button
              type="button"
              disabled={busy}
              title={t("Merge {p0} into {p1}", { p0: reference, p1: current })}
              onClick={() => void run(() => gitMerge(cwd, reference))}
              className={ACTION}
            >
              {t("Merge")}
            </button>
            <button
              type="button"
              disabled={busy}
              title={t("Rebase {p0} onto {p1}", { p0: current, p1: reference })}
              onClick={() => void run(() => gitRebase(cwd, reference))}
              className={ACTION}
            >
              {t("Rebase")}
            </button>
          </>
        ) : null}
        {branch.remote ? (
          <button
            type="button"
            disabled={busy}
            title={t("Delete {p0} from {p1}", { p0: branch.name, p1: branch.remote })}
            onClick={() => void removeRemote(branch)}
            className={ACTION}
          >
            {t("Delete")}
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => startEditing({ kind: "rename", from: branch.name })}
              className={ACTION}
            >
              {t("Rename")}
            </button>
            <button
              type="button"
              disabled={busy || isCurrent}
              title={isCurrent ? t("Cannot delete the current branch") : undefined}
              onClick={() => void run(() => deleteLocalBranch(cwd, branch.name))}
              className={ACTION}
            >
              {t("Delete")}
            </button>
          </>
        )}
      </li>
    );
  };

  const section = (title: string, rows: GitBranchInfo[]) =>
    rows.length === 0 ? null : (
      <li key={title}>
        <h3 className="px-1 pt-2 pb-1 text-[10px] font-semibold tracking-[0.04em] text-content/55 uppercase">
          {title}
        </h3>
        <ul>{rows.map(renderRow)}</ul>
      </li>
    );

  return (
    <Modal
      languageDomain="git"
      title={t("Branches")}
      description={
        current
          ? t("Switch branches, or merge into or rebase {p0}.", { p0: current })
          : t("Switch, create, rename, and delete branches.")
      }
      size="md"
      fitViewport
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="flex min-h-0 flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <SearchInput
            standalone
            type="text"
            value={query}
            placeholder={t("Filter branches")}
            aria-label={t("Filter branches")}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            containerClassName="min-w-0 flex-1"
            className="h-7 rounded-md border border-content/10 bg-content/5 px-2 font-sans text-[12px] text-content outline-none placeholder:text-content/30 focus:border-content/25"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => startEditing({ kind: "create" })}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-content/10 px-2 text-[12px] text-content hover:bg-content/15 disabled:opacity-40"
          >
            <Plus className="size-3.5" strokeWidth={1.75} />
            {t("New Branch…")}
          </button>
        </div>
        {editing?.kind === "create" ? renderForm("New branch name", "Create") : null}
        {error ? (
          <p
            role="alert"
            className="max-h-24 overflow-y-auto whitespace-pre-wrap text-[11px] leading-4 text-danger/90"
          >
            {error}
          </p>
        ) : null}
        {listed.length === 0 ? (
          <p className="px-1 py-2 text-[12px] text-content/45">
            {needle ? t("No branches match") : t("No branches")}
          </p>
        ) : (
          <ul className="min-h-0 overflow-y-auto">
            {section("Local", localRows)}
            {section("Remote", remoteRows)}
          </ul>
        )}
      </div>
    </Modal>
  );
}
