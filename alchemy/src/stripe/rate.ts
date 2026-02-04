import type { Context } from "../context.ts";
import { Resource } from "../resource.ts";
import type { Secret } from "../secret.ts";
import { logger } from "../util/logger.ts";
import type { MeteredItem } from "./metered-item.ts";
import type { RateCard } from "./rate-card.ts";
import {
  createStripeV2Client,
  handleStripeV2DeleteError,
  type V2Rate,
  type V2RateTier,
} from "./v2-client.ts";

/**
 * Rate tier configuration
 */
export interface RateTier {
  /**
   * The upper bound for this tier. Use "inf" for the last tier.
   */
  upTo: number | "inf";

  /**
   * The per-unit price in cents (will be converted to string)
   */
  unitAmount?: number;

  /**
   * The flat amount for this entire tier in cents (will be converted to string)
   */
  flatAmount?: number;
}

/**
 * Properties for creating or updating a Stripe Rate
 */
export interface RateProps {
  /**
   * The rate card this rate belongs to, as ID or RateCard resource
   */
  rateCard: string | RateCard;

  /**
   * The metered item this rate prices, as ID or MeteredItem resource
   */
  meteredItem: string | MeteredItem;

  /**
   * The per-unit price in cents (will be converted to string)
   */
  unitAmount?: number;

  /**
   * Pricing tiers
   */
  tiers?: RateTier[];

  /**
   * The tiering mode: graduated or volume
   */
  tiersMode?: "graduated" | "volume";

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
 * Output returned after Stripe Rate creation/update
 */
export interface Rate {
  /**
   * The ID of the rate
   */
  id: string;

  /**
   * The ID of the rate card this rate belongs to
   */
  rateCard: string;

  /**
   * The ID of the metered item this rate prices
   */
  meteredItem: string;

  /**
   * The per-unit price as a string
   */
  unitAmount?: string;

  /**
   * Pricing tiers
   */
  tiers?: RateTier[];

  /**
   * The tiering mode
   */
  tiersMode?: "graduated" | "volume";

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
 * Manages Stripe Rates. A Rate defines the unit pricing or tiering for a
 * metered item on a rate card. Rates are children of Rate Cards and determine
 * how usage is billed for specific metered items.
 *
 * @example
 * // Create a simple per-unit rate
 * const apiRate = await Rate("api-rate", {
 *   rateCard: rateCard,
 *   meteredItem: meteredItem,
 *   unitAmount: 10, // $0.10 per unit
 * });
 *
 * @example
 * // Create a graduated tiered rate
 * const tieredRate = await Rate("tiered-rate", {
 *   rateCard: "rc_abc123",
 *   meteredItem: "mi_xyz789",
 *   tiersMode: "graduated",
 *   tiers: [
 *     { upTo: 1000, unitAmount: 0 },      // First 1000 free
 *     { upTo: 10000, unitAmount: 5 },     // $0.05 per unit
 *     { upTo: "inf", unitAmount: 2 }      // $0.02 per unit after
 *   ]
 * });
 *
 * @example
 * // Create a volume tiered rate with flat amounts
 * const volumeRate = await Rate("volume-rate", {
 *   rateCard: rateCard,
 *   meteredItem: meteredItem,
 *   tiersMode: "volume",
 *   tiers: [
 *     { upTo: 100, unitAmount: 500 },      // $5 per unit up to 100
 *     { upTo: 1000, unitAmount: 300 },     // $3 per unit for 101-1000
 *     { upTo: "inf", flatAmount: 200000 }  // $2000 flat for unlimited
 *   ],
 *   metadata: {
 *     pricing: "volume"
 *   }
 * });
 */
export const Rate = Resource(
  "stripe::Rate",
  async function (
    this: Context<Rate>,
    _id: string,
    props: RateProps,
  ): Promise<Rate> {
    const client = await createStripeV2Client({ apiKey: props.apiKey });

    // Resolve IDs from resources
    const rateCardId =
      typeof props.rateCard === "string" ? props.rateCard : props.rateCard.id;
    const meteredItemId =
      typeof props.meteredItem === "string"
        ? props.meteredItem
        : props.meteredItem.id;

    if (this.phase === "delete") {
      // Note: v2 billing rates may not support direct deletion
      if (this.output?.id && this.output?.rateCard) {
        try {
          await client.rates.del(this.output.rateCard, this.output.id);
        } catch (error: any) {
          // If deletion is not supported (404), log and continue
          if (error?.status === 404 || error?.statusCode === 404) {
            logger.log(
              `Rate ${this.output.id} deletion not supported (may need to be archived instead)`,
            );
          } else {
            handleStripeV2DeleteError(error, "Rate", this.output.id);
          }
        }
      }
      return this.destroy();
    }

    // Validate rate configuration
    const hasTiers = props.tiers && props.tiers.length > 0;
    const hasUnitAmount = props.unitAmount !== undefined;

    if (hasTiers && hasUnitAmount) {
      throw new Error("Cannot specify both unitAmount and tiers. Use one or the other.");
    }

    if (!hasTiers && !hasUnitAmount) {
      throw new Error("Either unitAmount or tiers is required");
    }

    try {
      let rate: V2Rate;

      // Transform tiers for API (convert numbers to strings)
      const apiTiers = props.tiers?.map((tier) => ({
        up_to: tier.upTo,
        unit_amount: tier.unitAmount !== undefined ? String(tier.unitAmount) : undefined,
        flat_amount: tier.flatAmount !== undefined ? String(tier.flatAmount) : undefined,
      }));

      if (this.phase === "update" && this.output?.id) {
        // Update existing rate
        rate = await client.rates.update(this.output.rateCard, this.output.id, {
          unit_amount: hasUnitAmount ? String(props.unitAmount) : undefined,
          tiers: apiTiers,
          tiers_mode: props.tiersMode,
          metadata: props.metadata,
        });
      } else {
        // Create new rate
        rate = await client.rates.create(rateCardId, {
          metered_item: meteredItemId,
          unit_amount: hasUnitAmount ? String(props.unitAmount) : undefined,
          tiers: apiTiers,
          tiers_mode: props.tiersMode,
          metadata: props.metadata,
        });
      }

      return mapV2RateToOutput(rate);
    } catch (error) {
      logger.error("Error creating/updating rate:", error);
      throw error;
    }
  },
);

/**
 * Maps a V2 Rate API response to the output interface
 */
function mapV2RateToOutput(rate: V2Rate): Rate {
  return {
    id: rate.id,
    rateCard: rate.rate_card,
    meteredItem: rate.metered_item,
    unitAmount: rate.unit_amount,
    tiers: rate.tiers?.map(mapV2TierToOutput),
    tiersMode: rate.tiers_mode,
    metadata: rate.metadata,
    createdAt: rate.created,
    updatedAt: rate.updated,
    livemode: rate.livemode,
  };
}

/**
 * Maps a V2 tier to the output format
 */
function mapV2TierToOutput(tier: V2RateTier): RateTier {
  return {
    upTo: tier.up_to === null ? "inf" : tier.up_to,
    unitAmount: tier.unit_amount ? parseInt(tier.unit_amount, 10) : undefined,
    flatAmount: tier.flat_amount ? parseInt(tier.flat_amount, 10) : undefined,
  };
}
