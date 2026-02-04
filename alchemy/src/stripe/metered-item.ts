import type { Context } from "../context.ts";
import { Resource } from "../resource.ts";
import type { Secret } from "../secret.ts";
import { logger } from "../util/logger.ts";
import type { Meter } from "./meter.ts";
import {
  createStripeV2Client,
  handleStripeV2DeleteError,
  isStripeV2ConflictError,
  type V2MeteredItem,
} from "./v2-client.ts";

/**
 * Properties for creating or updating a Stripe Metered Item
 */
export interface MeteredItemProps {
  /**
   * The display name of the metered item
   */
  displayName: string;

  /**
   * The ID of the meter this item is linked to, or a Meter resource
   */
  meter: string | Meter;

  /**
   * A lookup key to uniquely identify this metered item
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
 * Output returned after Stripe Metered Item creation/update
 */
export interface MeteredItem {
  /**
   * The ID of the metered item
   */
  id: string;

  /**
   * The display name of the metered item
   */
  displayName: string;

  /**
   * The ID of the meter this item is linked to
   */
  meter: string;

  /**
   * A lookup key to uniquely identify this metered item
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
 * Manages Stripe Metered Items. A Metered Item ties a billing meter to a
 * billable item that you can price. Metered Items are used with Rate Cards
 * to define usage-based pricing.
 *
 * @example
 * // Create a metered item linked to a meter by ID
 * const apiUsageItem = await MeteredItem("api-usage-item", {
 *   displayName: "API Usage",
 *   meter: "mtr_abc123",
 *   metadata: {
 *     unit: "request"
 *   }
 * });
 *
 * @example
 * // Create a metered item linked to a Meter resource
 * const meter = await Meter("api-meter", {
 *   displayName: "API Meter",
 *   eventName: "api.request",
 *   defaultAggregation: { formula: "sum" },
 *   customerMapping: { eventPayloadKey: "customer_id", type: "by_id" },
 *   valueSettings: { eventPayloadKey: "count" }
 * });
 *
 * const meteredItem = await MeteredItem("api-item", {
 *   displayName: "API Requests",
 *   meter: meter,
 *   lookupKey: "api-requests-item"
 * });
 *
 * @example
 * // Create a storage metered item
 * const storageItem = await MeteredItem("storage-item", {
 *   displayName: "Storage Usage",
 *   meter: "mtr_storage123",
 *   lookupKey: "storage-gb",
 *   metadata: {
 *     unit: "gigabyte",
 *     billing: "monthly"
 *   }
 * });
 */
export const MeteredItem = Resource(
  "stripe::MeteredItem",
  async function (
    this: Context<MeteredItem>,
    _id: string,
    props: MeteredItemProps,
  ): Promise<MeteredItem> {
    const adopt = props.adopt ?? this.scope.adopt;
    const client = await createStripeV2Client({ apiKey: props.apiKey });

    // Resolve meter ID from string or Meter resource
    const meterId =
      typeof props.meter === "string" ? props.meter : props.meter.id;

    if (this.phase === "delete") {
      // Note: v2 billing metered items may not support direct deletion
      if (this.output?.id) {
        try {
          await client.meteredItems.del(this.output.id);
        } catch (error: any) {
          // If deletion is not supported (404), log and continue
          if (error?.status === 404 || error?.statusCode === 404) {
            logger.log(
              `MeteredItem ${this.output.id} deletion not supported (may need to be archived instead)`,
            );
          } else {
            handleStripeV2DeleteError(error, "MeteredItem", this.output.id);
          }
        }
      }
      return this.destroy();
    }

    try {
      let meteredItem: V2MeteredItem;

      if (this.phase === "update" && this.output?.id) {
        // Update existing metered item
        meteredItem = await client.meteredItems.update(this.output.id, {
          display_name: props.displayName,
          lookup_key: props.lookupKey,
          metadata: props.metadata,
        });
      } else {
        // Create new metered item
        try {
          meteredItem = await client.meteredItems.create({
            display_name: props.displayName,
            meter: meterId,
            lookup_key: props.lookupKey,
            metadata: props.metadata,
          });
        } catch (error) {
          if (isStripeV2ConflictError(error) && adopt && props.lookupKey) {
            // Try to find existing metered item by lookup key
            const existingItems = await client.meteredItems.list();
            const existingItem = existingItems.data.find(
              (mi) => mi.lookup_key === props.lookupKey,
            );

            if (existingItem) {
              meteredItem = await client.meteredItems.update(existingItem.id, {
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

      return mapV2MeteredItemToOutput(meteredItem);
    } catch (error) {
      logger.error("Error creating/updating metered item:", error);
      throw error;
    }
  },
);

/**
 * Maps a V2 Metered Item API response to the output interface
 */
function mapV2MeteredItemToOutput(meteredItem: V2MeteredItem): MeteredItem {
  return {
    id: meteredItem.id,
    displayName: meteredItem.display_name,
    meter: meteredItem.meter,
    lookupKey: meteredItem.lookup_key,
    metadata: meteredItem.metadata,
    createdAt: meteredItem.created,
    updatedAt: meteredItem.updated,
    livemode: meteredItem.livemode,
  };
}
