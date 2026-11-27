import {
  PROVIDER_ACCOUNT_PROVIDERS,
  providerAccounts,
} from "../../providers/public/providerAccounts";
import { createUsagePricing } from "../../providers/public/providerUsage";
import { isProjectLocked } from "../../group-lock/public/projectLock";
import { railGroupLookup } from "../model/railGroups";
import {
  buildUsageReport,
  usageReportWindows,
  type UsageReport,
  type UsageReportFailure,
  type UsageReportRequest,
} from "../model/usageReport";
import { loadUsageSources } from "./usageSources";

/** Reads the same sources as the Usage dashboard and builds one bounded report. */
export async function readUsageReport(
  request: UsageReportRequest,
  now = Date.now(),
): Promise<UsageReport | UsageReportFailure> {
  const accounts = PROVIDER_ACCOUNT_PROVIDERS.flatMap(providerAccounts);
  const { window } = usageReportWindows(request, now);
  const sources = loadUsageSources(accounts, window.start, window.end);
  const [reports, turns, prices] = await Promise.all([
    sources.reports,
    sources.turns,
    sources.prices,
  ]);
  return buildUsageReport({
    usage: reports.map(({ account, rows }) => ({ account, rows })),
    turns,
    pricing: createUsagePricing(prices?.models),
    groupFor: railGroupLookup(),
    isLocked: isProjectLocked,
    accountsFailed: reports.filter((report) => report.failed).length,
    now,
    request,
  });
}
