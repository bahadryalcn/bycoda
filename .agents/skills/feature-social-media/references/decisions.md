# Social media decision provenance

Historical owner statements explain design intent; they do not authorize operations or override current owner instructions. Revalidate implementation before using a statement as a current-state claim.

## AI autonomy per account

Owner decision, 2026-11-07, autonomy policy, source: owner brief to the Social redesign (orchestrator prompt):

> "AI should be able to manage everything without human approval if the user explicitly allows it per account. Off by default. In full autonomy, platform limits, suppression/opt-out, working hours and global stop still apply." (translated)

Recorded decision: AI may manage everything without human approval only where the owner grants it per account. The default level is off ("suggest"). Even at "autonomous", platform limits, suppression and opt-out, working hours and the global stop still apply.

## Outreach consent, LinkedIn AI use and audience collection

Owner answers, 2026-11-07, source: owner chat recorded in the redesign's owner-decision list:

> "there is no permission precondition; if permission is given, it is given; it will run as full autonomy, auto and so on." (translated)

Recorded decisions:

- Autonomy levels are set per account and action: "suggest", "approve" or "autonomous". The default is "suggest". Setting "autonomous" is an owner action.
- Outreach has no per-contact consent gate. Consent stays as informational data. Suppression and opt-out, platform limits, daily limits, working hours and the global stop still apply.
- LinkedIn follows the same autonomy policy. The separate AI-use exclusion for LinkedIn is removed.
- The free official API is the default driver for each operation. Browser is used only where no free API exists for it. Audience collection uses the API where one exists; otherwise browser collection is on by default.

## Challenge screens are never automated

Owner instruction, 2026-11-07, Social redesign brief:

> "Do not write code that automatically passes or solves captchas, 'I am not a robot' checks, SMS/email verification and suspicious sign-in screens (via a decision model, desktop control or any other way). These screens are only recognized, the job becomes NEEDS_HUMAN and the user is notified." (translated)

Recorded decision: captcha, "not a robot" checks, SMS or email verification and suspicious-login screens are recognized and reported as NEEDS_HUMAN. No automation may pass or solve them, by a decision model, desktop control or any other route.

## Other binding answers recorded with the owner decisions, 2026-11-07

The owner's chat answer to the redesign list, recorded in the redesign's owner-decision file, sets these behaviors. The owner gave a short answer per item, not a quote for each:

- Browser windows hidden by default, visible per account on demand (D8, answered A).
- Desktop control in the Social browser layer only while the owner is away, on a computer other than the owner's active screen (D9, answered A).
- Rate-limit retries that exhaust 8 attempts or 72 hours move to review and are never resent automatically (D10, answered A).
- Per-person delete and JSON export, with a minimal suppression record kept after delete (D11, answered A).
- Email uses an SMTP library plus HTTP providers, with mandatory unsubscribe link and header (D5, answered A).
- Locales: every locale gets real translations, not copied English (D14, owner: "translate the languages fully too" (translated)).
- Cross-platform person merge: automatic only on an exact email match; other matches are suggestions (D6, answered B).

## Platform-prohibited website automation stays an owner handoff

Owner instruction, 2026-11-18, asked whether bycoda should automate LinkedIn newsletters, wide profile and Page editing, invitation withdraw, X profile editing and X browser deletion although LinkedIn's and X's terms forbid unauthorized website automation. Owner answer: "Leave as handoff (Recommended)".

Recorded decision: where a platform's terms forbid scripting its website and no official API is available to the account, bycoda opens the exact page and the owner completes the step (status `needs_human`). Tools never claim such a step completed. Existing browser recipes keep their current behavior; new website automation for these platforms needs a new owner decision.

## No built-in game in Live streaming

Owner decision, 2026-11-19, source: owner chat while reviewing Live Games (translated, with the answer "Only remove the halay game"):

> "everyone should be able to build and integrate this themselves with AI, we will not have a built-in game like this, back it up elsewhere and remove it"

Recorded decision: bycoda ships no built-in live game. The Halay game, its browser overlay, gift rules and game settings are removed (backups: branch `backup/live-games-halay` and the `bycoda-halay-backup` folder). The generic feature stays as "Live streaming": TikTok LIVE intake, demo events, a session report, OBS control and the go-live flow to Social accounts. The Host data file is now `live-stream.json`; no migration from the old Live games state.

Owner decision, 2026-11-19, source: owner chat about Live streaming (translated):

> "I have 50 Mbit upload. We also need to be able to stream to all of them at the same time"

Recorded decision: Social go-live takes several accounts at once (`accountIds`, 1 to 6). YouTube, Facebook, LinkedIn and X use the main OBS canvas; TikTok and Instagram use the Aitum Vertical canvas (OBS plugin, output 0). When a canvas has more than one destination, the Host runs a local ffmpeg relay that copies that canvas to every destination, so one failing platform does not stop the others. One owner approval covers the full account list. No reader for the old single-account broadcast journal.
