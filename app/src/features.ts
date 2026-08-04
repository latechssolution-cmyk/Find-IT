/**
 * Feature flags.
 *
 * Built-but-not-shipped work lives behind these. The photo feed is complete
 * enough to review and switch on, and deliberately off: it is the one
 * feature that changes the product's obligations rather than just its
 * surface, so turning it on should be a decision someone makes, not a
 * side effect of merging.
 *
 * Turning FEED on commits us to:
 *   - accounts (a feed with no identity has nobody to ban)
 *   - Play's account-deletion requirement, in-app AND a public web form
 *   - Data Safety answers changing from "not collected" to "collected",
 *     which is currently the cleanest claim we have
 *   - a moderation queue someone actually reads
 *
 * None of that is a reason not to do it. It is a reason to do it on purpose.
 */
export const FEATURES = {
  /** Photo feed + personal gallery. Schema, moderation and UI are done. */
  FEED: false,
} as const;

export type FeatureName = keyof typeof FEATURES;
export const enabled = (f: FeatureName): boolean => FEATURES[f];
