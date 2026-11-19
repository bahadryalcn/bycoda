# Settings composition

- `src/features/settings/ui/ProviderSettings.tsx` (tabs in `src/features/settings/model/providerSettingsTabs.ts`) renders `src/features/settings/ui/models/ModelsPage.tsx` with `view: "work" | "defaults"`.
- Background work is `ui/order/ModelOrderSettings.tsx`: tabs Jobs (`ui/roles/ModelRolesGroups.tsx`), Models & order (`ModelOrderList.tsx`: kind sections, By account or Priority view, bulk selection), Groups, Agents (`ui/delegation/`) and Limits (`ModelOrderLimitsTab.tsx`), over one draft and one Save.
- Reordering only in the Priority view; `orderTabs.ts` maps `orderChanges` id prefixes to tab dots.
