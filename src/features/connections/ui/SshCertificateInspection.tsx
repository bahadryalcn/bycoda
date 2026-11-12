import { Text } from "../../../shared/ui/Text";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
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
  const [result, setResult] = useState<{
    revision: number;
    metadata: SshCertificateMetadata;
  }>();
  const [error, setError] = useState<number>();
  const revision = current.current.revision;
  const metadata = result?.revision === revision ? result.metadata : undefined;
  return (
    <Text as="div" tone="inherit" className="flex flex-col gap-2">
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
        <InlineError>{t("Couldn’t inspect the public SSH certificate.")}</InlineError>
      ) : null}
      {metadata ? (
        <Disclosure summary={t("Certificate details")}>
          <Text as="p" size="inherit" tone="muted" className="mbe-2">
            {t("Inspection does not establish trust or enroll this certificate.")}
          </Text>
          <DescriptionList size="sm">
            <DescriptionItem term={t("Certificate type")}>
              {metadata.certificateType}
            </DescriptionItem>
            <DescriptionItem term={t("Fingerprint")}>{metadata.fingerprint}</DescriptionItem>
            {metadata.signingCaFingerprint ? (
              <DescriptionItem term={t("Signing CA fingerprint")}>
                {metadata.signingCaFingerprint}
              </DescriptionItem>
            ) : null}
            <DescriptionItem term={t("Serial")}>{metadata.serial}</DescriptionItem>
            <DescriptionItem term={t("Validity")}>{metadata.validity}</DescriptionItem>
            <DescriptionItem term={t("Principals")}>
              {metadata.principals.length ? metadata.principals.join(", ") : "—"}
            </DescriptionItem>
          </DescriptionList>
        </Disclosure>
      ) : null}
    </Text>
  );
}
