# Anonymous statistics contract

Anonymous statistics are off until the user says yes. The choice is `{ choice: on | off | null, decidedAt }` (`null` = never asked; the old boolean key migrates: true is yes, false is not asked).

- Every user is asked once: first-run onboarding step, or `StatsConsentNotice` (non-blocking, at most three showings, then off).
- `model/anonymousStats.ts` sends the strict contract `AnonymousPing` at most once per local day with a random, never regenerated install id.
- No token, no device header, silent failures. Nothing is sent when the choice is off, not asked, or the API URL (from `account_status`, needs no sign-in) is missing.
- The switch lives in Account → Privacy & data and, for guests, Settings → Privacy.
