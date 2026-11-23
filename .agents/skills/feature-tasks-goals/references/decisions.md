# Tasks and sprint scope

## Shared server overview

On 2026-11-14 the owner requested: "TÜM SUNUCLARDAKİ DURUMLARIDA ORTAK GÖREBİLMEM LAZIM TASKLARDA SPRINT TE BUNLAR BELİRTİLİR GÖSTERİLİR İSTERSEKTE BUNA GÖRE FİLTRELERİZ."

Tasks open across all projects and servers. Server identity stays visible in task and sprint context, with an explicit server filter. The shared sprint catalog reads each server independently, retains the owning server in its identity, and never copies records or redirects writes to a different server. Optional point capacity is a planning target, not hours, concurrency or an execution limit.

## Simple task screens

On 2026-11-23 the owner asked: "Task ekranlarını basitleştirip kolaylaştırıp yeniden yazalım ... Model seçimleri filan proje seçimleri ortak componentler var bunlar için bunları kullanarak yapalım", approved the redesign mockup and chose **Start** as the New task dialog's primary action and an optional title.

The New task, epic and steward forms use the conversation's shared machine, project, model, access and working-copy chips, two switches for the common choices and one **More options** disclosure. An empty task title is derived on the client from the description's first readable line; the Host contract still receives a title. Tasks has two tabs, Tasks and Sprints; a sprint's report is part of its page. Board filters live in one **Filter** popover, and state counts above the list filter it.
