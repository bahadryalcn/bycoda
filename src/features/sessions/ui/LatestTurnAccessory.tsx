import type { ComponentProps } from "react";
import type { Session } from "../model/session";
import { RetryFailedTurn } from "./RetryFailedTurn";
import { SessionReview } from "./SessionReview";

export function LatestTurnAccessory({
  session,
  blocked,
  onSubmit,
  showReview,
  ...review
}: {
  session: Session;
  blocked: boolean;
  onSubmit: ComponentProps<typeof RetryFailedTurn>["onSubmit"];
  showReview: boolean;
} & ComponentProps<typeof SessionReview>) {
  return (
    <>
      <RetryFailedTurn session={session} blocked={blocked} onSubmit={onSubmit} />
      {showReview ? <SessionReview {...review} /> : null}
    </>
  );
}
