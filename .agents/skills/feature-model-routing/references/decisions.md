# Model routing decisions

## One Host-wide order and limit definition

Owner decision, 2026-11-12, source: owner model-routing request, quoted in the implementation brief:

> tek bir yapı kurmamız gerekiyor. otomasyon limitlerini tek bir yerden yönetebilmemiz lazım öncelik sıralamasınıda hepsinde aynı modeli kullanabilmemiz grekiyor

Recorded decision: maintain one Host-wide model order and per-model automation limits, with ordered reference pools, role bindings and shared delegation defaults. Feature forms retain only Default, Pool or Fixed choices and a link to Settings > Models. Crew-owned pools and the assistant pool editor are superseded. Resolve at run start and retain the concrete model for running work. This decision grants no new execution or publishing authority.

## No model-routing migration

Owner decision, 2026-11-13:

> eskiye dair birşey kalmasın gerek yok benden başka kullanan yok zaten

Recorded decision: model routing reads only its current Host document. Do not seed it from assistant pools, crew pools, renderer delegation or helper model preferences. Ignore unrelated stored rows without deleting real database data. An absent item choice uses its explicit fixed model; live assistant runtime pool projections remain supported.
