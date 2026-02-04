import { describe, expect } from "vitest";
import { alchemy } from "../../src/alchemy.ts";
import { destroy } from "../../src/destroy.ts";
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

describe("RateCard Resource", () => {
  const testRateCardId = `${BRANCH_PREFIX}-rate-card`;

  test("create, update, and delete rate card", async (scope) => {
    let rateCard: RateCard | undefined;

    try {
      // Create a test rate card
      rateCard = await RateCard(testRateCardId, {
        displayName: `${BRANCH_PREFIX} Test Rate Card`,
        currency: "usd",
        metadata: {
          test: "initial",
        },
      });

      expect(rateCard.id).toBeTruthy();
      expect(rateCard).toMatchObject({
        displayName: `${BRANCH_PREFIX} Test Rate Card`,
        currency: "usd",
        serviceInterval: "month",
        serviceIntervalCount: 1,
        taxBehavior: "exclusive",
        metadata: { test: "initial" },
      });

      // Verify with Stripe API
      const stripeRateCard = await client.rateCards.retrieve(rateCard.id);
      expect(stripeRateCard.display_name).toEqual(
        `${BRANCH_PREFIX} Test Rate Card`,
      );
      expect(stripeRateCard.currency).toEqual("usd");

      // Update the rate card
      rateCard = await RateCard(testRateCardId, {
        displayName: `${BRANCH_PREFIX} Updated Rate Card`,
        currency: "usd",
        metadata: {
          test: "updated",
          version: "2",
        },
      });

      expect(rateCard.id).toBeTruthy();
      expect(rateCard).toMatchObject({
        displayName: `${BRANCH_PREFIX} Updated Rate Card`,
        metadata: { test: "updated", version: "2" },
      });

      // Verify update with Stripe API
      const updatedRateCard = await client.rateCards.retrieve(rateCard.id);
      expect(updatedRateCard.display_name).toEqual(
        `${BRANCH_PREFIX} Updated Rate Card`,
      );
    } catch (err) {
      console.log(err);
      throw err;
    } finally {
      await destroy(scope);
    }
  });

  test("create rate card with lookup key and custom interval", async (scope) => {
    const lookupKey = `${BRANCH_PREFIX}-rc-lookup`;
    let rateCard: RateCard | undefined;

    try {
      rateCard = await RateCard(`${testRateCardId}-lookup`, {
        displayName: `${BRANCH_PREFIX} Lookup Key Rate Card`,
        currency: "eur",
        serviceInterval: "year",
        taxBehavior: "inclusive",
        lookupKey: lookupKey,
        metadata: {
          type: "lookup-test",
        },
      });

      expect(rateCard.id).toBeTruthy();
      expect(rateCard.lookupKey).toEqual(lookupKey);
      expect(rateCard.currency).toEqual("eur");
      expect(rateCard.serviceInterval).toEqual("year");
      expect(rateCard.taxBehavior).toEqual("inclusive");

      // Verify with Stripe API
      const stripeRateCard = await client.rateCards.retrieve(rateCard.id);
      expect(stripeRateCard.lookup_key).toEqual(lookupKey);
    } catch (err) {
      console.log(err);
      throw err;
    } finally {
      await destroy(scope);
    }
  });
});
