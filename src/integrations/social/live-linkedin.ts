export const LINKEDIN_LIVE_STUDIO = "https://www.linkedin.com/video/golive/manage/";
export const LINKEDIN_LIVE_ACCESS = "https://www.linkedin.com/help/linkedin/answer/a568503";
export const LINKEDIN_LIVE_CONFIRM = "SAVE_LINKEDIN_LIVE_DESTINATION";

/** Credential custody only. LinkedIn Studio determines eligibility and whether the event can go live. */
export type LinkedInLiveStatus =
  | { state: "missing" | "reconnect"; studioUrl: typeof LINKEDIN_LIVE_STUDIO }
  | {
      state: "stored";
      studioUrl: typeof LINKEDIN_LIVE_STUDIO;
      eventId: string;
      storedAt: number;
    };
