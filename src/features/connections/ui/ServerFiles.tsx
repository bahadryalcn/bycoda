import { Text } from "../../../shared/ui/Text";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { useSshHttpProxyApproval } from "./useSshHttpProxyApproval";
import type { SshHttpProxyOperation } from "../model/sshHttpProxyApproval";
import type { SshEndpoint } from "../model/serverInventory";
import { useEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Modal } from "../../../shared/ui/Modal";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { TextField } from "../../../shared/ui/TextField";
import { Alert } from "../../../shared/ui/Alert";
import { Progress } from "../../../shared/ui/Progress";
import { SearchInput } from "../../../shared/ui/SearchInput";
import {
  ArrowUp,
  ArrowDown as Download,
  Folder,
  File,
  CloudUpload as Upload,
  RefreshCw,
} from "../../../shared/ui/icons";
import { formatNumber, t } from "../../../shared/i18n";
import {
  cancelSftp,
  downloadSftp,
  listSftp,
  sftpParent,
  sftpPath,
  uploadSftp,
  type SftpEntry,
  type SftpProgress,
  type SftpRecovery,
  subscribeSftpProgress,
  loadSftpRecoveries,
  resumeSftp,
  discardSftp,
} from "../model/sshSftp";

export function ServerFiles({
  connectionId,
  endpoint,
  onClose,
  serverName,
}: {
  connectionId: string;
  endpoint?: SshEndpoint;
  onClose: () => void;
  serverName?: string;
}) {
  const proxy = useSshHttpProxyApproval();
  const approve = (operation: SshHttpProxyOperation) =>
    endpoint ? proxy.request({ connectionId, endpoint, operation }) : Promise.resolve(undefined);
  const [path, setPath] = useState(".");
  const [query, setQuery] = useState(".");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [fileSearch, setFileSearch] = useState("");
  const visibleEntries = entries.filter((entry) =>
    entry.name.toLocaleLowerCase().includes(fileSearch.trim().toLocaleLowerCase()),
  );
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState<{ localPath: string; name: string }>();
  const [overwrite, setOverwrite] = useState(false);
  const [progress, setProgress] = useState<SftpProgress>();
  const [recoveries, setRecoveries] = useState<SftpRecovery[]>([]);
  const [review, setReview] = useState<SftpRecovery>();
  const [resumeOverwrite, setResumeOverwrite] = useState(false);
  const operation = useRef<string | null>(null);
  const cancelledOperation = useRef<string | null>(null);
  const mounted = useRef(true);
  const canContinue = (id: string) =>
    mounted.current && operation.current === id && cancelledOperation.current !== id;
  const cancel = () => {
    const id = operation.current;
    if (!id) return;
    // Native work may not exist yet while a picker or approval is pending.
    cancelledOperation.current = id;
    void cancelSftp(id).catch((reason) => {
      if (mounted.current) setError(String(reason));
    });
  };

  useEffect(() => {
    mounted.current = true;
    void loadSftpRecoveries(connectionId)
      .then((records) => {
        if (mounted.current) setRecoveries(records);
      })
      .catch((reason) => {
        if (mounted.current) setError(String(reason));
      });
    const listener = subscribeSftpProgress((event) => {
      if (mounted.current && event.operationId === operation.current) setProgress(event);
    });
    void listener.catch(() => undefined);
    return () => {
      mounted.current = false;
      void listener.then((unlisten) => unlisten()).catch(() => undefined);
      if (operation.current) void cancelSftp(operation.current).catch(() => undefined);
    };
  }, [connectionId]);

  const act = async (callback: (operationId: string) => Promise<void>) => {
    if (operation.current) return;
    const id = crypto.randomUUID();
    operation.current = id;
    cancelledOperation.current = null;
    setBusy(true);
    setError("");
    setStatus("");
    setProgress(undefined);
    try {
      await callback(id);
    } catch (reason) {
      if (mounted.current) setError(String(reason));
    } finally {
      if (operation.current === id) operation.current = null;
      if (mounted.current) setBusy(false);
      if (mounted.current)
        void loadSftpRecoveries(connectionId)
          .then((records) => {
            if (mounted.current) setRecoveries(records);
          })
          .catch(() => undefined);
    }
  };
  const load = (next: string) =>
    act(async (id) => {
      const ticket = await approve({ kind: "sftpList", operationId: id, path: next });
      if (ticket === null || !canContinue(id)) return;
      const result = await listSftp(connectionId, next, id, ticket);
      if (!canContinue(id)) return;
      setEntries(result);
      setPath(next);
      setQuery(next);
      setLoaded(true);
      setFileSearch("");
    });
  const close = () => {
    cancel();
    onClose();
  };

  return (
    <>
      <Modal title={t("SFTP files")} onClose={close} size="lg" fitViewport>
        <div className="flex min-h-0 flex-col gap-3">
          {serverName ? (
            <Text as="p" tone="muted" truncate>
              {t("Target")}: {serverName}
            </Text>
          ) : null}
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void load(query);
            }}
          >
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              disabled={busy || !loaded}
              label={t("Parent directory")}
              onClick={() => void load(sftpParent(path))}
            >
              <ArrowUp className="icon-sm" />
            </Button>
            <TextField
              label={t("Remote directory")}
              hideLabel
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={busy}
              fieldClassName="min-w-0 flex-1"
            />
            <Button type="submit" loading={busy}>
              {loaded ? <RefreshCw className="icon-sm" /> : null}
              {t(loaded ? "Refresh" : "Open")}
            </Button>
            <Button
              disabled={busy || !loaded || !!upload}
              onClick={() => {
                void open({ multiple: false, directory: false })
                  .then((value) => {
                    if (typeof value === "string" && mounted.current) {
                      setOverwrite(false);
                      setUpload({ localPath: value, name: value.split(/[\\/]/).pop() ?? "" });
                    }
                  })
                  .catch((reason) => setError(String(reason)));
              }}
            >
              <Upload className="icon-sm" />
              {t("Upload")}
            </Button>
            {busy ? (
              <Button variant="ghost" onClick={cancel}>
                {t("Cancel")}
              </Button>
            ) : null}
          </form>
          {busy || progress ? (
            <div className="flex min-w-0 flex-col gap-1" role="status">
              <Progress
                compact
                label={progress ? t(progress.phase) : t("Working…")}
                value={
                  progress?.totalBytes != null &&
                  (progress.transferredBytes > 0 || progress.state === "completed")
                    ? progress.totalBytes === 0
                      ? 1
                      : progress.transferredBytes
                    : undefined
                }
                max={progress?.totalBytes || 1}
                tone="neutral"
              />
              <Text tone="muted">
                {progress
                  ? `${formatNumber(progress.transferredBytes)}${progress.totalBytes != null ? ` / ${formatNumber(progress.totalBytes)}` : ""} ${t("bytes")}`
                  : t("Waiting for transfer data…")}
              </Text>
            </div>
          ) : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {status ? (
            <Text role="status" as="p" tone="muted">
              {status}
            </Text>
          ) : null}
          {upload ? (
            <div className="flex flex-col gap-2 border-y border-stroke py-3">
              <TextField
                label={t("Remote filename")}
                value={upload.name}
                disabled={busy}
                onChange={(event) => {
                  setOverwrite(false);
                  setUpload({ ...upload, name: event.target.value });
                }}
              />
              <Checkbox
                checked={overwrite}
                disabled={busy}
                onChange={(event) => setOverwrite(event.target.checked)}
                label={t("I allow replacement if this remote filename already exists.")}
                size="caption"
                className="flex items-start gap-2"
              />
              <div className="flex gap-2">
                <Button
                  disabled={!overwrite || busy || !upload.name}
                  onClick={() =>
                    void act(async (id) => {
                      const remotePath = sftpPath(path, upload.name);
                      const ticket = await approve({
                        kind: "sftpUpload",
                        operationId: id,
                        localPath: upload.localPath,
                        remotePath,
                        overwriteConfirmed: overwrite,
                      });
                      if (ticket === null || !canContinue(id)) return;
                      const bytes = await uploadSftp(
                        connectionId,
                        upload.localPath,
                        remotePath,
                        overwrite,
                        id,
                        ticket,
                      );
                      if (mounted.current) {
                        setUpload(undefined);
                        setOverwrite(false);
                        setStatus(`${t("Uploaded")}: ${formatNumber(bytes)} ${t("bytes")}`);
                      }
                    })
                  }
                >
                  {t("Upload file")}
                </Button>
                <Button
                  disabled={busy}
                  variant="ghost"
                  onClick={() => {
                    setUpload(undefined);
                    setOverwrite(false);
                  }}
                >
                  {t("Cancel")}
                </Button>
              </div>
            </div>
          ) : null}
          {recoveries.length ? (
            <div className="flex flex-col gap-2 border-y border-stroke py-2">
              <SectionLabel count={recoveries.length}>{t("Paused transfers")}</SectionLabel>
              <div className="flex flex-col gap-2">
                {recoveries.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 basis-full break-all">
                      {t(item.direction)} · {item.remotePath}
                      {item.publication ? (
                        <Text size="inherit" tone="muted" className="block">
                          {t(
                            item.publication === "completed"
                              ? "Transfer completed; recovery cleanup remains. Dismissal removes only recovery metadata."
                              : "Publication outcome unknown. Check the destination before dismissing recovery; a partial file may remain.",
                          )}
                        </Text>
                      ) : null}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy || !!item.publication}
                      onClick={() => {
                        setReview(item);
                        setResumeOverwrite(false);
                      }}
                    >
                      {t("Review resume")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void act(async (id) => {
                          const ticket = await approve({
                            kind: "sftpDiscard",
                            operationId: id,
                            recoveryId: item.id,
                          });
                          if (ticket === null || !canContinue(id)) return;
                          await discardSftp(connectionId, item.id, id, ticket);
                          if (mounted.current && review?.id === item.id) setReview(undefined);
                        })
                      }
                    >
                      {t(item.publication ? "Dismiss recovery" : "Discard partial")}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {review ? (
            <Text
              as="section"
              size="caption"
              tone="inherit"
              className="flex flex-col gap-2 border-b border-stroke pb-3"
              aria-label={t("Resume transfer review")}
            >
              <p className="break-all">
                {review.localPath} ↔ {review.remotePath}
              </p>
              <Text as="p" size="inherit" tone="muted">
                {t(
                  "Resume verifies the existing content before continuing. Verification reads remote data again and may transfer the full file. Existing destination files are not silently replaced.",
                )}
              </Text>
              {review.direction === "upload" ? (
                <Checkbox
                  checked={resumeOverwrite}
                  disabled={busy}
                  onChange={(event) => setResumeOverwrite(event.target.checked)}
                  label={t("I allow replacement if this remote filename already exists.")}
                  className="flex items-start gap-2"
                />
              ) : null}
              <div className="flex gap-2">
                <Button
                  disabled={busy || (review.direction === "upload" && !resumeOverwrite)}
                  onClick={() =>
                    void act(async (id) => {
                      const ticket = await approve({
                        kind: "sftpResume",
                        operationId: id,
                        recoveryId: review.id,
                        overwriteConfirmed: resumeOverwrite,
                      });
                      if (ticket === null || !canContinue(id)) return;
                      await resumeSftp(connectionId, review.id, resumeOverwrite, id, ticket);
                      if (mounted.current) {
                        setReview(undefined);
                        setResumeOverwrite(false);
                        setStatus(t("Transfer completed"));
                      }
                    })
                  }
                >
                  {t("Resume")}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setReview(undefined)}>
                  {t("Close")}
                </Button>
              </div>
            </Text>
          ) : null}
          {loaded ? (
            <SearchInput
              appearance="field"
              aria-label={t("Search remote files")}
              placeholder={t("Search remote files")}
              value={fileSearch}
              onChange={(event) => setFileSearch(event.target.value)}
            />
          ) : (
            <EmptyState size="inline" description={t("Open a directory to browse files.")} />
          )}
          <div className="max-h-[55dvh] min-h-0 overflow-auto" aria-label={t("Remote files")}>
            {visibleEntries.map((entry) => (
              <Text
                key={entry.name}
                as="div"
                tone="inherit"
                className="flex items-center gap-2 border-b border-stroke py-1.5"
              >
                {entry.kind === "directory" ? (
                  <Folder className="icon-sm shrink-0" />
                ) : (
                  <File className="icon-sm shrink-0" />
                )}
                {entry.kind === "directory" ? (
                  <Button
                    variant="item"
                    className="min-w-0 flex-1 justify-start"
                    disabled={busy}
                    onClick={() => {
                      try {
                        void load(sftpPath(path, entry.name));
                      } catch (reason) {
                        setError(String(reason));
                      }
                    }}
                  >
                    <OverflowTooltip label={entry.name}>
                      <Text size="inherit" tone="inherit" truncate>
                        {entry.name}
                      </Text>
                    </OverflowTooltip>
                  </Button>
                ) : (
                  <OverflowTooltip label={entry.name}>
                    <Text size="inherit" tone="inherit" truncate className="min-w-0 flex-1">
                      {entry.name}
                    </Text>
                  </OverflowTooltip>
                )}
                {entry.kind === "symlink" ? (
                  <Text size="inherit" tone="muted">
                    {t("Symlink; not followed")}
                  </Text>
                ) : entry.kind === "file" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    disabled={busy}
                    label={`${t("Download")} ${entry.name}`}
                    onClick={() =>
                      void act(async (id) => {
                        const destination = await save({
                          defaultPath: entry.name,
                          title: t("Download to a new filename"),
                        });
                        if (!destination || !canContinue(id)) return;
                        const remotePath = sftpPath(path, entry.name);
                        const ticket = await approve({
                          kind: "sftpDownload",
                          operationId: id,
                          remotePath,
                          localPath: destination,
                        });
                        if (ticket === null || !canContinue(id)) return;
                        await downloadSftp(connectionId, remotePath, destination, id, ticket);
                        if (mounted.current) setStatus(t("Downloaded"));
                      })
                    }
                  >
                    <Download className="icon-sm" />
                  </Button>
                ) : null}
              </Text>
            ))}
            {loaded && !entries.length ? (
              <EmptyState size="inline" description={t("Empty directory")} />
            ) : null}
            {loaded && entries.length > 0 && visibleEntries.length === 0 ? (
              <EmptyState
                size="inline"
                kind="filtered"
                description={t("No matching files.")}
                onReset={() => setFileSearch("")}
              />
            ) : null}
          </div>
          <Text as="p" tone="muted">
            {t(
              "SFTP uses trusted OpenSSH keys or your agent. Downloads require a new local filename. Uploads require replacement consent. Interrupted transfers keep owned partials for explicit content-verified recovery. Symlink entries are not opened automatically.",
            )}
          </Text>
        </div>
      </Modal>
      {proxy.dialog}
    </>
  );
}
