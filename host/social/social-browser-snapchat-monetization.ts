import type { SnapchatMonetizationStatus } from "../../src/integrations/social/snapchat-profile";

/** A Daily Rewards threshold, a missing dashboard and program eligibility are distinct. */
export const SNAPCHAT_MONETIZATION_PROBE = String.raw`
  const program=only(root,'[data-testid="monetization-program-status"],[aria-label="Monetization program status"]');
  const daily=only(root,'[data-testid="daily-rewards-eligibility"],[aria-label="Daily Rewards Eligibility"]');
  const status=(el)=> (el?.getAttribute('data-status')||el?.textContent||'').trim().toLowerCase();
  const eligibility = status(program);
  const dailyEligibility = status(daily);
  return {
    status: ['eligible','ineligible','unavailable'].includes(eligibility) ? eligibility : 'unknown',
    ...(['eligible','ineligible'].includes(dailyEligibility) ? {dailyRewardsEligible:dailyEligibility==='eligible'} : {}),
  };
`;

export const UNKNOWN_SNAPCHAT_MONETIZATION: SnapchatMonetizationStatus = { status: "unknown" };
