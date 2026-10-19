import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../../../shared/i18n";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { Alert } from "../../../shared/ui/Alert";

type PublicIdentity = { identityFile?: string; keyType: string; fingerprint: string };

/** Select public metadata only; private key material stays in OpenSSH. */
export function SshIdentityField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [keys, setKeys] = useState<PublicIdentity[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
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
  const options = keys.flatMap((key) =>
    key.identityFile
      ? [
          {
            value: key.identityFile,
            label: key.identityFile,
            description: `${key.keyType} · ${key.fingerprint}`,
          },
        ]
      : [],
  );
  if (value && !options.some((option) => option.value === value)) {
    options.unshift({ value, label: value, description: t("Identity file") });
  }
  return (
    <>
      <SearchableSelect
        label={t("Choose SSH key")}
        value={value}
        onChange={onChange}
        disabled={disabled || loading || failed}
        placeholder={loading ? t("Loading…") : t("SSH agent and default keys")}
        options={[{ value: "", label: t("SSH agent and default keys") }, ...options]}
      />
      {failed ? (
        <Alert tone="danger" role="alert">
          {t("Could not load SSH keys. Enter a path or retry.")}
          <Button
            disabled={disabled}
            onClick={() => {
              setLoading(true);
              setFailed(false);
              setAttempt((previous) => previous + 1);
            }}
          >
            {t("Retry")}
          </Button>
        </Alert>
      ) : null}
      <TextField
        label={t("Identity file")}
        value={value}
        maxLength={4096}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        description={t("Leave empty to use your SSH agent and default identities.")}
      />
    </>
  );
}
