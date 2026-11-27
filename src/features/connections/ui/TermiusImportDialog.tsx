import { Sheet } from "../../../shared/ui/Sheet";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { Check, KeyRound } from "../../../shared/ui/icons";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { ModalActions } from "../../../shared/ui/Modal";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { TextField } from "../../../shared/ui/TextField";
import type { ServerRecord } from "../model/serverInventory";
import { refreshServerInventory } from "../model/serverInventory";
import {
  termiusDuplicate,
  termiusText,
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
  const [importMessage, setImportMessage] = useState<string>();
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
    setImportMessage(undefined);
    try {
      const profile =
        source === "folder"
          ? await open({
              directory: true,
              multiple: false,
              title: t("Choose Termius folder"),
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
        setImportMessage(
          typeof cause === "string"
            ? termiusText(cause)
            : t("Could not read Termius. Close Termius and try again."),
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const scanDefaultLocation = useEffectEvent(() => {
    void scan("automatic");
  });
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- scans the external Termius store once when the dialog opens
  useEffect(() => {
    scanDefaultLocation();
  }, []);
  const apply = async () => {
    if (pending.current || !preview || !selected.size) return;
    pending.current = true;
    setBusy(true);
    setImportMessage(undefined);
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
        setImportMessage(
          typeof cause === "string"
            ? termiusText(cause)
            : t("Could not import Termius records. Try again."),
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
    <Sheet
      title={t("Import from Termius")}
      size="lg"
      onClose={() => {
        if (!pending.current) onClose();
      }}
      footer={
        <ModalActions>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {outcome ? t("Done") : t("Cancel")}
          </Button>
          {preview && !outcome ? (
            <Button
              loading={busy}
              disabled={busy || !selected.size}
              disabledReason={selected.size ? undefined : t("Select at least one entry.")}
              onClick={() => void apply()}
            >
              {t("Import selected ({p0})", { p0: selected.size })}
            </Button>
          ) : null}
        </ModalActions>
      }
    >
      <div className="flex min-h-0 flex-col gap-3">
        {busy && !preview && !importMessage ? (
          <LoadingText>{t("Scanning this computer…")}</LoadingText>
        ) : null}
        <Disclosure summary={t("Other location…")} size="sm" defaultOpen={!!importMessage}>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => void scan("automatic")}>
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
              <Button
                type="submit"
                variant="secondary"
                disabled={busy || !profilePath.trim()}
                disabledReason={busy ? t("Wait for the current action to finish.") : undefined}
              >
                {t("Scan profile folder")}
              </Button>
            </form>
          </div>
        </Disclosure>
        {importMessage ? <Alert tone="danger">{importMessage}</Alert> : null}
        {outcome ? (
          <Alert tone="success">
            {t("Imported {p0} servers. Skipped {p1} existing records. Saved {p2} SSH keys.", {
              p0: outcome.imported,
              p1: outcome.skipped,
              p2: outcome.keys,
            })}
          </Alert>
        ) : preview ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Checkbox
                checked={allSelected}
                indeterminate={selected.size > 0 && !allSelected}
                disabled={busy || !eligible.length}
                onChange={() =>
                  setSelected(
                    allSelected ? new Set() : new Set(eligible.map((host) => host.sourceId)),
                  )
                }
                label={t("Select all")}
                size="body"
                className="flex items-center gap-2"
              />
            </div>
            <SearchInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("Search servers")}
              aria-label={t("Search servers")}
            />
            <div
              {...surfaceAttributes({ dividers: "card" }, "max-h-[45dvh] min-h-0 overflow-y-auto")}
              aria-label={t("Termius records")}
            >
              {visible.map((host) => {
                const duplicate = termiusDuplicate(host, servers);
                const review = termiusNeedsReview(host);
                return (
                  <div key={host.sourceId} className="flex items-start gap-3 py-3">
                    <Checkbox
                      aria-label={t("Import {p0}", { p0: host.name })}
                      aria-description={duplicate ? t("Already in Servers") : undefined}
                      className="mt-1 shrink-0"
                      disabled={busy || duplicate || review}
                      disabledReason={
                        busy
                          ? t("Wait for the current action to finish.")
                          : duplicate
                            ? t("Already in Servers")
                            : review
                              ? t("Review this record in Termius before importing it.")
                              : undefined
                      }
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
                    <Text as="div" size="body" tone="inherit" className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <Text
                          as="span"
                          size="inherit"
                          tone="inherit"
                          weight="medium"
                          className="break-words"
                        >
                          {host.name}
                        </Text>
                        {duplicate ? (
                          <Tooltip label={t("Already in Servers")}>
                            <Check aria-hidden className="icon-sm" tone="success" />
                          </Tooltip>
                        ) : host.hasKey ? (
                          <Tooltip label={t("SSH key available")}>
                            <KeyRound aria-hidden className="icon-sm" tone="muted" />
                          </Tooltip>
                        ) : null}
                      </div>
                      <Text wrap="anywhere" as="p" tone="muted">
                        {host.endpoint.user ? `${host.endpoint.user}@` : ""}
                        {host.endpoint.host}:{host.endpoint.port}
                      </Text>
                      <BadgeList
                        label={t("Tags")}
                        size="xs"
                        max={4}
                        className="mt-1"
                        items={[host.group ?? "", ...host.tags]
                          .filter(Boolean)
                          .map((label, index) => ({ id: `${index}:${label}`, label }))}
                      />
                      {host.warnings.length ? (
                        <Text
                          as="ul"
                          size="caption"
                          tone="muted"
                          className="mt-1 list-inside list-disc"
                        >
                          {host.warnings.map((warning, i) => (
                            <li key={i}>{termiusText(warning)}</li>
                          ))}
                        </Text>
                      ) : null}
                    </Text>
                  </div>
                );
              })}
              {!visible.length ? (
                <EmptyState
                  size="inline"
                  kind="filtered"
                  description={t("No matching servers")}
                  onReset={() => setQuery("")}
                />
              ) : null}
            </div>
            {preview.hosts.some((host) => host.hasKey) ? (
              <Checkbox
                checked={importKeys}
                disabled={busy}
                onChange={(event) => setImportKeys(event.target.checked)}
                label={t("Import linked SSH keys into private local files")}
                size="body"
                className="flex items-center gap-2"
              />
            ) : null}
            {preview.warnings.map((warning, i) => (
              <Alert key={i} tone="warning">
                {termiusText(warning)}
              </Alert>
            ))}
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
