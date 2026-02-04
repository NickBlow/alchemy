import { describe, expect } from "vitest";
import { alchemy } from "../../src/alchemy.ts";
import { destroy } from "../../src/destroy.ts";
import { LicenseFee } from "../../src/stripe/license-fee.ts";
import { LicensedItem } from "../../src/stripe/licensed-item.ts";
import { PricingPlan } from "../../src/stripe/pricing-plan.ts";
import { PricingPlanComponent } from "../../src/stripe/pricing-plan-component.ts";
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

describe("PricingPlanComponent Resource", () => {
  const testComponentId = `${BRANCH_PREFIX}-component`;
  const testPlanId = `${BRANCH_PREFIX}-ppc-plan`;
  const testRateCardId = `${BRANCH_PREFIX}-ppc-rc`;
  const testLicensedItemId = `${BRANCH_PREFIX}-ppc-li`;
  const testLicenseFeeId = `${BRANCH_PREFIX}-ppc-lf`;

  test("attach rate card to pricing plan", async (scope) => {
    let pricingPlan: PricingPlan | undefined;
    let rateCard: RateCard | undefined;
    let component: PricingPlanComponent | undefined;

    try {
      // Create dependencies
      pricingPlan = await PricingPlan(testPlanId, {
        displayName: `${BRANCH_PREFIX} Component Test Plan`,
        currency: "usd",
      });

      rateCard = await RateCard(testRateCardId, {
        displayName: `${BRANCH_PREFIX} Component Test Rate Card`,
        currency: "usd",
      });

      // Attach rate card to pricing plan
      component = await PricingPlanComponent(`${testComponentId}-rc`, {
        pricingPlan: pricingPlan,
        type: "rate_card",
        rateCard: rateCard,
        metadata: {
          test: "rate-card",
        },
      });

      expect(component.id).toBeTruthy();
      expect(component).toMatchObject({
        pricingPlan: pricingPlan.id,
        type: "rate_card",
        rateCard: rateCard.id,
        metadata: { test: "rate-card" },
      });

      // Verify with Stripe API
      const stripeComponent = await client.pricingPlanComponents.retrieve(
        pricingPlan.id,
        component.id,
      );
      expect(stripeComponent.type).toEqual("rate_card");
      expect(stripeComponent.rate_card).toEqual(rateCard.id);
    } catch (err) {
      console.log(err);
      throw err;
    } finally {
      await destroy(scope);
    }
  });

  test("attach license fee to pricing plan", async (scope) => {
    let pricingPlan: PricingPlan | undefined;
    let licensedItem: LicensedItem | undefined;
    let licenseFee: LicenseFee | undefined;
    let component: PricingPlanComponent | undefined;

    try {
      // Create dependencies
      pricingPlan = await PricingPlan(`${testPlanId}-lf`, {
        displayName: `${BRANCH_PREFIX} License Fee Component Test Plan`,
        currency: "usd",
      });

      licensedItem = await LicensedItem(testLicensedItemId, {
        displayName: `${BRANCH_PREFIX} Component Test Licensed Item`,
      });

      licenseFee = await LicenseFee(testLicenseFeeId, {
        displayName: `${BRANCH_PREFIX} Component Test License Fee`,
        licensedItem: licensedItem,
        currency: "usd",
        amount: 4900,
        interval: "month",
      });

      // Attach license fee to pricing plan
      component = await PricingPlanComponent(`${testComponentId}-lf`, {
        pricingPlan: pricingPlan.id, // Test with string ID
        type: "license_fee",
        licenseFee: licenseFee.id, // Test with string ID
        metadata: {
          test: "license-fee",
        },
      });

      expect(component.id).toBeTruthy();
      expect(component).toMatchObject({
        pricingPlan: pricingPlan.id,
        type: "license_fee",
        licenseFee: licenseFee.id,
        metadata: { test: "license-fee" },
      });

      // Verify with Stripe API
      const stripeComponent = await client.pricingPlanComponents.retrieve(
        pricingPlan.id,
        component.id,
      );
      expect(stripeComponent.type).toEqual("license_fee");
      expect(stripeComponent.license_fee).toEqual(licenseFee.id);
    } catch (err) {
      console.log(err);
      throw err;
    } finally {
      await destroy(scope);
    }
  });

  test("compose plan with multiple components", async (scope) => {
    let pricingPlan: PricingPlan | undefined;
    let rateCard: RateCard | undefined;
    let licensedItem: LicensedItem | undefined;
    let licenseFee: LicenseFee | undefined;
    let rateCardComponent: PricingPlanComponent | undefined;
    let licenseFeeComponent: PricingPlanComponent | undefined;

    try {
      // Create pricing plan
      pricingPlan = await PricingPlan(`${testPlanId}-multi`, {
        displayName: `${BRANCH_PREFIX} Multi-Component Plan`,
        currency: "usd",
      });

      // Create rate card and attach
      rateCard = await RateCard(`${testRateCardId}-multi`, {
        displayName: `${BRANCH_PREFIX} Multi-Component Rate Card`,
        currency: "usd",
      });

      rateCardComponent = await PricingPlanComponent(
        `${testComponentId}-multi-rc`,
        {
          pricingPlan: pricingPlan,
          type: "rate_card",
          rateCard: rateCard,
        },
      );

      // Create license fee and attach
      licensedItem = await LicensedItem(`${testLicensedItemId}-multi`, {
        displayName: `${BRANCH_PREFIX} Multi-Component Licensed Item`,
      });

      licenseFee = await LicenseFee(`${testLicenseFeeId}-multi`, {
        displayName: `${BRANCH_PREFIX} Multi-Component License Fee`,
        licensedItem: licensedItem,
        currency: "usd",
        amount: 2900,
        interval: "month",
      });

      licenseFeeComponent = await PricingPlanComponent(
        `${testComponentId}-multi-lf`,
        {
          pricingPlan: pricingPlan,
          type: "license_fee",
          licenseFee: licenseFee,
        },
      );

      // Verify both components exist
      expect(rateCardComponent.id).toBeTruthy();
      expect(licenseFeeComponent.id).toBeTruthy();
      expect(rateCardComponent.type).toEqual("rate_card");
      expect(licenseFeeComponent.type).toEqual("license_fee");

      // List all components on the plan
      const components = await client.pricingPlanComponents.list(
        pricingPlan.id,
      );
      expect(components.data.length).toBeGreaterThanOrEqual(2);
    } catch (err) {
      console.log(err);
      throw err;
    } finally {
      await destroy(scope);
    }
  });

  test("component validation - rate_card requires rateCard", async (scope) => {
    let pricingPlan: PricingPlan | undefined;

    try {
      pricingPlan = await PricingPlan(`${testPlanId}-validation`, {
        displayName: `${BRANCH_PREFIX} Validation Test Plan`,
        currency: "usd",
      });

      await expect(
        PricingPlanComponent(`${testComponentId}-invalid`, {
          pricingPlan: pricingPlan,
          type: "rate_card",
          // Missing rateCard
        }),
      ).rejects.toThrow("rateCard is required when type is 'rate_card'");
    } finally {
      await destroy(scope);
    }
  });

  test("component validation - license_fee requires licenseFee", async (scope) => {
    let pricingPlan: PricingPlan | undefined;

    try {
      pricingPlan = await PricingPlan(`${testPlanId}-validation2`, {
        displayName: `${BRANCH_PREFIX} Validation Test Plan 2`,
        currency: "usd",
      });

      await expect(
        PricingPlanComponent(`${testComponentId}-invalid2`, {
          pricingPlan: pricingPlan,
          type: "license_fee",
          // Missing licenseFee
        }),
      ).rejects.toThrow("licenseFee is required when type is 'license_fee'");
    } finally {
      await destroy(scope);
    }
  });
});
