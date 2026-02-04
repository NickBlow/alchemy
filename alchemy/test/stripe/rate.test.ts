import { describe, expect } from "vitest";
import { alchemy } from "../../src/alchemy.ts";
import { destroy } from "../../src/destroy.ts";
import { Meter } from "../../src/stripe/meter.ts";
import { MeteredItem } from "../../src/stripe/metered-item.ts";
import { Rate } from "../../src/stripe/rate.ts";
import { RateCard } from "../../src/stripe/rate-card.ts";
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

describe("Rate Resource", () => {
  const testRateId = `${BRANCH_PREFIX}-rate`;
  const testRateCardId = `${BRANCH_PREFIX}-rate-rc`;
  const testMeteredItemId = `${BRANCH_PREFIX}-rate-mi`;
  const testMeterId = `${BRANCH_PREFIX}-rate-meter`;

  test("create per-unit rate", async (scope) => {
    let meter: Meter | undefined;
    let meteredItem: MeteredItem | undefined;
    let rateCard: RateCard | undefined;
    let rate: Rate | undefined;

    try {
      // Create dependencies
      meter = await Meter(testMeterId, {
        displayName: `${BRANCH_PREFIX} Rate Test Meter`,
        eventName: `${BRANCH_PREFIX}_rate_test`,
        defaultAggregation: { formula: "sum" },
        customerMapping: { eventPayloadKey: "customer_id", type: "by_id" },
        valueSettings: { eventPayloadKey: "count" },
      });

      meteredItem = await MeteredItem(testMeteredItemId, {
        displayName: `${BRANCH_PREFIX} Rate Test Metered Item`,
        meter: meter,
      });

      rateCard = await RateCard(testRateCardId, {
        displayName: `${BRANCH_PREFIX} Rate Test Rate Card`,
        currency: "usd",
      });

      // Create a per-unit rate
      rate = await Rate(testRateId, {
        rateCard: rateCard,
        meteredItem: meteredItem,
        unitAmount: 10, // $0.10 per unit
        metadata: {
          test: "per-unit",
        },
      });

      expect(rate.id).toBeTruthy();
      expect(rate).toMatchObject({
        rateCard: rateCard.id,
        meteredItem: meteredItem.id,
        unitAmount: "10",
        metadata: { test: "per-unit" },
      });

      // Verify with Stripe API
      const stripeRate = await client.rates.retrieve(rateCard.id, rate.id);
      expect(stripeRate.unit_amount).toEqual("10");
    } catch (err) {
      console.log(err);
      throw err;
    } finally {
      await destroy(scope);
    }
  });

  test("create graduated tiered rate", async (scope) => {
    let meter: Meter | undefined;
    let meteredItem: MeteredItem | undefined;
    let rateCard: RateCard | undefined;
    let rate: Rate | undefined;

    try {
      meter = await Meter(`${testMeterId}-tiered`, {
        displayName: `${BRANCH_PREFIX} Tiered Rate Test Meter`,
        eventName: `${BRANCH_PREFIX}_tiered_rate_test`,
        defaultAggregation: { formula: "sum" },
        customerMapping: { eventPayloadKey: "customer_id", type: "by_id" },
        valueSettings: { eventPayloadKey: "count" },
      });

      meteredItem = await MeteredItem(`${testMeteredItemId}-tiered`, {
        displayName: `${BRANCH_PREFIX} Tiered Rate Test Metered Item`,
        meter: meter,
      });

      rateCard = await RateCard(`${testRateCardId}-tiered`, {
        displayName: `${BRANCH_PREFIX} Tiered Rate Test Rate Card`,
        currency: "usd",
      });

      // Create a graduated tiered rate
      rate = await Rate(`${testRateId}-tiered`, {
        rateCard: rateCard,
        meteredItem: meteredItem,
        tiersMode: "graduated",
        tiers: [
          { upTo: 1000, unitAmount: 0 }, // First 1000 free
          { upTo: 10000, unitAmount: 5 }, // $0.05 per unit
          { upTo: "inf", unitAmount: 2 }, // $0.02 per unit after
        ],
        metadata: {
          test: "tiered",
        },
      });

      expect(rate.id).toBeTruthy();
      expect(rate).toMatchObject({
        tiersMode: "graduated",
      });

      // Verify tiers
      expect(rate.tiers).toHaveLength(3);
      expect(rate.tiers![0]).toMatchObject({ upTo: 1000, unitAmount: 0 });
      expect(rate.tiers![1]).toMatchObject({ upTo: 10000, unitAmount: 5 });
      expect(rate.tiers![2]).toMatchObject({ upTo: "inf", unitAmount: 2 });

      // Verify with Stripe API
      const stripeRate = await client.rates.retrieve(rateCard.id, rate.id);
      expect(stripeRate.tiers_mode).toEqual("graduated");
      expect(stripeRate.tiers).toHaveLength(3);
    } catch (err) {
      console.log(err);
      throw err;
    } finally {
      await destroy(scope);
    }
  });

  test("rate validation - requires unitAmount or tiers", async (scope) => {
    let meter: Meter | undefined;
    let meteredItem: MeteredItem | undefined;
    let rateCard: RateCard | undefined;

    try {
      meter = await Meter(`${testMeterId}-validation`, {
        displayName: `${BRANCH_PREFIX} Validation Test Meter`,
        eventName: `${BRANCH_PREFIX}_validation_test`,
        defaultAggregation: { formula: "sum" },
        customerMapping: { eventPayloadKey: "customer_id", type: "by_id" },
        valueSettings: { eventPayloadKey: "count" },
      });

      meteredItem = await MeteredItem(`${testMeteredItemId}-validation`, {
        displayName: `${BRANCH_PREFIX} Validation Test Metered Item`,
        meter: meter,
      });

      rateCard = await RateCard(`${testRateCardId}-validation`, {
        displayName: `${BRANCH_PREFIX} Validation Test Rate Card`,
        currency: "usd",
      });

      // Should throw - neither unitAmount nor tiers
      await expect(
        Rate(`${testRateId}-invalid`, {
          rateCard: rateCard,
          meteredItem: meteredItem,
        }),
      ).rejects.toThrow("Either unitAmount or tiers is required");

      // Should throw - both unitAmount and tiers
      await expect(
        Rate(`${testRateId}-invalid2`, {
          rateCard: rateCard,
          meteredItem: meteredItem,
          unitAmount: 10,
          tiers: [{ upTo: 100, unitAmount: 5 }],
        }),
      ).rejects.toThrow(
        "Cannot specify both unitAmount and tiers",
      );
    } finally {
      await destroy(scope);
    }
  });
});
