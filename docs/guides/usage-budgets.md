# Usage budgets

**Projects** starts with ranked usage and provider shares. Expand **Show as table**
for sortable exact values and further drilldown. **Export CSV** downloads the current
filtered breakdown.

In **Time analysis**, hover or focus an hour to inspect its provider, model and
project breakdown. Clicking narrows the selected interval. A single day keeps the
same time-and-date columns as a full week. Measurement notes are available from
the information controls; missing prices and unavailable readings remain explicit.

The **Limits & budgets** view compares provider accounts in compact rows. Each row
keeps its account identity, observation time, available quota windows, reset times,
color menu and retry together. Failed refreshes keep the last known limits visible.

Grok shows the signed-in Grok Build CLI's plan quota in this view and the workspace
footer. The used/remaining preference applies to its provider-reported credit usage
percentage; the quota window and reset come from its current billing period.
Grok uses its single CLI login rather than Bycoda's isolated account profiles.
Missing credentials, unsupported CLI versions and failed reads remain explicit;
local token costs are not treated as plan quota. Reads do not start a conversation.

**Limit history** shows all filtered accounts together by default. Use the account
selector to focus one account and the window selector to compare the same quota
period. Colors identify accounts; percentages remain separate, never pooled.
The expandable table retains exact observations and account names.

Usage detail tables scroll through all loaded records without numbered pages.
Sorting, drilldown and exact measurement availability remain available while the
table recycles offscreen rows.

Open **Settings → Provider usage → Usage budgets** to create, edit or remove a budget.
Choose a project folder, a session or a workspace from the project rail. Multiple
matching rules apply together; any blocking rule can prevent a new turn.

## Measurements

- **Token allocation:** enter a capacity and an allocation percentage. A capacity
  of 1,000,000 with 25% allocates 250,000 tokens. Input, output and cache tokens
  count toward the allocation. Choose all time, rolling seven days or rolling
  five hours. These rolling periods are independent of provider reset schedules.
- **Provider account threshold (%):** choose an account, a weekly or five-hour
  window, and a percentage threshold. For example, 75% prevents new matching
  turns when the selected account is at least 75% consumed. This measures the
  whole account; it does not attribute its consumption to the selected scope or
  reserve part of the provider's allowance. Only turns using that account are
  subject to its threshold rule.

Token project/workspace readings use the same local provider logs as the Usage
overview and match recorded working folders. Worktrees recorded under distinct
folders are separate unless those folders belong to the same workspace.
Reports have 15-minute buckets and include the oldest intersecting
bucket conservatively. Session readings use complete, provider-reported turn
metrics. Missing metrics, unsupported providers and partial history are unknown,
not zero. Rewinding or deleting history can remove session metrics; these budgets
are not an immutable billing ledger. Codex cached input is counted once.

## Actions and availability

**Monitor only** shows the allocation, usage and status. **Block new turns** checks
usage before the desktop commits a local turn, creates its worktree or starts
provider work. If checking fails or the limit has been reached, the request is
retained in the existing paused message queue or composer rejection recovery.
Queued messages and drafts remain available for review and retry.

The desktop refreshes budget readings every minute while this page is open and
when Usage is refreshed. A blocking check reads current local reports and requests
fresh account limits, with a bounded wait. Expired or unavailable provider windows
are unknown. A blocking rule also blocks on unknown data; refresh, edit or remove
the rule to recover. Nothing automatically sends a rejected request after reset.

Rules persist in this desktop's settings and update across its windows. They apply
to local desktop submissions only. Host tasks, direct host/API requests, remote
sessions and other machines are outside this gate. Running turns and simultaneous
submissions can exceed a budget because this is a check before a turn, not a strict
in-flight token ceiling or capacity reservation. Group locks conceal the associated
budget names, targets and readings.
