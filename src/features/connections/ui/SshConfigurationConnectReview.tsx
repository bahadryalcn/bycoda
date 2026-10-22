import { useEffect, useRef, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import { Alert } from "../../../shared/ui/Alert";
import { t } from "../../../shared/i18n";
import { previewSshConfiguration, type SshConfigurationPreview } from "../model/sshGroupDefaults";
import { sshEndpointPreview, validSshEndpointPreview } from "../model/sshEndpointReview";
import type { ServerRecord } from "../model/serverInventory";

/** Only an explicit click creates a new terminal; native launch rechecks this digest. */
export function SshConfigurationConnectReview({
  server,
  onConnect,
  onClose,
}: {
  server: ServerRecord;
  onConnect: (digest: string) => void;
  onClose: () => void;
}) {
  const [review, setReview] = useState<SshConfigurationPreview>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const used = useRef(false);
  const target = JSON.stringify([server.id, server.sshEndpoint, server.metadata.sshInheritance]);
  const [scope, setScope] = useState(target);
  if (scope !== target) {
    setScope(target);
    setReview(undefined);
    setError("");
  }
  useEffect(() => {
    let current = true;
    used.current = false;
    setReview(undefined);
    setError("");
    void previewSshConfiguration(server.id, null, true)
      .then((result) => {
        if (!current) return;
        if (
          result.connectionId !== server.id ||
          !/^[a-f0-9]{64}$/.test(result.configuration?.digest ?? "") ||
          !validSshEndpointPreview(result.configuration.endpoint)
        ) {
          throw new Error(t("Couldn’t review the SSH configuration."));
        }
        setReview(result);
      })
      .catch((reason) => {
        if (current) setError(String(reason));
      });
    return () => {
      current = false;
    };
  }, [server.id, target, revision]);
  const configuration = scope === target ? review?.configuration : undefined;
  return (
    <Modal title={t("Review SSH configuration")} onClose={onClose} size="sm">
      <div className="flex min-w-0 flex-col gap-3 p-4">
        {configuration ? (
          <>
            <p className="break-all text-sm font-medium">
              {sshEndpointPreview(configuration.endpoint)}
            </p>
            <dl className="grid min-w-0 grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
              {(
                [
                  ["user", t("SSH user"), configuration.endpoint.user ?? t("Default")],
                  ["port", t("SSH port"), String(configuration.endpoint.port)],
                  [
                    "identityFile",
                    t("Identity file"),
                    configuration.endpoint.identityFile ?? t("Default"),
                  ],
                  [
                    "certificateFile",
                    t("Public SSH certificate file"),
                    configuration.endpoint.certificateFile ?? t("Default"),
                  ],
                ] as const
              ).map(([field, label, value]) => (
                <div key={field} className="contents">
                  <dt className="text-(--ui-text-muted)">{label}</dt>
                  <dd className="min-w-0 break-all">
                    {value}
                    {!(
                      value === t("Default") &&
                      configuration.provenance[field]?.source === "default"
                    ) && (
                      <span className="ms-2 text-(--ui-text-muted)">
                        {configuration.provenance[field]?.source === "group"
                          ? `${t("Group")} · ${configuration.provenance[field].groupId} · ${configuration.provenance[field].revision}`
                          : configuration.provenance[field]?.source === "default"
                            ? t("Default")
                            : t("Connection")}
                      </span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            {configuration.environment.length ? (
              <details className="text-xs">
                <summary className="cursor-pointer py-1">{t("Remote environment")}</summary>
                <dl className="mbs-2 flex flex-col gap-2">
                  {configuration.environment.map((entry) => (
                    <div key={entry.name}>
                      <dt className="text-(--ui-text-muted)">{entry.name}</dt>
                      <dd className="break-all">{entry.value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mbs-2 text-(--ui-text-muted)">
                  {t("These literal values apply only to this new SSH terminal.")}
                </p>
              </details>
            ) : null}
          </>
        ) : error ? (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        ) : (
          <p role="status" className="text-xs text-(--ui-text-muted)">
            {t("Loading…")}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          {error ? (
            <Button onClick={() => setRevision((value) => value + 1)}>{t("Retry")}</Button>
          ) : null}
          <Button
            variant="primary"
            disabled={!configuration}
            onClick={() => {
              if (!configuration || used.current) return;
              used.current = true;
              onConnect(configuration.digest);
            }}
          >
            {t("Connect")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
