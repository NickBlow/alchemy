import type { Context } from "../context.ts";
import { Resource } from "../resource.ts";
import type { Secret } from "../secret.ts";
import { logger } from "../util/logger.ts";
import type { LicensedItem } from "./licensed-item.ts";
import {
  createStripeV2Client,
  handleStripeV2DeleteError,
  isStripeV2ConflictError,
  type V2LicenseFee,
} from "./v2-client.ts";

/**
 * Properties for creating or updating a Stripe License Fee
 */
export interface LicenseFeeProps {
  /**
   * The display name of the license fee
   */
  displayName: string;

  /**
   * The licensed item this fee is for, as ID or LicensedItem resource
   */
  licensedItem: string | LicensedItem;

  /**
   * Three-letter ISO currency code
   */
  currency: string;

  /**
   * The amount in cents to charge (will be converted to string)
   */
  unitAmount: number;

  /**
   * The billing service interval
   */
  serviceInterval: "day" | "week" | "month" | "year";

  /**
   * The number of service intervals between billings
   * @default 1
   */
  serviceIntervalCount?: number;

  /**
   * Whether tax is exclusive or inclusive in amounts
   * @default "exclusive"
   */
  taxBehavior?: "exclusive" | "inclusive";

  /**
   * A lookup key to uniquely identify this license fee
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
 * Output returned after Stripe License Fee creation/update
 */
export interface LicenseFee {
  /**
   * The ID of the license fee
   */
  id: string;

  /**
   * The display name of the license fee
   */
  displayName: string;

  /**
   * The ID of the licensed item this fee is for
   */
  licensedItem: string;

  /**
   * Three-letter ISO currency code
   */
  currency: string;

  /**
   * The unit amount as a string
   */
  unitAmount: string;

  /**
   * The billing service interval
   */
  serviceInterval: "day" | "week" | "month" | "year";

  /**
   * The number of service intervals between billings
   */
  serviceIntervalCount: number;

  /**
   * Whether tax is exclusive or inclusive in amounts
   */
  taxBehavior: "exclusive" | "inclusive";

  /**
   * A lookup key to uniquely identify this license fee
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
 * Manages Stripe License Fees. A License Fee defines a recurring flat fee
 * for a licensed item. License Fees can be attached to Pricing Plans as
 * components alongside Rate Cards.
 *
 * @example
 * // Create a monthly platform fee
 * const platformFee = await LicenseFee("platform-fee", {
 *   displayName: "Platform Fee",
 *   licensedItem: licensedItem,
 *   currency: "usd",
 *   unitAmount: 9900, // $99.00
 *   serviceInterval: "month"
 * });
 *
 * @example
 * // Create an annual software license fee
 * const annualLicense = await LicenseFee("annual-license", {
 *   displayName: "Annual Software License",
 *   licensedItem: "li_abc123",
 *   currency: "usd",
 *   unitAmount: 99900, // $999.00
 *   serviceInterval: "year",
 *   lookupKey: "annual-license-2024",
 *   metadata: {
 *     tier: "enterprise"
 *   }
 * });
 *
 * @example
 * // Create a quarterly support fee
 * const supportFee = await LicenseFee("support-fee", {
 *   displayName: "Premium Support",
 *   licensedItem: supportItem,
 *   currency: "usd",
 *   unitAmount: 29900, // $299.00
 *   serviceInterval: "month",
 *   serviceIntervalCount: 3, // Every 3 months
 *   metadata: {
 *     sla: "24h",
 *     support_level: "premium"
 *   }
 * });
 */
export const LicenseFee = Resource(
  "stripe::LicenseFee",
  async function (
    this: Context<LicenseFee>,
    _id: string,
    props: LicenseFeeProps,
  ): Promise<LicenseFee> {
    const adopt = props.adopt ?? this.scope.adopt;
    const client = await createStripeV2Client({ apiKey: props.apiKey });
    const serviceIntervalCount = props.serviceIntervalCount ?? 1;
    const taxBehavior = props.taxBehavior ?? "exclusive";

    // Resolve licensed item ID from string or resource
    const licensedItemId =
      typeof props.licensedItem === "string"
        ? props.licensedItem
        : props.licensedItem.id;

    if (this.phase === "delete") {
      // Note: v2 billing license fees may not support direct deletion
      if (this.output?.id) {
        try {
          await client.licenseFees.del(this.output.id);
        } catch (error: any) {
          // If deletion is not supported (404), log and continue
          if (error?.status === 404 || error?.statusCode === 404) {
            logger.log(
              `LicenseFee ${this.output.id} deletion not supported (may need to be archived instead)`,
            );
          } else {
            handleStripeV2DeleteError(error, "LicenseFee", this.output.id);
          }
        }
      }
      return this.destroy();
    }

    try {
      let licenseFee: V2LicenseFee;

      if (this.phase === "update" && this.output?.id) {
        // Update existing license fee (limited fields can be updated)
        licenseFee = await client.licenseFees.update(this.output.id, {
          display_name: props.displayName,
          lookup_key: props.lookupKey,
          metadata: props.metadata,
        });
      } else {
        // Create new license fee
        try {
          licenseFee = await client.licenseFees.create({
            display_name: props.displayName,
            licensed_item: licensedItemId,
            currency: props.currency,
            unit_amount: String(props.unitAmount),
            service_interval: props.serviceInterval,
            service_interval_count: serviceIntervalCount,
            tax_behavior: taxBehavior,
            lookup_key: props.lookupKey,
            metadata: props.metadata,
          });
        } catch (error) {
          if (isStripeV2ConflictError(error) && adopt && props.lookupKey) {
            // Try to find existing license fee by lookup key
            const existingFees = await client.licenseFees.list();
            const existingFee = existingFees.data.find(
              (lf) => lf.lookup_key === props.lookupKey,
            );

            if (existingFee) {
              licenseFee = await client.licenseFees.update(existingFee.id, {
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

      return mapV2LicenseFeeToOutput(licenseFee);
    } catch (error) {
      logger.error("Error creating/updating license fee:", error);
      throw error;
    }
  },
);

/**
 * Maps a V2 License Fee API response to the output interface
 */
function mapV2LicenseFeeToOutput(licenseFee: V2LicenseFee): LicenseFee {
  return {
    id: licenseFee.id,
    displayName: licenseFee.display_name,
    licensedItem: licenseFee.licensed_item,
    currency: licenseFee.currency,
    unitAmount: licenseFee.unit_amount,
    serviceInterval: licenseFee.service_interval,
    serviceIntervalCount: licenseFee.service_interval_count,
    taxBehavior: licenseFee.tax_behavior,
    lookupKey: licenseFee.lookup_key,
    metadata: licenseFee.metadata,
    createdAt: licenseFee.created,
    updatedAt: licenseFee.updated,
    livemode: licenseFee.livemode,
  };
}
