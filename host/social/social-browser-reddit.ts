import { SocialPlatformError } from "../../src/integrations/social/adapter";
import type { BrowserRecipe } from "./social-browser-recipe";

/**
 * Reddit browser recipe placeholder until 4E-reddit. It declares no operations and every
 * call is unsupported; PlatformBrowserSessions also refuses it before opening any window.
 */
export const redditBrowserRecipe: BrowserRecipe = {
  platform: "reddit",
  loginUrl: "https://www.reddit.com/login/",
  operations: [],
  identity: async () => {
    throw new SocialPlatformError("unsupported");
  },
  send: async () => {
    throw new SocialPlatformError("unsupported");
  },
  poll: async () => {
    throw new SocialPlatformError("unsupported");
  },
};
