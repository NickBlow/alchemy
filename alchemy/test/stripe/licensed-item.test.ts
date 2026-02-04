import { describe, expect } from "vitest";
import { alchemy } from "../../src/alchemy.ts";
import { destroy } from "../../src/destroy.ts";
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

describe("LicensedItem Resource", () => {
  const testLicensedItemId = `${BRANCH_PREFIX}-licensed-item`;

  test("create, update, and delete licensed item", async (scope) => {
    let licensedItem: LicensedItem | undefined;

    try {
      // Create a test licensed item
      licensedItem = await LicensedItem(testLicensedItemId, {
        displayName: `${BRANCH_PREFIX} Test Licensed Item`,
        metadata: {
          test: "initial",
        },
      });

      expect(licensedItem.id).toBeTruthy();
      expect(licensedItem).toMatchObject({
        displayName: `${BRANCH_PREFIX} Test Licensed Item`,
        metadata: { test: "initial" },
      });

      // Verify with Stripe API
      const stripeLicensedItem = await client.licensedItems.retrieve(
        licensedItem.id,
      );
      expect(stripeLicensedItem.display_name).toEqual(
        `${BRANCH_PREFIX} Test Licensed Item`,
      );

      // Update the licensed item
      licensedItem = await LicensedItem(testLicensedItemId, {
        displayName: `${BRANCH_PREFIX} Updated Licensed Item`,
        metadata: {
          test: "updated",
          version: "2",
        },
      });

      expect(licensedItem.id).toBeTruthy();
      expect(licensedItem).toMatchObject({
        displayName: `${BRANCH_PREFIX} Updated Licensed Item`,
        metadata: { test: "updated", version: "2" },
      });

      // Verify update with Stripe API
      const updatedItem = await client.licensedItems.retrieve(licensedItem.id);
      expect(updatedItem.display_name).toEqual(
        `${BRANCH_PREFIX} Updated Licensed Item`,
      );
    } catch (err) {
      console.log(err);
      throw err;
    } finally {
      await destroy(scope);
    }
  });

  test("create licensed item with lookup key", async (scope) => {
    const lookupKey = `${BRANCH_PREFIX}-li-lookup`;
    let licensedItem: LicensedItem | undefined;

    try {
      licensedItem = await LicensedItem(`${testLicensedItemId}-lookup`, {
        displayName: `${BRANCH_PREFIX} Lookup Key Licensed Item`,
        lookupKey: lookupKey,
        metadata: {
          type: "lookup-test",
        },
      });

      expect(licensedItem.id).toBeTruthy();
      expect(licensedItem.lookupKey).toEqual(lookupKey);

      // Verify with Stripe API
      const stripeLicensedItem = await client.licensedItems.retrieve(
        licensedItem.id,
      );
      expect(stripeLicensedItem.lookup_key).toEqual(lookupKey);
    } catch (err) {
      console.log(err);
      throw err;
    } finally {
      await destroy(scope);
    }
  });
});
