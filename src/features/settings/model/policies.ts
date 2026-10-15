import privacy from "../../../../docs/guides/privacy-policy.md?raw";
import terms from "../../../../docs/guides/terms-of-use.md?raw";
import thirdParty from "../../../../docs/guides/third-party-data.md?raw";
import license from "../../../../LICENSE?raw";
import { turkishPolicies } from "./policyTranslations";

// The repository documents are the exact English text bundled into the app.
export const POLICIES = [
  {
    id: "privacy-policy",
    title: "Privacy policy",
    trTitle: "Gizlilik politikası",
    en: privacy,
    tr: turkishPolicies.privacy,
  },
  {
    id: "terms-of-use",
    title: "Terms of use",
    trTitle: "Kullanım koşulları",
    en: terms,
    tr: turkishPolicies.terms,
  },
  {
    id: "third-party-data",
    title: "Third-party services and data controls",
    trTitle: "Üçüncü taraflar ve veri kontrolleri",
    en: thirdParty,
    tr: turkishPolicies.thirdParty,
  },
  {
    id: "software-license",
    title: "Software license (MIT)",
    trTitle: "Yazılım lisansı (MIT)",
    en: license,
    tr: license,
  },
] as const;
