# Project navigation decisions

## Group pinning and moving — 2026-11-11

Owner: "gruplar pinlenemesin" and "move to groupta seçilen group a bir daha tıklanırsa ungroup olması gerekiyor".

Only ungrouped projects offer pin actions. Groups and linked workspaces offer no pin action. Selecting the checked destination in Move to group removes the project or workspace from that group; no separate Ungrouped row is needed.

Legacy persisted group pins are ignored while preserving saved group order and other group data. Group and linked workspace menus retain available cached Git change summaries when hover actions replace row indicators.
