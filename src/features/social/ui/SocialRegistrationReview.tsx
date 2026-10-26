import { useContext, useEffect, useRef, useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { TextField } from "../../../shared/ui/TextField";
import { t, useLocale } from "../../../shared/i18n";
import type {
  SocialBrowserWorkflow,
  SocialRegistrationReview as Review,
} from "../model/socialBrowser";
import type { SocialClient } from "../model/socialClient";
import { SocialBusyContext } from "./socialContext";

/** The owner reviews the observed final form; ordinary continuation remains nonbinding. */
export function SocialRegistrationReview({
  accountId,
  workflow,
  client,
  disabled,
  onRefresh,
}: {
  accountId: string;
  workflow: SocialBrowserWorkflow;
  client: SocialClient;
  disabled?: boolean;
  onRefresh: () => Promise<unknown>;
}) {
  useLocale();
  const locked = useContext(SocialBusyContext);
  const [review, setReview] = useState<Review>();
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState<"review" | "submit" | "reconcile">();
  const [resourceId, setResourceId] = useState("");
  const [error, setError] = useState("");
  const occupied = useRef(false);
  const scope = `${accountId}:${workflow.id}:${workflow.updatedAt}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => {
    setReview(undefined);
    setAccepted(false);
    setError("");
    setResourceId("");
  }, [accountId, workflow.id, workflow.updatedAt, client]);
  const submission = workflow.registrationSubmission;
  useEffect(() => {
    if (!review) return;
    const timer = setTimeout(
      () => {
        setReview(undefined);
        setAccepted(false);
        setError(t("The Page creation review expired. Review the form again before creating it."));
      },
      Math.max(0, review.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [review]);
  const busy = !!pending || disabled || locked;
  const run = async (kind: "review" | "submit" | "reconcile", action: () => Promise<void>) => {
    if (busy || occupied.current) return;
    occupied.current = true;
    setPending(kind);
    setError("");
    try {
      await action();
    } catch {
      setError(
        t(
          "The final registration action could not be verified. Refresh its status and check the same browser window before continuing.",
        ),
      );
    } finally {
      occupied.current = false;
      setPending(undefined);
    }
  };
  if (workflow.platform !== "linkedin" || workflow.intent !== "signup") return null;
  if (submission)
    return (
      <div role="status">
        <p>
          {submission.state === "created"
            ? t(
                "Page creation was verified. Connect the account separately before using Social features.",
              )
            : t(
                "A Page creation attempt is unresolved. Check the same browser window; automatic resubmission is held.",
              )}
        </p>
        {submission.state === "created" && submission.resourceUrl ? (
          <a href={submission.resourceUrl} target="_blank" rel="noreferrer">
            {t("Open created Page")}
          </a>
        ) : null}
        {submission.expectedResourceDigest &&
        (submission.state === "unknown" ||
          (submission.state === "attempting" && workflow.status !== "awaiting_owner")) ? (
          <div>
            <p>
              {t(
                "Verify an existing Page without repeating creation. Its identity must match the original approved Page and administrator.",
              )}
            </p>
            <TextField
              label={t("Existing LinkedIn Page ID")}
              description={t("If sign-in is needed, use Browser workspace to log in, finish or cancel that login action, then verify the existing Page.")}
              value={resourceId}
              inputMode="numeric"
              maxLength={20}
              pattern="[1-9][0-9]{0,19}"
              disabled={busy}
              onChange={(event) => setResourceId(event.target.value)}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={busy || !/^[1-9]\d{0,19}$/.test(resourceId)}
              loading={pending === "reconcile"}
              onClick={() =>
                void run("reconcile", async () => {
                  try {
                    await client.browserRegistrationReconcile(
                      accountId,
                      workflow.id,
                      workflow.updatedAt,
                      resourceId,
                    );
                  } finally {
                    await onRefresh();
                  }
                })
              }
            >
              {t("Verify existing Page")}
            </Button>
          </div>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
      </div>
    );
  if (workflow.status !== "awaiting_owner") return null;
  return (
    <div>
      <Button
        type="button"
        variant="secondary"
        disabled={busy}
        loading={pending === "review"}
        onClick={() =>
          void run("review", async () => {
            setReview(undefined);
            setAccepted(false);
            const requestedScope = currentScope.current;
            const observed = await client.browserRegistrationReview(
              accountId,
              workflow.id,
              workflow.updatedAt,
            );
            if (currentScope.current !== requestedScope) return;
            if (
              observed.accountId !== accountId ||
              observed.workflowId !== workflow.id ||
              observed.updatedAt !== workflow.updatedAt
            )
              throw new Error("Registration review identity changed.");
            setReview(observed);
          })
        }
      >
        {t("Review final Page creation")}
      </Button>
      {review ? (
        <div>
          <p>
            {t("Administrator")}: {review.administrator.name} ({review.administrator.id})
          </p>
          <dl>
            {review.details.map((item, index) => (
              <div key={`${index}:${item.label}`}>
                <dt>{item.label}</dt>
                <dd>{item.value || t("Not provided")}</dd>
              </div>
            ))}
          </dl>
          <p>
            {review.terms.text}{" "}
            <a href={review.terms.url} target="_blank" rel="noreferrer">
              {t("LinkedIn Page Terms")}
            </a>
          </p>
          <label>
            <Checkbox
              checked={accepted}
              disabled={busy}
              onChange={(event) => setAccepted(event.target.checked)}
            />
            {t("I am authorized to create this Page and accept the displayed LinkedIn Page Terms.")}
          </label>
          <Button
            type="button"
            disabled={
              busy ||
              !accepted ||
              review.updatedAt !== workflow.updatedAt ||
              Date.now() >= review.expiresAt
            }
            loading={pending === "submit"}
            onClick={() =>
              void run("submit", async () => {
                if (Date.now() >= review.expiresAt) {
                  setReview(undefined);
                  setAccepted(false);
                  setError(
                    t(
                      "The Page creation review expired. Review the form again before creating it.",
                    ),
                  );
                  return;
                }
                const approved = review;
                setReview(undefined);
                setAccepted(false);
                try {
                  await client.browserRegistrationSubmit(
                    accountId,
                    workflow.id,
                    approved.updatedAt,
                    approved.reviewId,
                  );
                } finally {
                  await onRefresh();
                }
              })
            }
          >
            {review.submitLabel}
          </Button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
