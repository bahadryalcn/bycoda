import { useEffect, useRef, useState } from "react";
import { openExternal } from "../../../platform/tauri/openExternal";
import { copyText } from "../../../platform/tauri/clipboard";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Text } from "../../../shared/ui/Text";
import { Check, Copy } from "../../../shared/ui/icons";
import { startContribution, useContributeFlow } from "../../projects/public/contribute";
import { Row, SettingsFeedback } from "../../../shared/ui/settings";

function ContributeRow() {
  const flow = useContributeFlow();
  const repositoryUrl = PRODUCT_IDENTITY.repositoryUrl;
  if (!repositoryUrl) return null;
  return (
    <>
      <ProductLink
        id="star-github"
        label={t("Star on GitHub")}
        address={repositoryUrl}
        href={repositoryUrl}
        displayAddress={repositoryUrl.replace(/^https:\/\/github\.com\//, "")}
      />
      <Row
        id="contribute"
        label={t("Contribute to bycoda")}
        description={t("Clone the open-source repository and open it as a project.")}
      >
        <Button
          loading={flow.status === "cloning"}
          onClick={() => startContribution().catch(() => undefined)}
        >
          {t("Clone and open…")}
        </Button>
      </Row>
    </>
  );
}

export function ProductDetails() {
  return (
    <>
      <Row label={t("Developed by")}>
        <Text as="span" size="secondary" tone="primary" leading="normal">
          {PRODUCT_IDENTITY.developerName}
        </Text>
      </Row>
      <ProductLink
        label={t("Website")}
        address={PRODUCT_IDENTITY.websiteUrl}
        href={PRODUCT_IDENTITY.websiteUrl}
        displayAddress={PRODUCT_IDENTITY.websiteUrl.replace("https://", "")}
      />
      <ProductLink
        label={t("Contact")}
        address={PRODUCT_IDENTITY.contactEmail}
        href={`mailto:${PRODUCT_IDENTITY.contactEmail}`}
      />
      <ProductLink
        label={t("Developer contact")}
        address={PRODUCT_IDENTITY.developerContactEmail}
        href={`mailto:${PRODUCT_IDENTITY.developerContactEmail}`}
      />
      <ContributeRow />
    </>
  );
}

/** Each target owns its pending/error recovery; opening a link never sends a message. */
function ProductLink({
  id,
  label,
  address,
  href,
  displayAddress = address,
}: {
  id?: string;
  label: string;
  address: string;
  href: string;
  displayAddress?: string;
}) {
  const [pending, setPending] = useState<"open" | "retry" | "copy" | null>(null);
  const [failure, setFailure] = useState<"open" | "copy" | null>(null);
  const [copied, setCopied] = useState(false);
  const inFlight = useRef(false);
  const linkControl = useRef<HTMLButtonElement>(null);
  const recoveryActions = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (pending !== null || failure !== null || !returnFocus.current) return;
    returnFocus.current = false;
    linkControl.current?.focus();
  }, [pending, failure]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const run = async (operation: "open" | "retry" | "copy") => {
    if (inFlight.current) return;
    inFlight.current = true;
    const beganInRecovery = Boolean(recoveryActions.current?.contains(document.activeElement));
    returnFocus.current = false;
    setPending(operation);
    setCopied(false);
    try {
      if (operation !== "copy") await openExternal(href);
      else {
        await copyText(address);
        setCopied(true);
      }
      // Recovery controls disappear on success; retain focus only if it is still there.
      returnFocus.current =
        beganInRecovery &&
        (document.activeElement === document.body ||
          Boolean(recoveryActions.current?.contains(document.activeElement)));
      setFailure(null);
    } catch {
      setFailure(operation === "copy" ? "copy" : "open");
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  };

  return (
    <Row
      id={id}
      label={label}
      feedback={
        failure ? (
          <div ref={recoveryActions} className="contents">
            <SettingsFeedback
              state="error"
              action={
                failure === "open"
                  ? {
                      label: t("Retry"),
                      disabled: pending !== null,
                      pending: pending === "retry",
                      onClick: () => run("retry").catch(() => undefined),
                    }
                  : {
                      label: t("Copy"),
                      ariaLabel: `${t("Copy")}: ${address}`,
                      disabled: pending !== null,
                      pending: pending === "copy",
                      onClick: () => run("copy").catch(() => undefined),
                    }
              }
              secondaryAction={
                failure === "open"
                  ? {
                      label: t("Copy"),
                      ariaLabel: `${t("Copy")}: ${address}`,
                      disabled: pending !== null,
                      pending: pending === "copy",
                      onClick: () => run("copy").catch(() => undefined),
                    }
                  : undefined
              }
            >
              <p>
                {failure === "open"
                  ? t("Could not open the link. Copy the address and open it manually.")
                  : t("Could not copy. Select the details and copy them manually.")}
              </p>
              <span className="select-text break-all">{address}</span>
            </SettingsFeedback>
          </div>
        ) : undefined
      }
    >
      <Button
        ref={linkControl}
        variant="link"
        className="general-about-link"
        textSize="secondary"
        leading="normal"
        loading={pending === "open"}
        loadingLabel={t("Opening…")}
        disabled={pending !== null}
        tooltip={
          address.replace(/^https?:\/\//, "") === displayAddress.replace(/^https?:\/\//, "")
            ? undefined
            : address
        }
        onClick={() => run("open").catch(() => undefined)}
      >
        {displayAddress}
      </Button>
      {failure ? null : (
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          label={`${t("Copy")}: ${address}`}
          tooltip={copied ? t("Copied") : t("Copy")}
          disabled={pending !== null}
          loading={pending === "copy"}
          onClick={() => run("copy").catch(() => undefined)}
        >
          {copied ? (
            <Check aria-hidden className="icon-xs" strokeWidth={1.75} />
          ) : (
            <Copy aria-hidden className="icon-xs" strokeWidth={1.75} />
          )}
        </Button>
      )}
      <span role="status" className="sr-only">
        {copied ? t("Copied") : ""}
      </span>
    </Row>
  );
}
