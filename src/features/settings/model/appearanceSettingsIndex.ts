import { IS_MAC } from "../../../platform/tauri/platform";
import { t } from "../../../shared/i18n/core";
import type { SettingsEntry } from "./settings";

/** Searchable appearance and transcript controls, indexed by their current Settings page. */
export const APPEARANCE_SETTINGS_INDEX: SettingsEntry[] = [
  ...(
    [
      [
        "transcript-preset",
        () => t("Reading look"),
        "transcript preset glass plain contrast reading look",
      ],
      [
        "transcript-surface",
        () => t("Reading surface"),
        "transcript reading surface reply column off okuma yüzeyi",
      ],
      [
        "transcript-surface-opacity",
        () => t("Surface opacity"),
        "transcript reply surface fill transparency yanıt yüzey saydamlık",
      ],
      [
        "transcript-surface-blur",
        () => t("Surface blur"),
        "transcript surface backdrop blur bulanıklık",
      ],
      [
        "chat-message-color",
        () => t("Surface color"),
        "chat bubble neutral theme tint sohbet mesaj renk",
      ],
      [
        "user-message-opacity",
        () => t("Your message opacity"),
        "chat bubble glass transparency sohbet mesaj saydamlık",
      ],
      [
        "transcript-body-ink",
        () => t("Reply text"),
        "transcript reply text brightness ink metin parlaklık",
      ],
      [
        "transcript-chrome-ink",
        () => t("Tool and action text"),
        "transcript tool command action text brightness ink araç komut metin",
      ],
      [
        "transcript-cards",
        () => t("Cards and code"),
        "transcript card code table inset outline solid kart kod tablo",
      ],
      [
        "transcript-actions",
        () => t("Message actions"),
        "transcript copy actions hover always eylem kopyala",
      ],
    ] as const
  ).map(([id, label, keywords]) => ({
    id,
    section: "chat" as const,
    get label() {
      return label();
    },
    keywords,
  })),
  {
    id: "tab-animations",
    section: "appearance",
    get label() {
      return t("Tab animations");
    },
    keywords: "motion open close resize transition",
  },
  {
    id: "theme",
    section: "appearance",
    get label() {
      return t("Color scheme");
    },
    keywords: "dark light system appearance mode",
  },
  {
    id: "interface-contrast",
    section: "appearance",
    get label() {
      return t("Contrast");
    },
    keywords: "borders secondary text softer stronger",
  },
  {
    id: "surface-contrast",
    section: "appearance",
    get label() {
      return t("Surface contrast");
    },
    keywords: "advanced tone card cards layer layers elevation depth black field dialog surface lift canvas",
  },
  {
    id: "accent-readability",
    section: "appearance",
    get label() {
      return t("Accent readability");
    },
    keywords: "accent color contrast text selection readable auto strong buttons",
  },
  {
    id: "canvas-background",
    section: "appearance",
    get label() {
      return t("Background tone");
    },
    keywords:
      "advanced tone pure true black white oled amoled canvas tinted tint dark light theme saf siyah beyaz arka plan",
  },
  {
    id: "interface-font",
    section: "appearance",
    get label() {
      return t("Interface font");
    },
    keywords:
      "typography typeface font family pairing Inter Geist Plex Atkinson Lexend Segoe Arial Verdana",
  },
  {
    id: "code-ligatures",
    section: "appearance",
    get label() {
      return t("Ligatures");
    },
    keywords: "code font programming ligatures arrows => != typography Fira JetBrains",
  },
  {
    id: "follow-system-motion",
    section: "appearance",
    get label() {
      return t("Follow system setting");
    },
    keywords: "motion reduced system os accessibility animations decorative tab",
  },
  {
    id: "monospace-font",
    section: "appearance",
    get label() {
      return t("Monospace font");
    },
    keywords:
      "code terminal font size mono monospace JetBrains Geist Fira Consolas Menlo typography",
  },
  {
    id: "decorative-motion",
    section: "appearance",
    get label() {
      return t("Decorative animations");
    },
    keywords: "motion reduced accessibility mascot particles welcome effects",
  },
  {
    id: "accent-color",
    section: "appearance",
    get label() {
      return t("Accent color");
    },
    keywords: "highlight bubble send button tint",
  },
  {
    id: "interaction-tint",
    section: "appearance",
    get label() {
      return t("Interaction color");
    },
    keywords:
      "advanced tone hover selected selection pressed row button gray grey tint color strength seçim üzerine gelme gri renk",
  },
  {
    id: "interaction-strength",
    section: "appearance",
    get label() {
      return t("Interaction strength");
    },
    keywords: "advanced tone hover selected pressed state intensity gray grey tint",
  },
  {
    id: "scrollbar-color",
    section: "appearance",
    get label() {
      return t("Scrollbar color");
    },
    keywords: "scrollbar scroll bar thumb color accent theme kaydırma çubuğu renk",
  },
  ...(!IS_MAC
    ? ([
        {
          id: "scrollbar-size",
          section: "appearance",
          get label() {
            return t("Scrollbar size");
          },
          keywords: "scrollbar scroll bar width thickness thin wide kaydırma çubuğu kalınlık",
        },
        {
          id: "scrollbar-visibility",
          section: "appearance",
          get label() {
            return t("Show scrollbars");
          },
          keywords: "scrollbar scroll bar always visible hover hide kaydırma çubuğu göster",
        },
      ] satisfies SettingsEntry[])
    : []),
  {
    id: "scrollbar-strength",
    section: "appearance",
    get label() {
      return t("Scrollbar strength");
    },
    keywords: "scrollbar scroll bar opacity contrast intensity kaydırma çubuğu yoğunluk",
  },
  {
    id: "working-indicator-color",
    section: "appearance",
    get label() {
      return t("Working color");
    },
    keywords:
      "working busy running agent project row pulse glow animation color çalışıyor proje animasyon renk",
  },
  {
    id: "working-indicator-style",
    section: "appearance",
    get label() {
      return t("Working animation");
    },
    keywords: "working busy running project row pulse steady off motion çalışıyor animasyon",
  },
  {
    id: "working-indicator-strength",
    section: "appearance",
    get label() {
      return t("Working strength");
    },
    keywords: "working busy running project row pulse intensity tint çalışıyor yoğunluk",
  },
  {
    id: "diff-colors",
    section: "appearance",
    get label() {
      return t("Diff colors");
    },
    keywords:
      "colorblind color blind accessibility added removed red green blue orange high contrast changes",
  },
  {
    id: "hue",
    section: "appearance",
    get label() {
      return t("Hue");
    },
    keywords: "advanced tone tint color chrome",
  },
  {
    id: "saturation",
    section: "appearance",
    get label() {
      return t("Saturation");
    },
    keywords: "advanced tone tint color neutral grey gray",
  },
  {
    id: "dark-lightness",
    section: "appearance",
    get label() {
      return t("Dark-mode lightness");
    },
    keywords: "advanced tone black brightness contrast background",
  },
  {
    id: "sidebar-opacity",
    section: "appearance",
    get label() {
      return t("Sidebar opacity");
    },
    keywords: "glass translucent transparency vibrancy rail",
  },
  {
    id: "blur",
    section: "appearance",
    get label() {
      return t("Blur radius");
    },
    keywords: "glass translucent vibrancy backdrop",
  },
  {
    id: "main-pane-glass",
    section: "appearance",
    get label() {
      return t("Main pane glass");
    },
    keywords: "translucent transparency body window",
  },
  {
    id: "main-pane-opacity",
    section: "appearance",
    get label() {
      return t("Main pane opacity");
    },
    keywords: "glass translucent transparency body window",
  },
  {
    id: "interface-scale",
    section: "appearance",
    get label() {
      return t("Interface scale");
    },
    keywords: "zoom font size bigger smaller ui",
  },
  {
    id: "wheel-zoom",
    section: "appearance",
    get label() {
      return t("Zoom with Ctrl+wheel");
    },
    keywords: "zoom mouse wheel scroll ctrl interface scale tekerlek yakınlaştır",
  },
  {
    id: "control-density",
    section: "appearance",
    get label() {
      return t("Control density");
    },
    keywords: "compact comfortable touch controls target size spacing density",
  },
  {
    id: "collapsed-project-rail",
    section: "appearance",
    get label() {
      return t("Collapsed project rail");
    },
    keywords: "sidebar compact icons hidden navigation layout",
  },
  {
    id: "session-list",
    section: "appearance",
    get label() {
      return t("Session list");
    },
    keywords: "sidebar sessions rows density compact detailed model branch",
  },
  {
    id: "workspace-background",
    section: "appearance",
    get label() {
      return t("Workspace background");
    },
    keywords:
      "gradient gradyan geçiş colors presets linear radial mesh soft blend angle strength background",
  },
  {
    id: "workspace-gradient-style",
    section: "appearance",
    get label() {
      return t("Gradient style");
    },
    keywords: "gradient gradyan geçiş linear radial mesh soft blend",
  },
  {
    id: "workspace-gradient-colors",
    section: "appearance",
    get label() {
      return t("Gradient colors");
    },
    keywords: "gradient gradyan geçiş colors colours renk",
  },
  {
    id: "workspace-gradient-angle",
    section: "appearance",
    get label() {
      return t("Gradient angle");
    },
    keywords: "gradient gradyan geçiş angle açı direction",
  },
  {
    id: "workspace-gradient-strength",
    section: "appearance",
    get label() {
      return t("Background strength");
    },
    keywords: "gradient gradyan geçiş strength intensity opacity yoğunluk",
  },
  {
    id: "chat-background",
    section: "appearance",
    get label() {
      return t("Chat background");
    },
    keywords:
      "wallpaper image picture opacity backdrop blur layer katman veil overlay readability unveiled",
  },
  {
    id: "live-background",
    section: "appearance",
    get label() {
      return t("Live background");
    },
    keywords:
      "animated wallpaper ascii ai neural tree latent face thought weaver ascii mask calm motion backdrop sinir ağacı gizil yüz düşünce dokuyucu ascii maske sakin arka plan",
  },
  {
    id: "crew-scene",
    section: "appearance",
    get label() {
      return t("Agent crew");
    },
    keywords:
      "crew ekip agents ajanlar coffeehouse kahvehane tea çay amcalar bebek baby context grow büyüme ambient scene",
  },
  {
    id: "crew-theme",
    section: "appearance",
    get label() {
      return t("Crew theme");
    },
    keywords:
      "crew theme ekip tema classic star wars starwars yoda obi wan vader luke leia r2 d2 lord of the rings lotr yüzüklerin efendisi gandalf sauron nazgul elf legolas orc ork dwarf cüce hobbit matrix neo morpheus agent smith zion",
  },
  {
    id: "crew-growth",
    section: "appearance",
    get label() {
      return t("Grow with context");
    },
    keywords:
      "crew ekip age yaş baby bebek child çocuk adult yetişkin uncle amca context window compact büyüme color renk doluluk battery şarj",
  },
];
