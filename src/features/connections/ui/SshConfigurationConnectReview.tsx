import { Text } from "../../../shared/ui/Text";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
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
    <Modal
      title={t("Review SSH configuration")}
      onClose={onClose}
      size="sm"
      footer={
        <ModalActions>
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
        </ModalActions>
      }
    >
      <div className="flex min-w-0 flex-col gap-3">
        {configuration ? (
          <>
            <Text wrap="anywhere" as="p" size="body" tone="inherit" weight="medium">
              {sshEndpointPreview(configuration.endpoint)}
            </Text>
            <DescriptionList size="sm">
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
                <DescriptionItem key={field} term={label}>
                  {value}
                  {!(
                    value === t("Default") && configuration.provenance[field]?.source === "default"
                  ) && (
                    <Text size="inherit" tone="muted" className="ms-2">
                      {configuration.provenance[field]?.source === "group"
                        ? `${t("Group")} · ${configuration.provenance[field].groupId} · ${configuration.provenance[field].revision}`
                        : configuration.provenance[field]?.source === "default"
                          ? t("Default")
                          : t("Connection")}
                    </Text>
                  )}
                </DescriptionItem>
              ))}
            </DescriptionList>
            {configuration.environment.length ? (
              <Disclosure size="sm" summary={t("Remote environment")}>
                <DescriptionList size="sm">
                  {configuration.environment.map((entry) => (
                    <DescriptionItem key={entry.name} term={entry.name}>
                      {entry.value}
                    </DescriptionItem>
                  ))}
                </DescriptionList>
                <Text as="p" size="inherit" tone="muted" className="mbs-2">
                  {t("These literal values apply only to this new SSH terminal.")}
                </Text>
              </Disclosure>
            ) : null}
          </>
        ) : error ? (
          <Alert tone="danger">{error}</Alert>
        ) : (
          <LoadingText />
        )}
      </div>
    </Modal>
  );
}
