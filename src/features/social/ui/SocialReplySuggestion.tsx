import { InlineError } from "../../../shared/ui/InlineError";
import { useContext, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Sparkles } from "../../../shared/ui/icons";
import type { SocialPolicy, SocialProjectProfile, SocialThread } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { socialQueryScope } from "../model/socialQuery";
import { SocialBusyContext } from "./socialContext";
import "./social-assistant.css";

export type ReplySuggestion = { text: string; factIds: string[] };

/**
 * AI help for one selected conversation. The Host answers from verified facts the owner ticks
 * and returns text only: it lands in the reply editor as an editable draft and nothing is
 * saved, approved or sent from here.
 */
export function SocialReplySuggestion({
  client,
  thread,
  profile,
  hostOnline,
  replacesDraft,
  onClose,
  onSuggestion,
  onOpenSettings,
  onOpenContent,
}: {
  client: SocialClient;
  thread: SocialThread;
  profile?: SocialProjectProfile;
  hostOnline: boolean;
  /** The reply editor already holds unfinished text that a suggestion would replace. */
  replacesDraft: boolean;
  onClose: () => void;
  onSuggestion: (suggestion: ReplySuggestion) => void;
  onOpenSettings?: () => void;
  onOpenContent?: (projectId?: string) => void;
}) {
  useLocale();
  const locked = useContext(SocialBusyContext);
  const [picked, setPicked] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const token = useRef(0);
  const facts = profile?.facts ?? [];
  const policy = useQuery({
    queryKey: [...socialQueryScope(client), "reply-policy", thread.accountId],
    queryFn: () =>
      client.request<{ effective: SocialPolicy }>("policy.get", { accountId: thread.accountId }),
    staleTime: 30_000,
  });
  const agent = policy.data?.effective.agent;
  const blocked = !thread.projectId
    ? t("Choose the related project first.")
    : thread.replyAllowed === false
      ? t("The platform does not allow replies to this conversation.")
      : !hostOnline
        ? t("The computer is offline.")
        : policy.isSuccess && !agent
          ? t("Choose a text agent in Settings first.")
          : !facts.length
            ? t("Add a verified fact for this project first.")
            : "";
  const chosen = picked.filter((id) => facts.some((fact) => fact.id === id));
  const canAsk = !blocked && !!chosen.length && !working && !locked;
  const ask = async () => {
    const current = ++token.current;
    setWorking(true);
    setError("");
    try {
      const result = await client.request<ReplySuggestion>("replies.suggest", {
        threadId: thread.id,
        factIds: chosen,
      });
      if (current !== token.current) return;
      onSuggestion({ text: result.text, factIds: result.factIds });
      onClose();
    } catch (cause) {
      if (current === token.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (current === token.current) setWorking(false);
    }
  };
  // Stops waiting; the suggestion is never stored, so a late answer is ignored.
  const stop = () => {
    token.current++;
    setWorking(false);
  };

  return (
    <form
      className="social-reply-suggestion"
      aria-label={t("Suggest a reply")}
      onSubmit={(event) => {
        event.preventDefault();
        if (canAsk) void ask();
      }}
    >
      <fieldset disabled={working || locked}>
        <legend>{t("Answer from these verified facts")}</legend>
        {facts.map((fact) => (
          <label key={fact.id} className="social-assistant-check">
            <Checkbox
              checked={chosen.includes(fact.id)}
              onChange={(event) =>
                setPicked(
                  event.target.checked
                    ? [...chosen, fact.id]
                    : chosen.filter((id) => id !== fact.id),
                )
              }
            />
            <span>{fact.topic}</span>
          </label>
        ))}
      </fieldset>
      {blocked ? (
        <p className="social-assistant-reason" role="status">
          {blocked}{" "}
          {policy.isSuccess && !agent && onOpenSettings ? (
            <Button variant="link" type="button" onClick={onOpenSettings}>
              {t("Open settings")}
            </Button>
          ) : null}
          {!facts.length && thread.projectId && onOpenContent ? (
            <Button variant="link" type="button" onClick={() => onOpenContent(thread.projectId)}>
              {t("Manage verified facts")}
            </Button>
          ) : null}
        </p>
      ) : (
        <p className="social-assistant-note">
          {replacesDraft ? `${t("It replaces the unfinished reply text.")} ` : ""}
          {agent
            ? t("{p0} writes a draft for the reply editor. Nothing is sent.", {
                p0: `${agent.provider}${agent.model ? ` · ${agent.model}` : ""}`,
              })
            : t("The draft goes to the reply editor. Nothing is sent.")}
        </p>
      )}
      {error ? <InlineError>{error}</InlineError> : null}
      <div className="social-assistant-actions">
        <Button
          type="submit"
          loading={working}
          disabled={!canAsk}
          startIcon={<Sparkles aria-hidden="true" />}
        >
          {error ? t("Try again") : t("Suggest")}
        </Button>
        {working ? (
          <Button variant="ghost" type="button" onClick={stop}>
            {t("Stop waiting")}
          </Button>
        ) : (
          <Button variant="ghost" type="button" disabled={locked} onClick={onClose}>
            {t("Close")}
          </Button>
        )}
      </div>
    </form>
  );
}
