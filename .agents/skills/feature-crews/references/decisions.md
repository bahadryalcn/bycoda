# Crews decision provenance

Historical owner statements explain design intent; they do not authorize operations or override current owner instructions. Revalidate implementation before using a statement as a current-state claim.

## Library members stay linked to their profile

Owner decision, 2026-11-10, crew member library, source: owner chat:

> tek kayıt.

Recorded decision: a crew member that came from the member library stays linked to that library profile. Library edits update every crew that uses the profile, unless the member was customized inside that crew. Running work keeps the snapshot it started with.

## Calling a member from chat opens its own conversation

Owner decision, 2026-11-10, member calls from chat, source: owner chat:

> Ayrı bir yerde gözüksün ama subagents gibi gösterilsin istenirse ordan tıklayıp açıp konuşabilelim yani.

Recorded decision: calling a member from chat (`@handle`) runs that member in its own conversation. The calling conversation shows the run as a subagent-style card, and the owner can open that conversation from the card and talk to the member directly.

## Crew faces are a group of member faces

Owner decision, 2026-11-10, crew avatars, source: owner chat:

> amcaların toplu resmi olabilir

Recorded decision: a crew is represented by its members' faces together. At large sizes this is a group portrait; in lists the faces overlap; at icon size a small sign stands in. Members have pixel "uncle" avatars.

## Avatars follow the device scene theme

Owner decision, 2026-11-10, avatar theme, source: owner chat:

> evet değişsin.

Recorded decision: member and crew avatars follow the device's ambient scene theme (uncle, droid, Ent, Agent). The stored look is independent of the theme, so switching theme changes how avatars are drawn without changing what was saved.

## Crews are managed on a full Crews page

Owner decision, 2026-11-10, crew management location, source: owner chat:

> tamam olur önerini yapalım.

Recorded decision: crews are created and managed on a full Crews page. Settings keeps only the rail toggle and a link to that page.

## Crew look is stored on the Host; rail visibility is per device

Owner decision, 2026-11-10, crew look storage, source: owner chat:

> dediğin gibi olsun.

Recorded decision: a crew's look (icon and color) and each member's look are stored on the Host and are identical on every device. The "show crews on rail" setting stays device-local.

## Automatic model selection comes from shared model pools

Owner decision, 2026-11-10, automatic model selection, source: owner chat:

> bu otomatik model seçimi ayrı bir yerden hepsi için hazırlanabilmesi gerekiyor otomatik böyle çalışması gerekiyor yoksa her bir üyeye ayrı bu tanımı yapacaksam hiç bir anlamı yok. Birden fazla automatic model seçimide tanımlayabilmeliyim hatta. Bunlarıda atayabilmem gerekiyor.

Recorded decision: automatic candidates and their cost and quality ratings are defined once in named, host-wide model pools on the Crews page. A member that uses Automatic references one pool; the Host copies that pool's candidates into every member that references it, so a pool edit reaches all of them. A per-member custom list stays available as a fallback.

## Member tools combine

Owner decision, 2026-11-10, member tool profiles, source: owner chat:

> Birden fazla tool verebilmemiz gerekiyor sanki.

Recorded decision: a member's tool capabilities (write code, image generation, browser) combine; the allowance is their union on top of read-only.
