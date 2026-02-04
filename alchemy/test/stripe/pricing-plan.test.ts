import { describe, expect } from "vitest";
import { alchemy } from "../../src/alchemy.ts";
import { destroy } from "../../src/destroy.ts";
import { PricingPlan } from "../../src/stripe/pricing-plan.ts";
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

describe("PricingPlan Resource", () => {
  const testPlanId = `${BRANCH_PREFIX}-pricing-plan`;

  test("create, update, and delete pricing plan", async (scope) => {
    let plan: PricingPlan | undefined;

    try {
      // Create a test pricing plan
      plan = await PricingPlan(testPlanId, {
        displayName: `${BRANCH_PREFIX} Test Pricing Plan`,
        currency: "usd",
        metadata: {
          test: "initial",
        },
      });

      expect(plan.id).toBeTruthy();
      expect(plan).toMatchObject({
        displayName: `${BRANCH_PREFIX} Test Pricing Plan`,
        currency: "usd",
        taxBehavior: "exclusive",
        metadata: { test: "initial" },
      });

      // Verify with Stripe API
      const stripePlan = await client.pricingPlans.retrieve(plan.id);
      expect(stripePlan.display_name).toEqual(
        `${BRANCH_PREFIX} Test Pricing Plan`,
      );

      // Update the pricing plan
      plan = await PricingPlan(testPlanId, {
        displayName: `${BRANCH_PREFIX} Updated Pricing Plan`,
        currency: "usd",
        metadata: {
          test: "updated",
          version: "2",
        },
      });

      expect(plan.id).toBeTruthy();
      expect(plan).toMatchObject({
        displayName: `${BRANCH_PREFIX} Updated Pricing Plan`,
        metadata: { test: "updated", version: "2" },
      });

      // Verify update with Stripe API
      const updatedPlan = await client.pricingPlans.retrieve(plan.id);
      expect(updatedPlan.display_name).toEqual(
        `${BRANCH_PREFIX} Updated Pricing Plan`,
      );
    } catch (err) {
      console.log(err);
      throw err;
    } finally {
      await destroy(scope);

      // Note: v2 billing resources may not support deletion
      // They may need to be archived instead
    }
  });

  test("create pricing plan with lookup key", async (scope) => {
    const lookupKey = `${BRANCH_PREFIX}-lookup-key`;
    let plan: PricingPlan | undefined;

    try {
      plan = await PricingPlan(`${testPlanId}-lookup`, {
        displayName: `${BRANCH_PREFIX} Lookup Key Plan`,
        currency: "usd",
        lookupKey: lookupKey,
        metadata: {
          type: "lookup-test",
        },
      });

      expect(plan.id).toBeTruthy();
      expect(plan.lookupKey).toEqual(lookupKey);

      // Verify with Stripe API
      const stripePlan = await client.pricingPlans.retrieve(plan.id);
      expect(stripePlan.lookup_key).toEqual(lookupKey);
    } catch (err) {
      console.log(err);
      throw err;
    } finally {
      await destroy(scope);
    }
  });
});
