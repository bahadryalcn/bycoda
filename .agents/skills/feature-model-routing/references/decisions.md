# Model routing decisions

## Explicit catalog setup

Owner decision, 2026-11-14:

> BU BACKGROUND WORKS EKRANINDAKİ POOLARI MODELLERİ FİLAN TEK SEFER DE VAR OLAN PROVIDER HESAP VE MODEL LİSTESİNDEN OTOMATİK OLUŞTURABİLMEM GEREKİYOR

Recorded decision: offer one explicit Background work action to populate the model order and account-specific reference pools from the existing available provider catalog. Append to the editable draft without replacing existing priorities, settings or assignments; reuse normal owner-authorized Save. This is user-requested setup, not discovery-triggered migration.

## One Host-wide order and limit definition

Owner decision, 2026-11-12, source: owner model-routing request, quoted in the implementation brief:

> tek bir yapı kurmamız gerekiyor. otomasyon limitlerini tek bir yerden yönetebilmemiz lazım öncelik sıralamasınıda hepsinde aynı modeli kullanabilmemiz grekiyor

Recorded decision: maintain one Host-wide model order and per-model automation limits, with ordered reference pools, role bindings and shared delegation defaults. Feature forms retain only Default, Pool or Fixed choices and a link to Settings > Models. Crew-owned pools and the assistant pool editor are superseded. Resolve at run start and retain the concrete model for running work. This decision grants no new execution or publishing authority.

## No model-routing migration

Owner decision, 2026-11-13:

> eskiye dair birşey kalmasın gerek yok benden başka kullanan yok zaten

Recorded decision: model routing reads only its current Host document. Do not seed it from assistant pools, crew pools, renderer delegation or helper model preferences. Ignore unrelated stored rows without deleting real database data. An absent item choice uses its explicit fixed model; live assistant runtime pool projections remain supported.

## Nested pools, personal/work scope and smart setup

Owner decision, 2026-11-14, source: owner model-routing redesign request:

> Poolara direk başka bir pool u da ekleyebilmeliyiz ... Proje ve gruplarıda taglayebilelim kişisel ve iş diye ... Create from provider catalog kısmını AI ile akıllı bir şekilde yapmalıyız.

(Gloss: pools can include other pools; projects and groups can be tagged personal or work; "Create from provider catalog" must become an AI-assisted smart setup.)

Recorded decision: pools may include pools (no cycles); projects, groups and accounts carry a personal or work scope and a run skips accounts of the other scope; catalog setup becomes smart setup that orders by intelligence and cost and places unknown models by estimate. No new execution or publishing authority.
