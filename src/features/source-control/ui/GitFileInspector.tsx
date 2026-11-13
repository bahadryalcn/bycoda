import { Text } from "../../../shared/ui/Text";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Button } from "../../../shared/ui/Button";
import { errorText } from "../../../shared/lib/errors";
import { t, useLocale, getLocale } from "../../../shared/i18n/git";
import { useEffect, useState } from "react";
import { GitFeedback } from "./GitFeedback";

import { Modal } from "../../../shared/ui/Modal";
import {
  gitBlame,
  gitFileHistory,
  readTextFile,
  type GitBlameLine,
  type GitHistoryCommit,
} from "../../../platform/tauri/fs";

export const GIT_FILE_INSPECT_EVENT = "bycoda:git-file-inspect";

export type GitFileInspectRequest = {
  kind: "history" | "blame";
  cwd: string;
  /** Path relative to `cwd`. */
  relative: string;
};

export function requestGitFileInspect(request: GitFileInspectRequest): void {
  window.dispatchEvent(new CustomEvent(GIT_FILE_INSPECT_EVENT, { detail: request }));
}

/** Asks the host to show a commit's diff, from places with no handler of their own (the editor's blame gutter). */
export const GIT_COMMIT_OPEN_EVENT = "bycoda:git-commit-open";

export function requestOpenCommit(commit: GitHistoryCommit): void {
  window.dispatchEvent(new CustomEvent(GIT_COMMIT_OPEN_EVENT, { detail: commit }));
}

type Props = {
  onOpenCommit: (commit: GitHistoryCommit, pin?: boolean, repositoryCwd?: string) => void;
};

function shortDate(timestamp: number): string {
  return timestamp > 0 ? new Date(timestamp * 1000).toLocaleDateString(getLocale()) : "";
}

const UNCOMMITTED = /^0+$/;

/** Hosts the file history and blame dialogs opened from the explorer menu. */
export function GitFileInspector({ onOpenCommit }: Props) {
  useLocale();
  const [request, setRequest] = useState<GitFileInspectRequest | null>(null);

  useEffect(() => {
    const open = (event: Event) => setRequest((event as CustomEvent<GitFileInspectRequest>).detail);
    window.addEventListener(GIT_FILE_INSPECT_EVENT, open);
    return () => window.removeEventListener(GIT_FILE_INSPECT_EVENT, open);
  }, []);

  useEffect(() => {
    const open = (event: Event) =>
      onOpenCommit((event as CustomEvent<GitHistoryCommit>).detail, true);
    window.addEventListener(GIT_COMMIT_OPEN_EVENT, open);
    return () => window.removeEventListener(GIT_COMMIT_OPEN_EVENT, open);
  }, [onOpenCommit]);

  if (!request) return null;
  const close = () => setRequest(null);
  const openCommit = (commit: GitHistoryCommit) => {
    close();
    onOpenCommit(commit, true, request.cwd);
  };
  return request.kind === "history" ? (
    <FileHistoryDialog
      key={`${request.cwd}:${request.relative}`}
      request={request}
      onClose={close}
      onOpenCommit={openCommit}
    />
  ) : (
    <BlameDialog
      key={`${request.cwd}:${request.relative}`}
      request={request}
      onClose={close}
      onOpenCommit={openCommit}
    />
  );
}

type DialogProps = {
  request: GitFileInspectRequest;
  onClose: () => void;
  onOpenCommit: (commit: GitHistoryCommit) => void;
};

function Loading() {
  useLocale();
  return <LoadingText className="px-3 py-2">{t("Loading…")}</LoadingText>;
}

