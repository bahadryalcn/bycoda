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

## AI-planned smart setup by benefit per cost

Owner decision, 2026-11-15:

> burdaki smart setup hep aynı şeyi veriyor AI ile yapması gerekiyordu bunların maliyetlerine göre iş atamalarının hepsini yapması gerekiyordu model order pool ve assignmentların hepsini yapabilmesi gerekiyordu. Ayrıca çalışma durumlarına göre yani work ve individual hesaplara göre ayrım yapabilmesi gerekiyordu
>
> gerekirse aktif modellerin hepsini araştırıp ilk sıralamayı biz yaptıralım fayda maliyet sıralamsını ona göre bu yapsın.

(Gloss: smart setup must use AI to plan the model order, pools and all assignments by cost, and separate work and personal accounts; we provide a researched benefit/cost ranking of the active models as its starting point.)

Recorded decision: smart setup sends the full catalog with a researched capability and price table and a benefit-per-cost baseline to the planner model, which returns the order, pools and role bindings; the researched rules are the fallback. Same-named pools are refilled and role bindings replaced in the draft; Save keeps its owner approval. No new execution or publishing authority.

## Per-job effort in smart setup

Owner decision, 2026-11-15:

> max imum high seçebilsinler basit işler hep low genelde medium seçilmesi gerekiyor. High sonrasını kullanıcı kendi seçmesi gerkeiyor bunuda ufak bir bilgi ile belirtiriz

(Gloss: smart setup may choose at most High; simple jobs always Low, most work Medium; levels above High are the owner's own choice, noted with a small info.)

Recorded decision: smart setup creates entries per model and effort. The main order runs at medium, pools bound only to light roles at low, pools with any heavy role at high. It never sets an effort above high, and an owner entry above high is reused for high pools. An info popover beside Smart setup states the rule.

## One Background work draft, tiered order, work and personal lists

Owner decision, 2026-11-17:

> fable ve astra pahalı modeller her zaman ihtiyaç yok opus sol daha çok kullanulan fayda fiyat ve yeteneğe göre bakmak gerekiyor

(Gloss: Fable and Astra are expensive and not always needed; Opus and Sol are the everyday models; rank by benefit, price and capability together.) The owner also chose two separate lists for work and personal accounts, one global smart setup that also sets subagents and the advisor, and decision models on their own Settings page.

Recorded decision: smart setup orders by tier (strong at a moderate price, then cheaper capable, then top-priced, then light), capability within a tier. Its primary action applies the researched rules at once; planning with AI is an explicit menu choice. It also sets global subagents, advisor and a medium subagent effort ceiling and clears those keys from provider and account layers in the draft. Models, groups, job bindings and limits are one draft with one Save. Entries are kept grouped work, personal, shared. No new execution or publishing authority.
