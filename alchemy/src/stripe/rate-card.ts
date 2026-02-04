import type { Context } from "../context.ts";
import { Resource } from "../resource.ts";
import type { Secret } from "../secret.ts";
import { logger } from "../util/logger.ts";
import {
  createStripeV2Client,
  handleStripeV2DeleteError,
  isStripeV2ConflictError,
  type V2RateCard,
} from "./v2-client.ts";

/**
 * Properties for creating or updating a Stripe Rate Card
 */
export interface RateCardProps {
  /**
   * The display name of the rate card
   */
  displayName: string;

  /**
   * Three-letter ISO currency code for this rate card
   */
  currency: string;

  /**
   * The service interval for this rate card
   * @default "month"
   */
  serviceInterval?: "day" | "week" | "month" | "year";

  /**
   * The number of service intervals
   * @default 1
   */
  serviceIntervalCount?: number;

  /**
   * Whether tax is exclusive or inclusive in amounts
   * @default "exclusive"
   */
  taxBehavior?: "exclusive" | "inclusive";

  /**
   * A lookup key to uniquely identify this rate card
   */
  lookupKey?: string;

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
 * Output returned after Stripe Rate Card creation/update
 */
export interface RateCard {
  /**
   * The ID of the rate card
   */
  id: string;

  /**
   * The display name of the rate card
   */
  displayName: string;

  /**
   * Three-letter ISO currency code for this rate card
   */
  currency: string;

  /**
   * The service interval for this rate card
   */
  serviceInterval: "day" | "week" | "month" | "year";

  /**
   * The number of service intervals
   */
  serviceIntervalCount: number;

  /**
   * Whether tax is exclusive or inclusive in amounts
   */
  taxBehavior: "exclusive" | "inclusive";

  /**
   * A lookup key to uniquely identify this rate card
   */
  lookupKey?: string;

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
 * Manages Stripe Rate Cards. A Rate Card is a container for usage-based
 * pricing that can be attached to a Pricing Plan. Rate Cards hold multiple
 * Rates that define the pricing for different metered items.
 *
 * Rate Cards enable subscription to multiple rates for usage-based services
 * through a single interface.
 *
 * @example
 * // Create a basic rate card for API usage
 * const apiRateCard = await RateCard("api-usage", {
 *   displayName: "API Usage Rate Card",
 *   currency: "usd",
 *   metadata: {
 *     type: "api"
 *   }
 * });
 *
 * @example
 * // Create a rate card with a lookup key
 * const storageRateCard = await RateCard("storage", {
 *   displayName: "Storage Rate Card",
 *   currency: "usd",
 *   serviceInterval: "month",
 *   lookupKey: "storage-rates-2024",
 *   metadata: {
 *     type: "storage",
 *     unit: "gb"
 *   }
 * });
 *
 * @example
 * // Create a rate card in EUR with annual billing
 * const euroRateCard = await RateCard("euro-rates", {
 *   displayName: "European Rate Card",
 *   currency: "eur",
 *   serviceInterval: "year",
 *   taxBehavior: "inclusive",
 *   lookupKey: "eu-rates"
 * });
 */
export const RateCard = Resource(
  "stripe::RateCard",
  async function (
    this: Context<RateCard>,
    _id: string,
    props: RateCardProps,
  ): Promise<RateCard> {
    const adopt = props.adopt ?? this.scope.adopt;
    const client = await createStripeV2Client({ apiKey: props.apiKey });
    const serviceInterval = props.serviceInterval ?? "month";
    const serviceIntervalCount = props.serviceIntervalCount ?? 1;
    const taxBehavior = props.taxBehavior ?? "exclusive";

    if (this.phase === "delete") {
      // Note: v2 billing rate cards may not support direct deletion
      // They are typically managed by archiving or setting active: false
      if (this.output?.id) {
        try {
          await client.rateCards.del(this.output.id);
        } catch (error: any) {
          // If deletion is not supported (404), log and continue
          if (error?.status === 404 || error?.statusCode === 404) {
            logger.log(
              `RateCard ${this.output.id} deletion not supported (may need to be archived instead)`,
            );
          } else {
            handleStripeV2DeleteError(error, "RateCard", this.output.id);
          }
        }
      }
      return this.destroy();
    }

    try {
      let rateCard: V2RateCard;

      if (this.phase === "update" && this.output?.id) {
        // Update existing rate card
        rateCard = await client.rateCards.update(this.output.id, {
          display_name: props.displayName,
          lookup_key: props.lookupKey,
          metadata: props.metadata,
        });
      } else {
        // Create new rate card
        try {
          rateCard = await client.rateCards.create({
            display_name: props.displayName,
            currency: props.currency,
            service_interval: serviceInterval,
            service_interval_count: serviceIntervalCount,
            tax_behavior: taxBehavior,
            lookup_key: props.lookupKey,
            metadata: props.metadata,
          });
        } catch (error) {
          if (isStripeV2ConflictError(error) && adopt && props.lookupKey) {
            // Try to find existing rate card by lookup key
            const existingRateCards = await client.rateCards.list();
            const existingRateCard = existingRateCards.data.find(
              (rc) => rc.lookup_key === props.lookupKey,
            );

            if (existingRateCard) {
              rateCard = await client.rateCards.update(existingRateCard.id, {
                display_name: props.displayName,
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

      return mapV2RateCardToOutput(rateCard);
    } catch (error) {
      logger.error("Error creating/updating rate card:", error);
      throw error;
    }
  },
);

/**
 * Maps a V2 Rate Card API response to the output interface
 */
function mapV2RateCardToOutput(rateCard: V2RateCard): RateCard {
  return {
    id: rateCard.id,
    displayName: rateCard.display_name,
    currency: rateCard.currency,
    serviceInterval: rateCard.service_interval,
    serviceIntervalCount: rateCard.service_interval_count,
    taxBehavior: rateCard.tax_behavior,
    lookupKey: rateCard.lookup_key,
    metadata: rateCard.metadata,
    createdAt: rateCard.created,
    updatedAt: rateCard.updated,
    livemode: rateCard.livemode,
  };
}
