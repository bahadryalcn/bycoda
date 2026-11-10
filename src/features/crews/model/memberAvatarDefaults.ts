import type { MemberAvatarChoice } from "./memberAvatarTraits";

/**
 * Hand-picked looks for the seeded default members, keyed by their stable default
 * agent id (`bycoda.role.<profile>`, see createDefaultCrew). Each look is distinct
 * in head, face, glasses, outfit and palette, and the accessory fits the job.
 */
export const DEFAULT_MEMBER_AVATARS: Readonly<Record<string, MemberAvatarChoice>> = {
  // Team Lead
  "bycoda.role.team-lead": {
    headwear: "takke",
    face: "white-beard",
    glasses: false,
    outfit: "cardigan",
    palette: 0,
    accessory: "tespih",
  },
  // Project Manager
  "bycoda.role.project-manager": {
    headwear: "flat-cap",
    face: "short-beard",
    glasses: true,
    outfit: "vest",
    palette: 1,
    accessory: "notebook",
  },
  // Product Manager
  "bycoda.role.product-manager": {
    headwear: "beret",
    face: "shaven",
    glasses: false,
    outfit: "jacket",
    palette: 2,
    accessory: "pen",
  },
  // UX Researcher
  "bycoda.role.ux-researcher": {
    headwear: "grey-hair",
    face: "bushy",
    glasses: true,
    outfit: "cardigan",
    palette: 3,
    accessory: "none",
  },
  // UX Designer
  "bycoda.role.ux-designer": {
    headwear: "bald",
    face: "walrus",
    glasses: false,
    outfit: "vest",
    palette: 4,
    accessory: "brush",
  },
  // Designer
  "bycoda.role.designer": {
    headwear: "grey-hair",
    face: "short-beard",
    glasses: false,
    outfit: "jacket",
    palette: 5,
    accessory: "brush",
  },
  // UI Engineer
  "bycoda.role.ui-engineer": {
    headwear: "beret",
    face: "bushy",
    glasses: false,
    outfit: "vest",
    palette: 0,
    accessory: "none",
  },
  // Mobile Engineer
  "bycoda.role.mobile-engineer": {
    headwear: "flat-cap",
    face: "walrus",
    glasses: true,
    outfit: "jacket",
    palette: 3,
    accessory: "none",
  },
  // Backend Engineer
  "bycoda.role.backend-engineer": {
    headwear: "takke",
    face: "bushy",
    glasses: false,
    outfit: "jacket",
    palette: 1,
    accessory: "none",
  },
  // Database Administrator (DBA)
  "bycoda.role.dba": {
    headwear: "bald",
    face: "short-beard",
    glasses: true,
    outfit: "cardigan",
    palette: 2,
    accessory: "notebook",
  },
  // Data Engineer
  "bycoda.role.data-engineer": {
    headwear: "grey-hair",
    face: "walrus",
    glasses: false,
    outfit: "cardigan",
    palette: 4,
    accessory: "notebook",
  },
  // Architect
  "bycoda.role.architect": {
    headwear: "takke",
    face: "shaven",
    glasses: true,
    outfit: "vest",
    palette: 3,
    accessory: "pen",
  },
  // DevOps Engineer
  "bycoda.role.devops-engineer": {
    headwear: "beret",
    face: "white-beard",
    glasses: false,
    outfit: "jacket",
    palette: 5,
    accessory: "wrench",
  },
  // Tester
  "bycoda.role.tester": {
    headwear: "flat-cap",
    face: "bushy",
    glasses: false,
    outfit: "cardigan",
    palette: 2,
    accessory: "magnifier",
  },
  // Security Engineer
  "bycoda.role.security-engineer": {
    headwear: "bald",
    face: "white-beard",
    glasses: true,
    outfit: "jacket",
    palette: 0,
    accessory: "key",
  },
  // Accessibility Specialist
  "bycoda.role.accessibility-specialist": {
    headwear: "grey-hair",
    face: "shaven",
    glasses: true,
    outfit: "vest",
    palette: 5,
    accessory: "none",
  },
  // Reviewer
  "bycoda.role.reviewer": {
    headwear: "takke",
    face: "walrus",
    glasses: true,
    outfit: "cardigan",
    palette: 5,
    accessory: "pen",
  },
};
