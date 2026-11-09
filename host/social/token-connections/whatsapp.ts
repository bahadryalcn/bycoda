import type { SocialHttp } from "../../../src/integrations/social/adapter";
import type { TokenAvailability, VerifiedTokenIdentity } from "./types";

const PREFIX = "BYCODA_SOCIAL_WHATSAPP_";

export function whatsappAvailability(env: NodeJS.ProcessEnv): TokenAvailability {
  const configured = !!env[`${PREFIX}TOKEN`] && !!env[`${PREFIX}PHONE_NUMBER_ID`];
  return {
    configured,
    reason: configured
      ? "Host token present; verify the identity before connecting."
      : "Configure BYCODA_SOCIAL_WHATSAPP_TOKEN and BYCODA_SOCIAL_WHATSAPP_PHONE_NUMBER_ID on the host.",
  };
}

/** Verifies the configured WhatsApp Business phone number against the Graph API. */
export async function verifyWhatsAppBusiness(
  env: NodeJS.ProcessEnv,
  http: SocialHttp,
  token: string,
): Promise<VerifiedTokenIdentity> {
  const phone = env[`${PREFIX}PHONE_NUMBER_ID`] ?? "";
  if (!/^\d+$/.test(phone)) throw new Error("Configure a valid WhatsApp phone number ID.");
  const version = env.BYCODA_SOCIAL_GRAPH_VERSION ?? "v25.0";
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("Invalid Graph API version.");
  const { value } = await http.request(
    `https://graph.facebook.com/${version}/${phone}?fields=id,verified_name,display_phone_number`,
    token,
  );
  if (value.id !== phone || !(value.verified_name || value.display_phone_number))
    throw new Error("WhatsApp phone identity verification failed.");
  return {
    platformId: phone,
    name: String(value.verified_name || value.display_phone_number),
    scopes: [
      "whatsapp_business_messaging",
      ...(env[`${PREFIX}CLIENT_SECRET`] && env[`${PREFIX}WEBHOOK_VERIFY_TOKEN`]
        ? ["bycoda.webhook"]
        : []),
    ],
  };
}
