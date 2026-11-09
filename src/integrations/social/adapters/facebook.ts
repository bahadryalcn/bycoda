import type { SocialAdapter, SocialHttp } from "../adapter";
import { createMetaAdapter } from "./meta-shared";

export function createFacebookAdapter(http: SocialHttp, graphVersion: string): SocialAdapter {
  return createMetaAdapter(http, graphVersion, "facebook");
}
