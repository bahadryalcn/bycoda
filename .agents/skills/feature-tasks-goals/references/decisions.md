# Tasks and sprint scope

## Shared server overview

On 2026-11-14 the owner requested: "TÜM SUNUCLARDAKİ DURUMLARIDA ORTAK GÖREBİLMEM LAZIM TASKLARDA SPRINT TE BUNLAR BELİRTİLİR GÖSTERİLİR İSTERSEKTE BUNA GÖRE FİLTRELERİZ."

Tasks open across all projects and servers. Server identity stays visible in task and sprint context, with an explicit server filter. The shared sprint catalog reads each server independently, retains the owning server in its identity, and never copies records or redirects writes to a different server. Optional point capacity is a planning target, not hours, concurrency or an execution limit.

## Runtime counts observed time only

On 2026-11-25 the owner decided: "uykudaysa uykuya girdiği zamanı ve kalktığı zamanı o zamana kadar çalışma süresini hesaplayıp aynı şekilde devam edelim. 10dk çalıştı 1 saat uykuda kaldıysa 10dk çalışmıştır yani."

A run's runtime is the sum of the intervals between consecutive samples that are close enough. A gap (system sleep, a Host stall over 90 seconds, a wall/monotonic divergence, a backwards clock) adds nothing and is neither an error nor uncertainty; the run keeps accruing from the next sample. After a Host restart the run continues from its persisted checkpoint and the first sample only sets the baseline. A run settled without a close record counts its last checkpoint. Legacy runs without checkpoints count what was recorded. No task, goal, total budget or daily limit is ever blocked or waits for the owner because of an unknown interval; only verified time at or above a limit exhausts it. This replaces the earlier wall-clock upper bound and `tasks.continueRuntime`.
