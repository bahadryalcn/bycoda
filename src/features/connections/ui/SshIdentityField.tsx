import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { t } from "../../../shared/i18n";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";
import { Folder, RefreshCw } from "../../../shared/ui/icons";

type PublicIdentity = {
  identityFile?: string;
  keyType: string;
  fingerprint: string;
};

const identityName = (path: string) => path.split(/[\\/]/).pop() || path;

/** Select public metadata only; private key material stays in OpenSSH. */
export function SshIdentityField({
  value,
  onChange,
  disabled,
  label = t("Choose SSH key"),
  pathLabel = t("Identity file"),
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  pathLabel?: string;
}) {
  const [keys, setKeys] = useState<PublicIdentity[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selecting, setSelecting] = useState(false);
  const [pickerError, setPickerError] = useState(false);
  const [pathOpen, setPathOpen] = useState(false);
  const picking = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    void invoke<PublicIdentity[]>("ssh_public_keys_list").then(
      (result) => {
        if (current) {
          setKeys(result);
          setLoading(false);
        }
      },
      () => {
        if (current) {
          setFailed(true);
          setLoading(false);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [attempt]);
  const refreshKeys = () => {
    setLoading(true);
    setFailed(false);
    setAttempt((previous) => previous + 1);
  };
  const selectedKey = keys.find((key) => key.identityFile === value);
  const options = [
    ...new Map(
      keys
        .flatMap((key) =>
          key.identityFile
            ? [
                {
                  value: key.identityFile,
                  label: identityName(key.identityFile),
                  description: `${key.identityFile} · ${key.keyType} · ${key.fingerprint}`,
                },
              ]
            : [],
        )
        .map((option) => [option.value, option] as const),
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
  if (value && !options.some((option) => option.value === value)) {
    options.unshift({ value, label: identityName(value), description: value });
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-ui-caption font-medium text-content">{t("SSH key")}</span>
        <Button
          variant="ghost"
          iconOnly
          label={`${t("Refresh SSH keys")}: ${pathLabel}`}
          tooltip={t("Refresh SSH keys")}
          loading={loading}
          disabled={disabled || selecting || loading}
          onClick={refreshKeys}
        >
          <RefreshCw aria-hidden className="icon-sm" />
        </Button>
      </div>
      <SearchableSelect
        hideLabel
        label={label}
        searchPlaceholder={t("Search SSH keys…")}
        value={value}
        onChange={(next) => {
          setPickerError(false);
          onChange(next);
        }}
        disabled={disabled || selecting}
        loading={loading}
        placeholder={loading ? t("Loading…") : t("SSH agent and default keys")}
        options={[{ value: "", label: t("SSH agent and default keys") }, ...options]}
      />
      {value ? <p className="break-all text-ui-caption text-(--ui-text-muted)">{value}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          aria-label={`${t("Choose key file…")}: ${pathLabel}`}
          disabled={disabled}
          loading={selecting}
          onClick={async () => {
            if (disabled || picking.current) return;
            picking.current = true;
            setSelecting(true);
            setPickerError(false);
            try {
              const path = await open({
                title: t("Choose private SSH key"),
                directory: false,
                multiple: false,
                ...(value.startsWith("/") ||
                value.startsWith("\\\\") ||
                /^[A-Za-z]:[\\/]/.test(value)
                  ? { defaultPath: value }
                  : {}),
              });
              if (mounted.current && typeof path === "string") onChange(path);
            } catch {
              if (mounted.current) setPickerError(true);
            } finally {
              picking.current = false;
              if (mounted.current) setSelecting(false);
            }
          }}
        >
          <Folder aria-hidden className="icon-sm" />
          {t("Choose key file…")}
        </Button>
        {value ? (
          <Button
            variant="ghost"
            disabled={disabled || selecting}
            onClick={() => {
              setPickerError(false);
              onChange("");
            }}
          >
            {t("Use SSH defaults")}
          </Button>
        ) : null}
      </div>
      {pickerError ? (
        <Alert tone="danger">
          {t("Could not open the file picker. Enter a key path or try again.")}
        </Alert>
      ) : null}
      {failed ? (
        <Alert tone="danger">
          {t("Could not load SSH keys. Enter a path or retry.")}
          <Button disabled={disabled || selecting || loading} onClick={refreshKeys}>
            {t("Retry")}
          </Button>
        </Alert>
      ) : null}
      <Disclosure
        size="sm"
        open={pathOpen || failed || pickerError}
        onOpenChange={setPathOpen}
        className="text-ui-caption text-(--ui-text-muted)"
        summary={t("Use a key file path")}
      >
        <TextField
          label={pathLabel}
          aria-label={pathLabel}
          value={value}
          maxLength={4096}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled || selecting}
          description={t("Leave empty to use your SSH agent and default identities.")}
        />
      </Disclosure>
      {selectedKey ? (
        <DescriptionList size="sm" className="text-ui-caption text-(--ui-text-muted)">
          <DescriptionItem term={t("Key type")}>{selectedKey.keyType}</DescriptionItem>
          <DescriptionItem term={t("Fingerprint")}>{selectedKey.fingerprint}</DescriptionItem>
        </DescriptionList>
      ) : null}
    </div>
  );
}
