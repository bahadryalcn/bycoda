# Settings composition

- `src/features/settings/ui/ProviderSettings.tsx` (tabs in `src/features/settings/model/providerSettingsTabs.ts`) renders `src/features/settings/ui/models/ModelsPage.tsx` with `view: "work" | "defaults"`.
- Background work is `ui/order/ModelOrderSettings.tsx`: tabs Jobs (`ui/roles/ModelRolesGroups.tsx`), Models & order (`ModelOrderList.tsx`: kind sections, By account or Priority view, bulk selection), Groups, Agents (`ui/delegation/`) and Limits (`ModelOrderLimitsTab.tsx`), over one draft and one Save.
- Model order opens in Priority view and reorders within each account kind. Groups reorder
  model members and included groups separately. Both use `useAnimatedReorder`.
- `orderTabs.ts` maps `orderChanges` id prefixes to tab dots.
