/**
 * Frontend brand defaults for bycoda.
 * Native product names still resolve through appName(); package identifiers,
 * storage keys, host services and update channels are deliberately configured
 * separately so changing presentation cannot redirect existing user data.
 * Keep this module dependency-free for the startup recovery screen.
 */
export const PRODUCT_IDENTITY = Object.freeze({
  displayName: "bycoda",
  developerName: "Bahadır Halil Yalçın",
  websiteUrl: "https://bycoda.bahadrhllyalcn.com",
  contactEmail: "info@bahadrhllyalcn.com",
  logoSrc: "/brand/bycoda/mark-black.svg",
  wordmarkSrc: "/brand/bycoda/wordmark-full-dark.svg",
  horizontalLogoSrc: "/brand/bycoda/logo-horizontal-black.svg",
  repositoryUrl: "https://github.com/bahadryalcn/bycoda" as string | null,
  /** Optional GitHub release page; bundled notes remain available offline. */
  releaseNotesUrl: "https://github.com/bahadryalcn/bycoda/releases" as string | null,
  updaterEnabled: true as boolean,
});
