import { useEffect, useRef, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { t } from "../../../shared/i18n";
import { inspectSshCertificate, type SshCertificateMetadata } from "../model/sshCertificate";

export function SshCertificateInspection({
  reference,
  disabled = false,
}: {
  reference: string;
  disabled?: boolean;
}) {
  const current = useRef({ reference, revision: 0 });
  if (current.current.reference !== reference)
    current.current = { reference, revision: current.current.revision + 1 };
  const mounted = useRef(true),
    pending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ revision: number; metadata: SshCertificateMetadata }>();
  const [error, setError] = useState<number>();
  const revision = current.current.revision;
  const metadata = result?.revision === revision ? result.metadata : undefined;
  return (
    <div className="flex flex-col gap-2 text-xs">
      <div>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled || busy || !reference.trim()}
          loading={busy}
          onClick={async () => {
            if (pending.current || disabled || !reference.trim()) return;
            pending.current = true;
            setBusy(true);
            setError(undefined);
            setResult(undefined);
            const requested = current.current.revision;
            try {
              const metadata = await inspectSshCertificate(reference);
              if (mounted.current && current.current.revision === requested)
                setResult({ revision: requested, metadata });
            } catch {
              if (mounted.current && current.current.revision === requested) setError(requested);
            } finally {
              pending.current = false;
              if (mounted.current) setBusy(false);
            }
          }}
        >
          {t("Inspect certificate")}
        </Button>
      </div>
      {error === revision ? (
        <p role="alert" className="text-(--ui-tone-danger-fg)">
          {t("Couldn’t inspect the public SSH certificate.")}
        </p>
      ) : null}
      {metadata ? (
        <details>
          <summary className="cursor-pointer text-(--ui-text-muted)">
            {t("Certificate details")}
          </summary>
          <p className="mbs-2 text-(--ui-text-muted)">
            {t("Inspection does not establish trust or enroll this certificate.")}
          </p>
          <dl className="mbs-2 grid min-w-0 grid-cols-[minmax(0,40%)_minmax(0,1fr)] gap-x-3 gap-y-1 break-all">
            <dt className="text-(--ui-text-muted)">{t("Certificate type")}</dt>
            <dd>{metadata.certificateType}</dd>
            <dt className="text-(--ui-text-muted)">{t("Fingerprint")}</dt>
            <dd>{metadata.fingerprint}</dd>
            {metadata.signingCaFingerprint ? (
              <>
                <dt className="text-(--ui-text-muted)">{t("Signing CA fingerprint")}</dt>
                <dd>{metadata.signingCaFingerprint}</dd>
              </>
            ) : null}
            <dt className="text-(--ui-text-muted)">{t("Serial")}</dt>
            <dd>{metadata.serial}</dd>
            <dt className="text-(--ui-text-muted)">{t("Validity")}</dt>
            <dd>{metadata.validity}</dd>
            <dt className="text-(--ui-text-muted)">{t("Principals")}</dt>
            <dd>{metadata.principals.length ? metadata.principals.join(", ") : "—"}</dd>
          </dl>
        </details>
      ) : null}
    </div>
  );
}
