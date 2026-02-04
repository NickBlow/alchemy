import { describe, expect } from "vitest";
import { alchemy } from "../../src/alchemy.ts";
import { destroy } from "../../src/destroy.ts";
import { Meter } from "../../src/stripe/meter.ts";
import { MeteredItem } from "../../src/stripe/metered-item.ts";
import { createStripeV2Client } from "../../src/stripe/v2-client.ts";
import { BRANCH_PREFIX } from "../util.ts";

import "../../src/test/vitest.ts";

const test = alchemy.test(import.meta, {
  prefix: BRANCH_PREFIX,
});

const stripeApiKey = import.meta.env.STRIPE_API_KEY;
if (!stripeApiKey) {
  throw new Error("STRIPE_API_KEY environment variable is required");
}

// Initialize a Stripe v2 client for verification
const client = await createStripeV2Client({ apiKey: stripeApiKey });

describe("MeteredItem Resource", () => {
  const testMeteredItemId = `${BRANCH_PREFIX}-metered-item`;
  const testMeterId = `${BRANCH_PREFIX}-mi-meter`;

  test("create, update, and delete metered item", async (scope) => {
    let meter: Meter | undefined;
    let meteredItem: MeteredItem | undefined;

    try {
      // First create a meter (required for metered item)
      meter = await Meter(testMeterId, {
        displayName: `${BRANCH_PREFIX} Metered Item Test Meter`,
        eventName: `${BRANCH_PREFIX}_metered_item_test`,
        defaultAggregation: { formula: "sum" },
        customerMapping: { eventPayloadKey: "customer_id", type: "by_id" },
        valueSettings: { eventPayloadKey: "count" },
      });

      expect(meter.id).toBeTruthy();

      // Create a metered item linked to the meter
      meteredItem = await MeteredItem(testMeteredItemId, {
        displayName: `${BRANCH_PREFIX} Test Metered Item`,
        meter: meter,
        metadata: {
          test: "initial",
        },
      });

      expect(meteredItem.id).toBeTruthy();
      expect(meteredItem).toMatchObject({
        displayName: `${BRANCH_PREFIX} Test Metered Item`,
        meter: meter.id,
        metadata: { test: "initial" },
      });

      // Verify with Stripe API
      const stripeMeteredItem = await client.meteredItems.retrieve(
        meteredItem.id,
      );
      expect(stripeMeteredItem.display_name).toEqual(
        `${BRANCH_PREFIX} Test Metered Item`,
      );
      expect(stripeMeteredItem.meter).toEqual(meter.id);

      // Update the metered item
      meteredItem = await MeteredItem(testMeteredItemId, {
        displayName: `${BRANCH_PREFIX} Updated Metered Item`,
        meter: meter,
        metadata: {
          test: "updated",
          version: "2",
        },
      });

      expect(meteredItem.id).toBeTruthy();
      expect(meteredItem).toMatchObject({
        displayName: `${BRANCH_PREFIX} Updated Metered Item`,
        metadata: { test: "updated", version: "2" },
      });
    } catch (err) {
      console.log(err);
      throw err;
    } finally {
      await destroy(scope);
    }
  });

  test("create metered item with lookup key", async (scope) => {
    const lookupKey = `${BRANCH_PREFIX}-mi-lookup`;
    let meter: Meter | undefined;
    let meteredItem: MeteredItem | undefined;

    try {
      meter = await Meter(`${testMeterId}-lookup`, {
        displayName: `${BRANCH_PREFIX} Lookup Metered Item Meter`,
        eventName: `${BRANCH_PREFIX}_mi_lookup_test`,
        defaultAggregation: { formula: "sum" },
        customerMapping: { eventPayloadKey: "customer_id", type: "by_id" },
        valueSettings: { eventPayloadKey: "count" },
      });

      meteredItem = await MeteredItem(`${testMeteredItemId}-lookup`, {
        displayName: `${BRANCH_PREFIX} Lookup Key Metered Item`,
        meter: meter.id, // Test with meter ID string
        lookupKey: lookupKey,
        metadata: {
          type: "lookup-test",
        },
      });

      expect(meteredItem.id).toBeTruthy();
      expect(meteredItem.lookupKey).toEqual(lookupKey);

      // Verify with Stripe API
      const stripeMeteredItem = await client.meteredItems.retrieve(
        meteredItem.id,
      );
      expect(stripeMeteredItem.lookup_key).toEqual(lookupKey);
    } catch (err) {
      console.log(err);
      throw err;
    } finally {
      await destroy(scope);
    }
  });
});
