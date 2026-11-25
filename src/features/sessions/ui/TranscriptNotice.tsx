import {
  NoticeCard,
  type NoticeCardKind,
  type NoticeCardProps,
} from "../../../shared/ui/NoticeCard";

export type TranscriptNoticeKind = NoticeCardKind;
export type TranscriptNoticeProps = NoticeCardProps;

/** The transcript's notice: the shared NoticeCard, named for its callers in and around the transcript. */
export const TranscriptNotice = NoticeCard;

/** An action of the notice: the shared small secondary button, `quiet` for the second choice. */
export { NoticeButton as NoticeActionButton } from "../../../shared/ui/Notice";
