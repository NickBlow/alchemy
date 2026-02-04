import { describe, expect } from "vitest";
import { alchemy } from "../../src/alchemy.ts";
import { destroy } from "../../src/destroy.ts";
import { LicenseFee } from "../../src/stripe/license-fee.ts";
import { LicensedItem } from "../../src/stripe/licensed-item.ts";
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

describe("LicenseFee Resource", () => {
  const testLicenseFeeId = `${BRANCH_PREFIX}-license-fee`;
  const testLicensedItemId = `${BRANCH_PREFIX}-lf-licensed-item`;

  test("create, update, and delete license fee", async (scope) => {
    let licensedItem: LicensedItem | undefined;
    let licenseFee: LicenseFee | undefined;

    try {
      // Create a licensed item first (required for license fee)
      licensedItem = await LicensedItem(testLicensedItemId, {
        displayName: `${BRANCH_PREFIX} License Fee Test Item`,
      });

      expect(licensedItem.id).toBeTruthy();

      // Create a license fee
      licenseFee = await LicenseFee(testLicenseFeeId, {
        displayName: `${BRANCH_PREFIX} Test License Fee`,
        licensedItem: licensedItem,
        currency: "usd",
        unitAmount: 9900, // $99.00
        serviceInterval: "month",
        metadata: {
          test: "initial",
        },
      });

      expect(licenseFee.id).toBeTruthy();
      expect(licenseFee).toMatchObject({
        displayName: `${BRANCH_PREFIX} Test License Fee`,
        licensedItem: licensedItem.id,
        currency: "usd",
        unitAmount: "9900",
        serviceInterval: "month",
        metadata: { test: "initial" },
      });

      // Verify with Stripe API
      const stripeLicenseFee = await client.licenseFees.retrieve(licenseFee.id);
      expect(stripeLicenseFee.display_name).toEqual(
        `${BRANCH_PREFIX} Test License Fee`,
      );
      expect(stripeLicenseFee.unit_amount).toEqual("9900");
      expect(stripeLicenseFee.service_interval).toEqual("month");

      // Update the license fee (limited fields)
      licenseFee = await LicenseFee(testLicenseFeeId, {
        displayName: `${BRANCH_PREFIX} Updated License Fee`,
        licensedItem: licensedItem,
        currency: "usd",
        unitAmount: 9900,
        serviceInterval: "month",
        metadata: {
          test: "updated",
          version: "2",
        },
      });

      expect(licenseFee.id).toBeTruthy();
      expect(licenseFee).toMatchObject({
        displayName: `${BRANCH_PREFIX} Updated License Fee`,
        metadata: { test: "updated", version: "2" },
      });
    } catch (err) {
      console.log(err);
      throw err;
    } finally {
      await destroy(scope);
    }
  });

  test("create annual license fee", async (scope) => {
    let licensedItem: LicensedItem | undefined;
    let licenseFee: LicenseFee | undefined;

    try {
      licensedItem = await LicensedItem(`${testLicensedItemId}-annual`, {
        displayName: `${BRANCH_PREFIX} Annual License Test Item`,
      });

      licenseFee = await LicenseFee(`${testLicenseFeeId}-annual`, {
        displayName: `${BRANCH_PREFIX} Annual License Fee`,
        licensedItem: licensedItem.id, // Test with string ID
        currency: "usd",
        unitAmount: 99900, // $999.00
        serviceInterval: "year",
        lookupKey: `${BRANCH_PREFIX}-annual-fee`,
        metadata: {
          tier: "enterprise",
        },
      });

      expect(licenseFee.id).toBeTruthy();
      expect(licenseFee).toMatchObject({
        serviceInterval: "year",
        unitAmount: "99900",
        lookupKey: `${BRANCH_PREFIX}-annual-fee`,
      });

      // Verify with Stripe API
      const stripeLicenseFee = await client.licenseFees.retrieve(licenseFee.id);
      expect(stripeLicenseFee.service_interval).toEqual("year");
      expect(stripeLicenseFee.lookup_key).toEqual(`${BRANCH_PREFIX}-annual-fee`);
    } catch (err) {
      console.log(err);
      throw err;
    } finally {
      await destroy(scope);
    }
  });

  test("create quarterly license fee with interval count", async (scope) => {
    let licensedItem: LicensedItem | undefined;
    let licenseFee: LicenseFee | undefined;

    try {
      licensedItem = await LicensedItem(`${testLicensedItemId}-quarterly`, {
        displayName: `${BRANCH_PREFIX} Quarterly License Test Item`,
      });

      licenseFee = await LicenseFee(`${testLicenseFeeId}-quarterly`, {
        displayName: `${BRANCH_PREFIX} Quarterly License Fee`,
        licensedItem: licensedItem,
        currency: "usd",
        unitAmount: 29900, // $299.00
        serviceInterval: "month",
        serviceIntervalCount: 3, // Every 3 months
        metadata: {
          billing: "quarterly",
        },
      });

      expect(licenseFee.id).toBeTruthy();
      expect(licenseFee).toMatchObject({
        serviceInterval: "month",
        serviceIntervalCount: 3,
        unitAmount: "29900",
      });

      // Verify with Stripe API
      const stripeLicenseFee = await client.licenseFees.retrieve(licenseFee.id);
      expect(stripeLicenseFee.service_interval_count).toEqual(3);
    } catch (err) {
      console.log(err);
      throw err;
    } finally {
      await destroy(scope);
    }
  });
});
