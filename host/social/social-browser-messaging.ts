import type { BrowserRecipe } from "./social-browser-recipe";
import { telegramBrowserRecipe } from "./social-browser-telegram";
import { whatsappBrowserRecipe } from "./social-browser-whatsapp";

/** Compatibility shim. Personal web-session messaging; independent of WhatsApp Business and Telegram Bot API credentials. */
export const messagingBrowserRecipes: BrowserRecipe[] = [
  whatsappBrowserRecipe,
  telegramBrowserRecipe,
];
