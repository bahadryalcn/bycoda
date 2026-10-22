import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Modal } from "../../../shared/ui/Modal";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { TextField } from "../../../shared/ui/TextField";
import type { ServerRecord } from "../model/serverInventory";
import { refreshServerInventory } from "../model/serverInventory";
import {
  termiusDuplicate,
  termiusNeedsReview,
  type TermiusPreview,
  type TermiusOutcome,
} from "../model/termiusImport";

export function TermiusImportDialog({
  servers,
  onClose,
}: {
  servers: ServerRecord[];
  onClose: () => void;
}) {
  useLocale();
  const [preview, setPreview] = useState<TermiusPreview>();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [profilePath, setProfilePath] = useState("");
  const [importKeys, setImportKeys] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [outcome, setOutcome] = useState<TermiusOutcome>();
  const pending = useRef(false);
  const ticket = useRef<string | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (ticket.current)
        void invoke("termius_import_forget", { ticket: ticket.current }).catch(() => {});
    };
  }, []);

  const scan = async (source: "automatic" | "folder" | "path") => {
    if (pending.current || (source === "path" && !profilePath.trim())) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const profile =
        source === "folder"
          ? await open({
              directory: true,
              multiple: false,
              title: t("Choose Termius profile folder"),
            })
          : source === "path"
            ? profilePath.trim()
            : null;
      if (source === "folder" && !profile) return;
      if (profile) setProfilePath(profile);
      if (ticket.current) await invoke("termius_import_forget", { ticket: ticket.current });
      ticket.current = undefined;
      setPreview(undefined);
      setOutcome(undefined);
      setSelected(new Set());
      const next = await invoke<TermiusPreview>("termius_import_preview", { profile });
      if (!mounted.current) {
        await invoke("termius_import_forget", { ticket: next.ticket });
        return;
      }
      ticket.current = next.ticket;
      setPreview(next);
      setSelected(
        new Set(
          next.hosts
            .filter((host) => !termiusDuplicate(host, servers) && !termiusNeedsReview(host))
            .map((host) => host.sourceId),
        ),
      );
    } catch (cause) {
      if (mounted.current)
        setError(
          typeof cause === "string"
            ? cause
            : t("Could not read Termius. Close Termius and try again."),
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const apply = async () => {
    if (pending.current || !preview || !selected.size) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const result = await invoke<TermiusOutcome>("termius_import_apply", {
        ticket: preview.ticket,
        sourceIds: [...selected],
        importKeys,
      });
      ticket.current = undefined;
      refreshServerInventory();
      if (mounted.current) {
        setOutcome(result);
        setSelected(new Set());
      }
    } catch (cause) {
      if (mounted.current)
        setError(
          typeof cause === "string" ? cause : t("Could not import Termius records. Try again."),
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const eligible =
    preview?.hosts.filter(
      (host) => !termiusDuplicate(host, servers) && !termiusNeedsReview(host),
    ) ?? [];
  const needle = query.trim().toLocaleLowerCase();
  const visible =
    preview?.hosts.filter((host) =>
      `${host.name} ${host.endpoint.host} ${host.group ?? ""} ${host.tags.join(" ")}`
        .toLocaleLowerCase()
        .includes(needle),
    ) ?? [];
  const allSelected = eligible.length > 0 && eligible.every((host) => selected.has(host.sourceId));

  return (
    <Modal
      title={t("Import from Termius")}
      size="lg"
      onClose={() => {
        if (!pending.current) onClose();
      }}
    >
      <div className="flex min-h-0 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            loading={busy && !preview}
            disabled={busy}
            onClick={() => void scan("automatic")}
          >
            {t("Scan this computer")}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void scan("folder")}>
            {t("Choose profile folder")}
          </Button>
        </div>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void scan("path");
          }}
        >
          <TextField
            label={t("Termius profile path")}
            fieldClassName="min-w-0 flex-1 basis-64"
            value={profilePath}
            onChange={(event) => setProfilePath(event.target.value)}
            placeholder="~/Library/Application Support/Termius"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
          />
          <Button type="submit" variant="secondary" disabled={busy || !profilePath.trim()}>
            {t("Scan profile folder")}
          </Button>
        </form>
        {!preview ? (
          <p className="text-sm text-(--ui-text-muted)">
            {t("Read local Termius records without changing Termius data.")}
          </p>
        ) : null}
        {error ? (
          <Alert tone="danger" role="alert">
            {t(error)}
          </Alert>
        ) : null}
        {outcome ? (
          <Alert tone="success" role="status">
            {t("Imported {p0} servers. Skipped {p1} existing records. Saved {p2} SSH keys.", {
              p0: outcome.imported,
              p1: outcome.skipped,
              p2: outcome.keys,
            })}
          </Alert>
        ) : preview ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={allSelected}
                  indeterminate={selected.size > 0 && !allSelected}
                  disabled={busy || !eligible.length}
                  onChange={() =>
                    setSelected(
                      allSelected ? new Set() : new Set(eligible.map((host) => host.sourceId)),
                    )
                  }
                />
                {t("Select all")}
              </label>
              <span className="text-xs text-(--ui-text-muted)" role="status">
                {t("{p0} of {p1} selected", { p0: selected.size, p1: preview.hosts.length })}
              </span>
            </div>
            <SearchInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("Search servers")}
              aria-label={t("Search servers")}
            />
            <div
              className="max-h-[45dvh] min-h-0 overflow-y-auto divide-y divide-(--ui-border)"
              aria-label={t("Termius records")}
            >
              {visible.map((host) => {
                const duplicate = termiusDuplicate(host, servers);
                const review = termiusNeedsReview(host);
                return (
                  <div key={host.sourceId} className="flex items-start gap-3 py-3">
                    <Checkbox
                      aria-label={t("Import {p0}", { p0: host.name })}
                      className="mt-1 shrink-0"
                      disabled={busy || duplicate || review}
                      checked={selected.has(host.sourceId)}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setSelected((old) => {
                          const next = new Set(old);
                          if (checked) next.add(host.sourceId);
                          else next.delete(host.sourceId);
                          return next;
                        });
                      }}
                    />
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="break-words font-medium">{host.name}</span>
                        {duplicate ? (
                          <span className="text-xs text-(--ui-text-muted)">
                            {t("Already in Servers")}
                          </span>
                        ) : host.hasKey ? (
                          <span className="text-xs text-(--ui-text-muted)">
                            {t("SSH key available")}
                          </span>
                        ) : null}
                      </div>
                      <p className="break-all text-xs text-(--ui-text-muted)">
                        {host.endpoint.user ? `${host.endpoint.user}@` : ""}
                        {host.endpoint.host}:{host.endpoint.port}
                      </p>
                      {host.group || host.tags.length ? (
                        <p className="break-words text-xs text-(--ui-text-muted)">
                          {[host.group, ...host.tags].filter(Boolean).join(" · ")}
                        </p>
                      ) : null}
                      {host.warnings.length ? (
                        <details className="mt-1 text-xs text-(--ui-text-muted)">
                          <summary>
                            {review ? t("Review required") : t("Migration details")}
                          </summary>
                          <ul className="mt-1 list-inside list-disc">
                            {host.warnings.map((warning, i) => (
                              <li key={i}>{t(warning)}</li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {!visible.length ? (
                <p className="py-4 text-sm text-(--ui-text-muted)">{t("No matching servers")}</p>
              ) : null}
            </div>
            {preview.hosts.some((host) => host.hasKey) ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={importKeys}
                  disabled={busy}
                  onChange={(event) => setImportKeys(event.target.checked)}
                />
                {t("Import linked SSH keys into private local files")}
              </label>
            ) : null}
            <details className="text-xs text-(--ui-text-muted)">
              <summary>{t("What gets imported")}</summary>
              <p className="mt-1">
                {t(
                  "Names, addresses, users, ports, groups and tags. Existing records are preserved.",
                )}
              </p>
              {preview.warnings.map((warning, i) => (
                <p key={i} className="mt-1">
                  {t(warning)}
                </p>
              ))}
            </details>
          </>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2 border-t border-(--ui-border) pt-3">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {outcome ? t("Done") : t("Cancel")}
          </Button>
          {preview && !outcome ? (
            <Button loading={busy} disabled={busy || !selected.size} onClick={() => void apply()}>
              {t("Import selected ({p0})", { p0: selected.size })}
            </Button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
