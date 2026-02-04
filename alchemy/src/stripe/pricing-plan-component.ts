import type { Context } from "../context.ts";
import { Resource } from "../resource.ts";
import type { Secret } from "../secret.ts";
import { logger } from "../util/logger.ts";
import type { LicenseFee } from "./license-fee.ts";
import type { PricingPlan } from "./pricing-plan.ts";
import type { RateCard } from "./rate-card.ts";
import {
  createStripeV2Client,
  handleStripeV2DeleteError,
  type V2PricingPlanComponent,
} from "./v2-client.ts";

/**
 * Properties for creating or updating a Stripe Pricing Plan Component
 */
export interface PricingPlanComponentProps {
  /**
   * The pricing plan to attach the component to, as ID or PricingPlan resource
   */
  pricingPlan: string | PricingPlan;

  /**
   * The type of component: rate_card or license_fee
   */
  type: "rate_card" | "license_fee";

  /**
   * The rate card to attach (required if type is "rate_card")
   */
  rateCard?: string | RateCard;

  /**
   * The license fee to attach (required if type is "license_fee")
   */
  licenseFee?: string | LicenseFee;

  /**
   * Set of key-value pairs for metadata
   */
  metadata?: Record<string, string>;

  /**
   * API key to use (overrides environment variable)
   */
  apiKey?: Secret;
}

/**
 * Output returned after Stripe Pricing Plan Component creation/update
 */
export interface PricingPlanComponent {
  /**
   * The ID of the component
   */
  id: string;

  /**
   * The ID of the pricing plan this component belongs to
   */
  pricingPlan: string;

  /**
   * The type of component
   */
  type: "rate_card" | "license_fee";

  /**
   * The ID of the rate card (if type is "rate_card")
   */
  rateCard?: string;

  /**
   * The ID of the license fee (if type is "license_fee")
   */
  licenseFee?: string;

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
 * Manages Stripe Pricing Plan Components. A Component attaches a Rate Card
 * or License Fee to a Pricing Plan. This is how you compose billing
 * configurations by combining usage-based (rate card) and flat-fee
 * (license fee) pricing within a single plan.
 *
 * @example
 * // Attach a rate card to a pricing plan
 * const rateCardComponent = await PricingPlanComponent("api-rates", {
 *   pricingPlan: pricingPlan,
 *   type: "rate_card",
 *   rateCard: rateCard,
 *   metadata: {
 *     category: "usage"
 *   }
 * });
 *
 * @example
 * // Attach a license fee to a pricing plan
 * const licenseFeeComponent = await PricingPlanComponent("platform-fee", {
 *   pricingPlan: "pp_abc123",
 *   type: "license_fee",
 *   licenseFee: "lf_xyz789",
 *   metadata: {
 *     category: "subscription"
 *   }
 * });
 *
 * @example
 * // Compose a plan with both usage and flat-fee components
 * const pricingPlan = await PricingPlan("pro-plan", {
 *   name: "Professional Plan"
 * });
 *
 * const rateCard = await RateCard("api-usage", {
 *   name: "API Usage",
 *   currency: "usd"
 * });
 *
 * const licenseFee = await LicenseFee("platform-fee", {
 *   name: "Platform Fee",
 *   licensedItem: licensedItem,
 *   currency: "usd",
 *   amount: 4900,
 *   interval: "month"
 * });
 *
 * const usageComponent = await PricingPlanComponent("usage-component", {
 *   pricingPlan: pricingPlan,
 *   type: "rate_card",
 *   rateCard: rateCard
 * });
 *
 * const feeComponent = await PricingPlanComponent("fee-component", {
 *   pricingPlan: pricingPlan,
 *   type: "license_fee",
 *   licenseFee: licenseFee
 * });
 */
export const PricingPlanComponent = Resource(
  "stripe::PricingPlanComponent",
  async function (
    this: Context<PricingPlanComponent>,
    _id: string,
    props: PricingPlanComponentProps,
  ): Promise<PricingPlanComponent> {
    const client = await createStripeV2Client({ apiKey: props.apiKey });

    // Resolve pricing plan ID
    const pricingPlanId =
      typeof props.pricingPlan === "string"
        ? props.pricingPlan
        : props.pricingPlan.id;

    // Resolve rate card or license fee ID based on type
    const rateCardId =
      props.rateCard && typeof props.rateCard === "string"
        ? props.rateCard
        : props.rateCard?.id;

    const licenseFeeId =
      props.licenseFee && typeof props.licenseFee === "string"
        ? props.licenseFee
        : props.licenseFee?.id;

    // Validate props based on type
    if (props.type === "rate_card" && !rateCardId) {
      throw new Error("rateCard is required when type is 'rate_card'");
    }

    if (props.type === "license_fee" && !licenseFeeId) {
      throw new Error("licenseFee is required when type is 'license_fee'");
    }

    if (this.phase === "delete") {
      // Note: v2 billing pricing plan components may not support direct deletion
      if (this.output?.id && this.output?.pricingPlan) {
        try {
          await client.pricingPlanComponents.del(
            this.output.pricingPlan,
            this.output.id,
          );
        } catch (error: any) {
          // If deletion is not supported (404), log and continue
          if (error?.status === 404 || error?.statusCode === 404) {
            logger.log(
              `PricingPlanComponent ${this.output.id} deletion not supported (may need to be archived instead)`,
            );
          } else {
            handleStripeV2DeleteError(
              error,
              "PricingPlanComponent",
              this.output.id,
            );
          }
        }
      }
      return this.destroy();
    }

    try {
      let component: V2PricingPlanComponent;

      if (this.phase === "update" && this.output?.id) {
        // Update existing component (limited fields can be updated)
        component = await client.pricingPlanComponents.update(
          this.output.pricingPlan,
          this.output.id,
          {
            metadata: props.metadata,
          },
        );
      } else {
        // Create new component
        // Note: rate_card and license_fee must be objects with id property
        component = await client.pricingPlanComponents.create(pricingPlanId, {
          type: props.type,
          rate_card: rateCardId ? { id: rateCardId } : undefined,
          license_fee: licenseFeeId ? { id: licenseFeeId } : undefined,
          metadata: props.metadata,
        });
      }

      return mapV2ComponentToOutput(component);
    } catch (error) {
      logger.error("Error creating/updating pricing plan component:", error);
      throw error;
    }
  },
);

/**
 * Maps a V2 Pricing Plan Component API response to the output interface
 */
function mapV2ComponentToOutput(
  component: V2PricingPlanComponent,
): PricingPlanComponent {
  return {
    id: component.id,
    pricingPlan: component.pricing_plan,
    type: component.type,
    rateCard: component.rate_card,
    licenseFee: component.license_fee,
    metadata: component.metadata,
    createdAt: component.created,
    updatedAt: component.updated,
    livemode: component.livemode,
  };
}
