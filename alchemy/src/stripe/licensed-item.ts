import type { Context } from "../context.ts";
import { Resource } from "../resource.ts";
import type { Secret } from "../secret.ts";
import { logger } from "../util/logger.ts";
import {
  createStripeV2Client,
  handleStripeV2DeleteError,
  isStripeV2ConflictError,
  type V2LicensedItem,
} from "./v2-client.ts";

/**
 * Properties for creating or updating a Stripe Licensed Item
 */
export interface LicensedItemProps {
  /**
   * The display name of the licensed item
   */
  displayName: string;

  /**
   * A lookup key to uniquely identify this licensed item
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
 * Output returned after Stripe Licensed Item creation/update
 */
export interface LicensedItem {
  /**
   * The ID of the licensed item
   */
  id: string;

  /**
   * The display name of the licensed item
   */
  displayName: string;

  /**
   * A lookup key to uniquely identify this licensed item
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
 * Manages Stripe Licensed Items. A Licensed Item is a flat-fee billable item
 * that can be used to create License Fees. Unlike Metered Items which are
 * usage-based, Licensed Items represent fixed recurring charges.
 *
 * @example
 * // Create a basic licensed item for a platform fee
 * const platformFeeItem = await LicensedItem("platform-fee", {
 *   displayName: "Platform Fee",
 *   metadata: {
 *     type: "platform"
 *   }
 * });
 *
 * @example
 * // Create a licensed item with a lookup key for a software license
 * const softwareLicense = await LicensedItem("software-license", {
 *   displayName: "Software License",
 *   lookupKey: "software-license-2024",
 *   metadata: {
 *     tier: "enterprise",
 *     seats: "unlimited"
 *   }
 * });
 *
 * @example
 * // Create a licensed item for support services
 * const supportItem = await LicensedItem("premium-support", {
 *   displayName: "Premium Support",
 *   lookupKey: "premium-support",
 *   metadata: {
 *     sla: "24h",
 *     channels: "email,phone,chat"
 *   }
 * });
 */
export const LicensedItem = Resource(
  "stripe::LicensedItem",
  async function (
    this: Context<LicensedItem>,
    _id: string,
    props: LicensedItemProps,
  ): Promise<LicensedItem> {
    const adopt = props.adopt ?? this.scope.adopt;
    const client = await createStripeV2Client({ apiKey: props.apiKey });

    if (this.phase === "delete") {
      // Note: v2 billing licensed items may not support direct deletion
      if (this.output?.id) {
        try {
          await client.licensedItems.del(this.output.id);
        } catch (error: any) {
          // If deletion is not supported (404), log and continue
          if (error?.status === 404 || error?.statusCode === 404) {
            logger.log(
              `LicensedItem ${this.output.id} deletion not supported (may need to be archived instead)`,
            );
          } else {
            handleStripeV2DeleteError(error, "LicensedItem", this.output.id);
          }
        }
      }
      return this.destroy();
    }

    try {
      let licensedItem: V2LicensedItem;

      if (this.phase === "update" && this.output?.id) {
        // Update existing licensed item
        licensedItem = await client.licensedItems.update(this.output.id, {
          display_name: props.displayName,
          lookup_key: props.lookupKey,
          metadata: props.metadata,
        });
      } else {
        // Create new licensed item
        try {
          licensedItem = await client.licensedItems.create({
            display_name: props.displayName,
            lookup_key: props.lookupKey,
            metadata: props.metadata,
          });
        } catch (error) {
          if (isStripeV2ConflictError(error) && adopt && props.lookupKey) {
            // Try to find existing licensed item by lookup key
            const existingItems = await client.licensedItems.list();
            const existingItem = existingItems.data.find(
              (li) => li.lookup_key === props.lookupKey,
            );

            if (existingItem) {
              licensedItem = await client.licensedItems.update(existingItem.id, {
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

      return mapV2LicensedItemToOutput(licensedItem);
    } catch (error) {
      logger.error("Error creating/updating licensed item:", error);
      throw error;
    }
  },
);

/**
 * Maps a V2 Licensed Item API response to the output interface
 */
function mapV2LicensedItemToOutput(licensedItem: V2LicensedItem): LicensedItem {
  return {
    id: licensedItem.id,
    displayName: licensedItem.display_name,
    lookupKey: licensedItem.lookup_key,
    metadata: licensedItem.metadata,
    createdAt: licensedItem.created,
    updatedAt: licensedItem.updated,
    livemode: licensedItem.livemode,
  };
}