function FileHistoryDialog({ request, onClose, onOpenCommit }: DialogProps) {
  useLocale();
  const [commits, setCommits] = useState<GitHistoryCommit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let stale = false;
    setError(null);
    setCommits(null);
    gitFileHistory(request.cwd, request.relative).then(
      (next) => !stale && setCommits(next),
      (err) => !stale && setError(errorText(err)),
    );
    return () => {
      stale = true;
    };
  }, [request, retry]);

  return (
    <Modal
      padding="none"
      languageDomain="git"
      title={t("File history")}
      description={request.relative}
      size="md"
      fitViewport
      onClose={onClose}
    >
      {error ? (
        <GitFeedback
          title={t("Couldn’t load file information")}
          detail={error}
          onRetry={() => setRetry((value) => value + 1)}
        />
      ) : !commits ? (
        <Loading />
      ) : commits.length === 0 ? (
        <EmptyState size="inline" className="px-4" description={t("No commits touch this file")} />
      ) : (
        <ul className="min-h-0 overflow-y-auto p-1.5">
          {commits.map((commit) => (
            <li key={commit.sha}>
              <Button
                variant="item"
                motion="none"
                type="button"
                onClick={() => onOpenCommit(commit)}
                className="flex w-full items-center gap-2 text-left"
              >
                <Text size="micro" tone="muted" className="shrink-0 font-mono">
                  {commit.shortSha}
                </Text>
                <Text as="span" size="inherit" tone="primary" truncate className="min-w-0 flex-1">
                  {commit.subject}
                </Text>
                <Text size="inherit" tone="muted" truncate className="shrink-0">
                  {commit.author}
                </Text>
                <Text size="inherit" tone="muted" className="shrink-0 tabular-nums">
                  {shortDate(commit.timestamp)}
                </Text>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function BlameDialog({ request, onClose, onOpenCommit }: DialogProps) {
  useLocale();
  const [data, setData] = useState<{
    blame: GitBlameLine[];
    lines: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let stale = false;
    setError(null);
    setData(null);
    Promise.all([
      gitBlame(request.cwd, request.relative),
      readTextFile(`${request.cwd}/${request.relative}`),
    ]).then(
      ([blame, text]) => !stale && setData({ blame, lines: text.split(/\r?\n/) }),
      (err) => !stale && setError(errorText(err)),
    );
    return () => {
      stale = true;
    };
  }, [request, retry]);

  return (
    <Modal
      padding="none"
      languageDomain="git"
      title={t("Blame")}
      description={request.relative}
      size="md"
      fitViewport
      onClose={onClose}
    >
      {error ? (
        <GitFeedback
          title={t("Couldn’t load file information")}
          detail={error}
          onRetry={() => setRetry((value) => value + 1)}
        />
      ) : !data ? (
        <Loading />
      ) : (
        <Text
          as="div"
          size="caption"
          leading="relaxed"
          className="min-h-0 overflow-auto p-1.5 font-mono"
        >
          {data.blame.map((entry, index) => {
            // Only the first line of a run names its commit, like an editor gutter.
            const first = data.blame[index - 1]?.sha !== entry.sha;
            const uncommitted = UNCOMMITTED.test(entry.sha);
            return (
              <div
                key={entry.line}
                {...surfaceAttributes(
                  {
                    frame: first ? "pane" : undefined,
                    edge: first ? "top" : undefined,
                  },
                  "flex whitespace-pre",
                )}
              >
                <Button
                  variant="ghost"
                  motion="none"
                  type="button"
                  disabled={uncommitted}
                  tooltip={
                    uncommitted ? t("Not committed yet") : `${entry.shortSha} ${entry.summary}`
                  }
                  onClick={() =>
                    onOpenCommit({
                      sha: entry.sha,
                      shortSha: entry.shortSha,
                      parents: [],
                      author: entry.author,
                      timestamp: entry.timestamp,
                      subject: entry.summary,
                      refs: [],
                      head: false,
                    })
                  }
                  className="w-48 shrink-0 text-left"
                >
                  <Text as="span" size="inherit" tone="inherit" truncate className="block">
                    {first
                      ? uncommitted
                        ? t("Not committed yet")
                        : `${entry.author} · ${shortDate(entry.timestamp)} · ${entry.summary}`
                      : ""}
                  </Text>
                </Button>
                <Text
                  size="inherit"
                  tone="muted"
                  className="w-10 shrink-0 pr-3 text-right select-none"
                >
                  {entry.line}
                </Text>
                <Text size="inherit" tone="primary">
                  {data.lines[entry.line - 1] ?? ""}
                </Text>
              </div>
            );
          })}
        </Text>
      )}
    </Modal>
  );
}
