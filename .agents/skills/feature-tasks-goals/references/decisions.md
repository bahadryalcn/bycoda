# Tasks and sprint scope

## Shared server overview

On 2026-11-14 the owner requested: "TÜM SUNUCLARDAKİ DURUMLARIDA ORTAK GÖREBİLMEM LAZIM TASKLARDA SPRINT TE BUNLAR BELİRTİLİR GÖSTERİLİR İSTERSEKTE BUNA GÖRE FİLTRELERİZ."

Tasks open across all projects and servers. Server identity stays visible in task and sprint context, with an explicit server filter. The shared sprint catalog reads each server independently, retains the owning server in its identity, and never copies records or redirects writes to a different server. Optional point capacity is a planning target, not hours, concurrency or an execution limit.

## Bounded uncertain runtime

On 2026-11-25 the owner started the execution plan v2, phase 0: "Subagentlar ile bu worktree de çalışmaya başla".

A run with an unverified interval (Host restart, sample gap over 90 seconds, missing close record) used to block every limited start until the owner removed the limit. It cannot have lasted longer than its wall-clock span, so each run's upper bound is the larger of its verified time and `settledAt - startedAt` (`now - startedAt` while running); missing or backwards timestamps give no bound. Task runtime allowance, the total agent-time budget and the daily limit start work while the bound stays under the limit. When the bound reaches the limit, or does not exist, the owner decides: `tasks.continueRuntime` retires the earlier work, sets the limit to the verified minutes plus the added minutes and records the accepted uncertainty, which is not counted again. Unknown history without receipts and sealed runs recorded before bounds existed have no bound.
