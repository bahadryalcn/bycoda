import { useEffect, useRef, useState } from "react";
import { openExternal } from "../../../platform/tauri/openExternal";
import { copyText } from "../../../platform/tauri/clipboard";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Text } from "../../../shared/ui/Text";
import { Check, Copy, Star } from "../../../shared/ui/icons";
import { startContribution, useContributeFlow } from "../../projects/public/contribute";
import { Row, SettingsFeedback } from "./settingsControls";

function ContributeRow() {
  const flow = useContributeFlow();
  const repositoryUrl = PRODUCT_IDENTITY.repositoryUrl;
  if (!repositoryUrl) return null;
  return (
    <>
      <Row
        id="star-github"
        label={t("Star on GitHub")}
        description={t("Open the project repository on GitHub.")}
      >
        <Button
          className="general-action shrink-0"
          startIcon={<Star strokeWidth={1.75} aria-hidden />}
          onClick={() => void openExternal(repositoryUrl).catch(() => undefined)}
        >
          {t("View on GitHub")}
        </Button>
      </Row>
      <Row
        id="contribute"
        label={t("Contribute to bycoda")}
        description={t("Clone the open-source repository and open it as a project.")}
      >
        <Button
          className="general-action shrink-0"
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
        <Text
          as="span"
          size="secondary"
          tone="primary"
          leading="normal"
          className="general-about-value"
        >
          {PRODUCT_IDENTITY.developerName}
        </Text>
      </Row>
      <ProductLink
        label={t("Website")}
        address={PRODUCT_IDENTITY.websiteUrl}
        href={PRODUCT_IDENTITY.websiteUrl}
        displayAddress={PRODUCT_IDENTITY.websiteUrl.replace("https://", "")}
        openLabel={t("Open website")}
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
  label,
  address,
  href,
  displayAddress = address,
  openLabel,
}: {
  label: string;
  address: string;
  href: string;
  displayAddress?: string;
  openLabel?: string;
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
      label={label}
      feedback={
        failure ? (
          <SettingsFeedback
            state="error"
            action={
              <div ref={recoveryActions} className="flex flex-wrap items-center gap-2">
                {failure === "open" ? (
                  <Button
                    disabled={pending !== null}
                    loading={pending === "retry"}
                    loadingLabel={t("Opening…")}
                    onClick={() => run("retry").catch(() => undefined)}
                  >
                    {t("Retry")}
                  </Button>
                ) : null}
                <Button
                  disabled={pending !== null}
                  loading={pending === "copy"}
                  loadingLabel={t("Copying…")}
                  aria-label={`${t("Copy")}: ${address}`}
                  onClick={() => run("copy").catch(() => undefined)}
                >
                  {t("Copy")}
                </Button>
              </div>
            }
          >
            <p>
              {failure === "open"
                ? t("Could not open the link. Copy the address and open it manually.")
                : t("Could not copy. Select the details and copy them manually.")}
            </p>
            <span className="select-text break-all">{address}</span>
          </SettingsFeedback>
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
      {openLabel ? (
        <Button
          size="sm"
          disabled={pending !== null}
          loading={pending === "open"}
          loadingLabel={t("Opening…")}
          onClick={() => run("open").catch(() => undefined)}
        >
          {openLabel}
        </Button>
      ) : null}
      <span role="status" className="sr-only">
        {copied ? t("Copied") : ""}
      </span>
    </Row>
  );
}
