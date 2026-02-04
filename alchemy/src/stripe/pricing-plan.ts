import type { Context } from "../context.ts";
import { Resource } from "../resource.ts";
import type { Secret } from "../secret.ts";
import { logger } from "../util/logger.ts";
import {
  createStripeV2Client,
  handleStripeV2DeleteError,
  isStripeV2ConflictError,
  type V2PricingPlan,
} from "./v2-client.ts";

/**
 * Properties for creating or updating a Stripe Pricing Plan
 */
export interface PricingPlanProps {
  /**
   * The display name of the pricing plan
   */
  displayName: string;

  /**
   * Three-letter ISO currency code
   */
  currency: string;

  /**
   * Whether tax is exclusive or inclusive in amounts
   * @default "exclusive"
   */
  taxBehavior?: "exclusive" | "inclusive";

  /**
   * A lookup key to uniquely identify this pricing plan
   */
  lookupKey?: string;

  /**
   * The version of the plan to make live.
   * Set to "latest" to activate the latest version.
   */
  liveVersion?: "latest" | string;

  /**
   * Set of key-value pairs for metadata
   */
  metadata?: Record<string, string>;

  /**
   * API key to use (overrides environment variable)
   */
  apiKey?: Secret;

  /**
   * If true, adopt existing resource if creation fails due to conflict
   */
  adopt?: boolean;
}

/**
 * Output returned after Stripe Pricing Plan creation/update
 */
export interface PricingPlan {
  /**
   * The ID of the pricing plan
   */
  id: string;

  /**
   * The display name of the pricing plan
   */
  displayName: string;

  /**
   * Three-letter ISO currency code
   */
  currency: string;

  /**
   * Whether tax is exclusive or inclusive in amounts
   */
  taxBehavior: "exclusive" | "inclusive";

  /**
   * A lookup key to uniquely identify this pricing plan
   */
  lookupKey?: string;

  /**
   * The version of the plan that is currently live
   */
  liveVersion?: string;

  /**
   * The latest version of the plan
   */
  latestVersion?: string;

  /**
   * Set of key-value pairs for metadata
   */
  metadata?: Record<string, string>;

  /**
   * Time at which the object was created (Unix timestamp)
   */
  createdAt: number;

  /**
   * Time at which the object was last updated (Unix timestamp)
   */
  updatedAt: number;

  /**
   * Has the value true if the object exists in live mode
   */
  livemode: boolean;
}

/**
 * Manages Stripe Pricing Plans. A Pricing Plan is a container that groups
 * billing components (rate cards and license fees) together for subscriptions.
 *
 * Pricing Plans are used with Stripe's advanced usage-based billing system
 * and support multiple pricing models including pay-as-you-go, real-time
 * credit burndown with top-ups, and flat fee with overages.
 *
 * @example
 * // Create a basic pricing plan
 * const basicPlan = await PricingPlan("basic-plan", {
 *   displayName: "Basic Plan",
 *   currency: "usd",
 *   metadata: {
 *     tier: "basic"
 *   }
 * });
 *
 * @example
 * // Create a pricing plan with a lookup key
 * const proPlan = await PricingPlan("pro-plan", {
 *   displayName: "Professional Plan",
 *   currency: "usd",
 *   taxBehavior: "exclusive",
 *   lookupKey: "pro-monthly-2024",
 *   metadata: {
 *     tier: "professional",
 *     features: "advanced"
 *   }
 * });
 *
 * @example
 * // Create and activate a pricing plan
 * const activePlan = await PricingPlan("active-plan", {
 *   displayName: "Active Plan",
 *   currency: "usd",
 *   liveVersion: "latest"
 * });
 */
export const PricingPlan = Resource(
  "stripe::PricingPlan",
  async function (
    this: Context<PricingPlan>,
    _id: string,
    props: PricingPlanProps,
  ): Promise<PricingPlan> {
    const adopt = props.adopt ?? this.scope.adopt;
    const client = await createStripeV2Client({ apiKey: props.apiKey });
    const taxBehavior = props.taxBehavior ?? "exclusive";

    if (this.phase === "delete") {
      // Note: v2 billing pricing plans may not support direct deletion
      // They are typically managed by archiving or setting active: false
      if (this.output?.id) {
        try {
          await client.pricingPlans.del(this.output.id);
        } catch (error: any) {
          // If deletion is not supported (404), log and continue
          if (error?.status === 404 || error?.statusCode === 404) {
            logger.log(
              `PricingPlan ${this.output.id} deletion not supported (may need to be archived instead)`,
            );
          } else {
            handleStripeV2DeleteError(error, "PricingPlan", this.output.id);
          }
        }
      }
      return this.destroy();
    }

    try {
      let plan: V2PricingPlan;

      if (this.phase === "update" && this.output?.id) {
        // Update existing pricing plan
        plan = await client.pricingPlans.update(this.output.id, {
          display_name: props.displayName,
          lookup_key: props.lookupKey,
          live_version: props.liveVersion,
          metadata: props.metadata,
        });
      } else {
        // Create new pricing plan
        try {
          plan = await client.pricingPlans.create({
            display_name: props.displayName,
            currency: props.currency,
            tax_behavior: taxBehavior,
            lookup_key: props.lookupKey,
            metadata: props.metadata,
          });

          // If liveVersion is specified, update to set it
          if (props.liveVersion) {
            plan = await client.pricingPlans.update(plan.id, {
              live_version: props.liveVersion,
            });
          }
        } catch (error) {
          if (isStripeV2ConflictError(error) && adopt && props.lookupKey) {
            // Try to find existing plan by lookup key
            const existingPlans = await client.pricingPlans.list();
            const existingPlan = existingPlans.data.find(
              (p) => p.lookup_key === props.lookupKey,
            );

            if (existingPlan) {
              plan = await client.pricingPlans.update(existingPlan.id, {
                display_name: props.displayName,
                live_version: props.liveVersion,
                metadata: props.metadata,
              });
            } else {
              throw error;
            }
          } else {
            throw error;
          }
        }
      }

      return mapV2PricingPlanToOutput(plan);
    } catch (error) {
      logger.error("Error creating/updating pricing plan:", error);
      throw error;
    }
  },
);

/**
 * Maps a V2 Pricing Plan API response to the output interface
 */
function mapV2PricingPlanToOutput(plan: V2PricingPlan): PricingPlan {
  return {
    id: plan.id,
    displayName: plan.display_name,
    currency: plan.currency,
    taxBehavior: plan.tax_behavior,
    lookupKey: plan.lookup_key,
    liveVersion: plan.live_version,
    latestVersion: plan.latest_version,
    metadata: plan.metadata,
    createdAt: plan.created,
    updatedAt: plan.updated,
    livemode: plan.livemode,
  };
}
