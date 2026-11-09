/** Metadata only. Skill content is downloaded from each publisher after owner action. */
export interface RecommendedSkill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: "design" | "development" | "testing" | "mobile" | "tools";
  readonly repository: string;
  readonly skillPath: string;
  readonly sourceUrl: string;
  readonly ref: "main";
  readonly note?: string;
}

/** Ordered by general usefulness, then focused task value; not benchmark scores. */
export const RECOMMENDED_SKILLS: readonly RecommendedSkill[] = [
  {
    id: "impeccable",
    name: "impeccable",
    description:
      "Design, audit and polish interfaces, including accessibility, responsive behavior and edge cases.",
    category: "design",
    repository: "https://github.com/pbakaus/impeccable",
    skillPath: ".agents/skills/impeccable",
    sourceUrl: "https://github.com/pbakaus/impeccable/tree/main/.agents/skills/impeccable",
    ref: "main",
    note: "Optional design hooks and provider helpers are not installed.",
  },
  {
    id: "frontend-design",
    name: "frontend-design",
    description:
      "Create distinctive frontend interfaces with deliberate typography, layout and visual direction.",
    category: "design",
    repository: "https://github.com/anthropics/skills",
    skillPath: "skills/frontend-design",
    sourceUrl: "https://github.com/anthropics/skills/tree/main/skills/frontend-design",
    ref: "main",
    note: "Downloads the publisher’s original skill; local customizations are not included.",
  },
  {
    id: "vercel-react-best-practices",
    name: "vercel-react-best-practices",
    description: "Improve React and Next.js performance using Vercel engineering guidance.",
    category: "development",
    repository: "https://github.com/vercel-labs/agent-skills",
    skillPath: "skills/react-best-practices",
    sourceUrl: "https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices",
    ref: "main",
  },
  {
    id: "webapp-testing",
    name: "webapp-testing",
    description:
      "Test local web applications with Playwright, screenshots and browser diagnostics.",
    category: "testing",
    repository: "https://github.com/anthropics/skills",
    skillPath: "skills/webapp-testing",
    sourceUrl: "https://github.com/anthropics/skills/tree/main/skills/webapp-testing",
    ref: "main",
    note: "Requires Playwright and a browser. Browser runtimes are installed separately.",
  },
  {
    id: "emil-design-eng",
    name: "emil-design-eng",
    description:
      "Polish UI controls, interactions and animation through design engineering guidance.",
    category: "design",
    repository: "https://github.com/emilkowalski/skills",
    skillPath: "skills/emil-design-eng",
    sourceUrl: "https://github.com/emilkowalski/skills/tree/main/skills/emil-design-eng",
    ref: "main",
  },
  {
    id: "ui-ux-pro-max",
    name: "ui-ux-pro-max",
    description:
      "Search UI styles, palettes, typography, UX guidance and stack-specific design data.",
    category: "design",
    repository: "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill",
    skillPath: ".claude/skills/ui-ux-pro-max",
    sourceUrl:
      "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/tree/main/.claude/skills/ui-ux-pro-max",
    ref: "main",
    note: "Requires Python 3.",
  },
  {
    id: "web-design-guidelines",
    name: "web-design-guidelines",
    description:
      "Audit web interfaces for accessibility, usability and interface guideline issues.",
    category: "testing",
    repository: "https://github.com/vercel-labs/agent-skills",
    skillPath: "skills/web-design-guidelines",
    sourceUrl: "https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines",
    ref: "main",
  },
  {
    id: "break-ui",
    name: "break-ui",
    description:
      "Find UI failures using long text, missing data, extreme values and diverse scripts.",
    category: "testing",
    repository: "https://github.com/emilkowalski/skills",
    skillPath: "skills/break-ui",
    sourceUrl: "https://github.com/emilkowalski/skills/tree/main/skills/break-ui",
    ref: "main",
  },
  {
    id: "design-taste-frontend",
    name: "design-taste-frontend",
    description:
      "Build deliberate web and app designs using art direction, reference research and browser review.",
    category: "design",
    repository: "https://github.com/Leonxlnx/taste-skill",
    skillPath: "skills/taste-skill",
    sourceUrl: "https://github.com/Leonxlnx/taste-skill/tree/main/skills/taste-skill",
    ref: "main",
    note: "Requires Node.js 22+ and Chrome, Edge or Chromium.",
  },
  {
    id: "nodejs-backend-patterns",
    name: "nodejs-backend-patterns",
    description:
      "Build Node.js services with API structure, validation, authentication and error handling patterns.",
    category: "development",
    repository: "https://github.com/wshobson/agents",
    skillPath: "plugins/javascript-typescript/skills/nodejs-backend-patterns",
    sourceUrl:
      "https://github.com/wshobson/agents/tree/main/plugins/javascript-typescript/skills/nodejs-backend-patterns",
    ref: "main",
  },
  {
    id: "tailwind-design-system",
    name: "tailwind-design-system",
    description:
      "Create consistent Tailwind design tokens, reusable components and responsive systems.",
    category: "development",
    repository: "https://github.com/wshobson/agents",
    skillPath: "plugins/frontend-mobile-development/skills/tailwind-design-system",
    sourceUrl:
      "https://github.com/wshobson/agents/tree/main/plugins/frontend-mobile-development/skills/tailwind-design-system",
    ref: "main",
  },
  {
    id: "mobile-native",
    name: "mobile-native",
    description:
      "Improve mobile web tap behavior, viewport details and native-feeling interactions.",
    category: "mobile",
    repository: "https://github.com/emilkowalski/skills",
    skillPath: "skills/mobile-native",
    sourceUrl: "https://github.com/emilkowalski/skills/tree/main/skills/mobile-native",
    ref: "main",
  },
  {
    id: "review-animations",
    name: "review-animations",
    description: "Review interface motion for timing, easing, interaction quality and polish.",
    category: "design",
    repository: "https://github.com/emilkowalski/skills",
    skillPath: "skills/review-animations",
    sourceUrl: "https://github.com/emilkowalski/skills/tree/main/skills/review-animations",
    ref: "main",
  },
  {
    id: "create-design-md",
    name: "create-design-md",
    description:
      "Document an existing product's design language, tokens and component conventions.",
    category: "design",
    repository: "https://github.com/ibelick/ui-skills",
    skillPath: "skills/create-design-md",
    sourceUrl: "https://github.com/ibelick/ui-skills/tree/main/skills/create-design-md",
    ref: "main",
  },
  {
    id: "shadcn-ui",
    name: "shadcn-ui",
    description:
      "Build accessible React interfaces with shadcn/ui components and composition patterns.",
    category: "development",
    repository: "https://github.com/giuseppe-trisciuoglio/developer-kit",
    skillPath: "plugins/developer-kit-typescript/skills/shadcn-ui",
    sourceUrl:
      "https://github.com/giuseppe-trisciuoglio/developer-kit/tree/main/plugins/developer-kit-typescript/skills/shadcn-ui",
    ref: "main",
  },
  {
    id: "agent-desktop",
    name: "agent-desktop",
    description:
      "Operate desktop applications through native accessibility with the agent-desktop CLI.",
    category: "tools",
    repository: "https://github.com/vercel-labs/agent-desktop",
    skillPath: "skills/agent-desktop",
    sourceUrl: "https://github.com/vercel-labs/agent-desktop/tree/main/skills/agent-desktop",
    ref: "main",
    note: "Requires the agent-desktop CLI and platform permissions. Desktop control needs separate authorization.",
  },
  {
    id: "image-to-code",
    name: "image-to-code",
    description:
      "Turn generated visual references into frontend implementation with close visual matching.",
    category: "design",
    repository: "https://github.com/Leonxlnx/imagegen-skills",
    skillPath: "skills/image-to-code",
    sourceUrl: "https://github.com/Leonxlnx/imagegen-skills/tree/main/skills/image-to-code",
    ref: "main",
    note: "Requires an image generation tool supported by your provider.",
  },
];
