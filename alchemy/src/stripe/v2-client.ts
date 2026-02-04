import type Stripe from "stripe";
import type { Secret } from "../secret.ts";
import { logger } from "../util/logger.ts";
import { importPeer } from "../util/peer.ts";
import { withExponentialBackoff } from "../util/retry.ts";

/**
 * Stripe v2 API version for billing features
 */
export const STRIPE_V2_API_VERSION = "2026-01-28.preview";

/**
 * Options for Stripe v2 client
 */
export interface StripeV2ClientOptions {
  apiKey?: Secret | string;
}

/**
 * Stripe v2 API response wrapper
 */
export interface StripeV2Response<T> {
  data: T;
}

/**
 * Stripe v2 list response wrapper
 */
export interface StripeV2ListResponse<T> {
  data: T[];
  has_more?: boolean;
  next_page_url?: string;
}

// ============================================================================
// V2 Billing Type Definitions
// ============================================================================

/**
 * Pricing Plan - Container for billing components
 */
export interface V2PricingPlan {
  id: string;
  object: "billing.pricing_plan";
  display_name: string;
  currency: string;
  tax_behavior: "exclusive" | "inclusive";
  lookup_key?: string;
  live_version?: string;
  latest_version?: string;
  metadata?: Record<string, string>;
  created: number;
  updated: number;
  livemode: boolean;
}

export interface V2PricingPlanCreateParams {
  display_name: string;
  currency: string;
  tax_behavior: "exclusive" | "inclusive";
  lookup_key?: string;
  metadata?: Record<string, string>;
}

export interface V2PricingPlanUpdateParams {
  display_name?: string;
  lookup_key?: string;
  live_version?: "latest" | string;
  metadata?: Record<string, string>;
}

/**
 * Rate Card - Usage-based pricing container
 */
export interface V2RateCard {
  id: string;
  object: "billing.rate_card";
  display_name: string;
  currency: string;
  service_interval: "day" | "week" | "month" | "year";
  service_interval_count: number;
  tax_behavior: "exclusive" | "inclusive";
  lookup_key?: string;
  metadata?: Record<string, string>;
  created: number;
  updated: number;
  livemode: boolean;
}

export interface V2RateCardCreateParams {
  display_name: string;
  currency: string;
  service_interval: "day" | "week" | "month" | "year";
  service_interval_count?: number;
  tax_behavior: "exclusive" | "inclusive";
  lookup_key?: string;
  metadata?: Record<string, string>;
}

export interface V2RateCardUpdateParams {
  display_name?: string;
  lookup_key?: string;
  metadata?: Record<string, string>;
}

/**
 * Metered Item - Links a meter to a billable item
 */
export interface V2MeteredItem {
  id: string;
  object: "billing.metered_item";
  display_name: string;
  lookup_key?: string;
  meter: string;
  metadata?: Record<string, string>;
  created: number;
  updated: number;
  livemode: boolean;
}

export interface V2MeteredItemCreateParams {
  display_name: string;
  meter: string;
  lookup_key?: string;
  metadata?: Record<string, string>;
}

export interface V2MeteredItemUpdateParams {
  display_name?: string;
  lookup_key?: string;
  metadata?: Record<string, string>;
}

/**
 * Rate tier for tiered pricing
 */
export interface V2RateTier {
  up_to: number | null;
  unit_amount?: string;
  flat_amount?: string;
}

/**
 * Rate - Unit pricing/tiering for metered items on a rate card
 */
export interface V2Rate {
  id: string;
  object: "billing.rate";
  rate_card: string;
  metered_item: string;
  unit_amount?: string;
  tiers?: V2RateTier[];
  tiers_mode?: "graduated" | "volume";
  metadata?: Record<string, string>;
  created: number;
  updated: number;
  livemode: boolean;
}

export interface V2RateCreateParams {
  metered_item: string;
  unit_amount?: string;
  tiers?: Array<{
    up_to: number | "inf";
    unit_amount?: string;
    flat_amount?: string;
  }>;
  tiers_mode?: "graduated" | "volume";
  metadata?: Record<string, string>;
}

export interface V2RateUpdateParams {
  unit_amount?: string;
  tiers?: Array<{
    up_to: number | "inf";
    unit_amount?: string;
    flat_amount?: string;
  }>;
  tiers_mode?: "graduated" | "volume";
  metadata?: Record<string, string>;
}

/**
 * Licensed Item - Flat-fee billable item
 */
export interface V2LicensedItem {
  id: string;
  object: "billing.licensed_item";
  display_name: string;
  lookup_key?: string;
  metadata?: Record<string, string>;
  created: number;
  updated: number;
  livemode: boolean;
}

export interface V2LicensedItemCreateParams {
  display_name: string;
  lookup_key?: string;
  metadata?: Record<string, string>;
}

export interface V2LicensedItemUpdateParams {
  display_name?: string;
  lookup_key?: string;
  metadata?: Record<string, string>;
}

/**
 * License Fee - Recurring flat fee
 */
export interface V2LicenseFee {
  id: string;
  object: "billing.license_fee";
  display_name: string;
  lookup_key?: string;
  licensed_item: string;
  currency: string;
  unit_amount: string;
  service_interval: "day" | "week" | "month" | "year";
  service_interval_count: number;
  tax_behavior: "exclusive" | "inclusive";
  metadata?: Record<string, string>;
  created: number;
  updated: number;
  livemode: boolean;
}

export interface V2LicenseFeeCreateParams {
  display_name: string;
  licensed_item: string;
  currency: string;
  unit_amount: string;
  service_interval: "day" | "week" | "month" | "year";
  service_interval_count?: number;
  tax_behavior: "exclusive" | "inclusive";
  lookup_key?: string;
  metadata?: Record<string, string>;
}

export interface V2LicenseFeeUpdateParams {
  display_name?: string;
  lookup_key?: string;
  metadata?: Record<string, string>;
}

/**
 * Pricing Plan Component - Attaches rate cards or license fees to pricing plans
 */
export interface V2PricingPlanComponent {
  id: string;
  object: "billing.pricing_plan_component";
  pricing_plan: string;
  type: "rate_card" | "license_fee";
  rate_card?: string;
  license_fee?: string;
  metadata?: Record<string, string>;
  created: number;
  updated: number;
  livemode: boolean;
}

export interface V2PricingPlanComponentCreateParams {
  type: "rate_card" | "license_fee";
  rate_card?: { id: string };
  license_fee?: { id: string };
  metadata?: Record<string, string>;
}

export interface V2PricingPlanComponentUpdateParams {
  metadata?: Record<string, string>;
}

// ============================================================================
// V2 Client Implementation
// ============================================================================

/**
 * Stripe V2 Client for billing APIs
 */
export interface StripeV2Client {
  stripe: Stripe;
  apiKey: string;

  // Raw request helper
  request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T>;

  // Pricing Plans
  pricingPlans: {
    create(params: V2PricingPlanCreateParams): Promise<V2PricingPlan>;
    retrieve(id: string): Promise<V2PricingPlan>;
    update(id: string, params: V2PricingPlanUpdateParams): Promise<V2PricingPlan>;
    del(id: string): Promise<{ id: string; deleted: boolean }>;
    list(): Promise<V2ListResponse<V2PricingPlan>>;
  };

  // Rate Cards
  rateCards: {
    create(params: V2RateCardCreateParams): Promise<V2RateCard>;
    retrieve(id: string): Promise<V2RateCard>;
    update(id: string, params: V2RateCardUpdateParams): Promise<V2RateCard>;
    del(id: string): Promise<{ id: string; deleted: boolean }>;
    list(): Promise<V2ListResponse<V2RateCard>>;
  };

  // Metered Items
  meteredItems: {
    create(params: V2MeteredItemCreateParams): Promise<V2MeteredItem>;
    retrieve(id: string): Promise<V2MeteredItem>;
    update(id: string, params: V2MeteredItemUpdateParams): Promise<V2MeteredItem>;
    del(id: string): Promise<{ id: string; deleted: boolean }>;
    list(): Promise<V2ListResponse<V2MeteredItem>>;
  };

  // Rates (on rate cards)
  rates: {
    create(rateCardId: string, params: V2RateCreateParams): Promise<V2Rate>;
    retrieve(rateCardId: string, rateId: string): Promise<V2Rate>;
    update(
      rateCardId: string,
      rateId: string,
      params: V2RateUpdateParams,
    ): Promise<V2Rate>;
    del(
      rateCardId: string,
      rateId: string,
    ): Promise<{ id: string; deleted: boolean }>;
    list(rateCardId: string): Promise<V2ListResponse<V2Rate>>;
  };

  // Licensed Items
  licensedItems: {
    create(params: V2LicensedItemCreateParams): Promise<V2LicensedItem>;
    retrieve(id: string): Promise<V2LicensedItem>;
    update(
      id: string,
      params: V2LicensedItemUpdateParams,
    ): Promise<V2LicensedItem>;
    del(id: string): Promise<{ id: string; deleted: boolean }>;
    list(): Promise<V2ListResponse<V2LicensedItem>>;
  };

  // License Fees
  licenseFees: {
    create(params: V2LicenseFeeCreateParams): Promise<V2LicenseFee>;
    retrieve(id: string): Promise<V2LicenseFee>;
    update(id: string, params: V2LicenseFeeUpdateParams): Promise<V2LicenseFee>;
    del(id: string): Promise<{ id: string; deleted: boolean }>;
    list(): Promise<V2ListResponse<V2LicenseFee>>;
  };

  // Pricing Plan Components
  pricingPlanComponents: {
    create(
      pricingPlanId: string,
      params: V2PricingPlanComponentCreateParams,
    ): Promise<V2PricingPlanComponent>;
    retrieve(
      pricingPlanId: string,
      componentId: string,
    ): Promise<V2PricingPlanComponent>;
    update(
      pricingPlanId: string,
      componentId: string,
      params: V2PricingPlanComponentUpdateParams,
    ): Promise<V2PricingPlanComponent>;
    del(
      pricingPlanId: string,
      componentId: string,
    ): Promise<{ id: string; deleted: boolean }>;
    list(pricingPlanId: string): Promise<V2ListResponse<V2PricingPlanComponent>>;
  };
}

/**
 * V2 List response type
 */
export interface V2ListResponse<T> {
  data: T[];
  has_more?: boolean;
  next_page_url?: string;
}

/**
 * Creates a Stripe v2 client for billing APIs
 */
export async function createStripeV2Client(
  options: StripeV2ClientOptions = {},
): Promise<StripeV2Client> {
  const { default: Stripe } = await importPeer(
    import("stripe"),
    "Stripe resources",
  );

  let apiKey: string;
  if (options.apiKey) {
    apiKey =
      typeof options.apiKey === "string"
        ? options.apiKey
        : options.apiKey.unencrypted;
  } else {
    const envApiKey = process.env.STRIPE_API_KEY;
    if (!envApiKey) {
      throw new Error(
        "Stripe API key is required. Provide it via the apiKey parameter or set the STRIPE_API_KEY environment variable.",
      );
    }
    apiKey = envApiKey;
  }

  const stripe = new Stripe(apiKey);

  // Helper to make v2 API requests with retry logic
  async function request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    return withExponentialBackoff(
      async () => {
        const response = await stripe.rawRequest(method, path, {
          ...(body ? { body: JSON.stringify(body) } : {}),
          headers: {
            "Stripe-Version": STRIPE_V2_API_VERSION,
            "Content-Type": "application/json",
          },
        });

        // Parse response based on content type
        const contentType = response.headers.get("content-type");
        if (contentType?.includes("application/json")) {
          return JSON.parse(await response.text()) as T;
        }
        return {} as T;
      },
      isStripeV2RetryableError,
      5,
      1000,
    );
  }

  return {
    stripe,
    apiKey,
    request,

    pricingPlans: {
      create: (params) => request("POST", "/v2/billing/pricing_plans", params),
      retrieve: (id) => request("GET", `/v2/billing/pricing_plans/${id}`),
      update: (id, params) =>
        request("POST", `/v2/billing/pricing_plans/${id}`, params),
      del: (id) => request("DELETE", `/v2/billing/pricing_plans/${id}`),
      list: () => request("GET", "/v2/billing/pricing_plans"),
    },

    rateCards: {
      create: (params) => request("POST", "/v2/billing/rate_cards", params),
      retrieve: (id) => request("GET", `/v2/billing/rate_cards/${id}`),
      update: (id, params) =>
        request("POST", `/v2/billing/rate_cards/${id}`, params),
      del: (id) => request("DELETE", `/v2/billing/rate_cards/${id}`),
      list: () => request("GET", "/v2/billing/rate_cards"),
    },

    meteredItems: {
      create: (params) => request("POST", "/v2/billing/metered_items", params),
      retrieve: (id) => request("GET", `/v2/billing/metered_items/${id}`),
      update: (id, params) =>
        request("POST", `/v2/billing/metered_items/${id}`, params),
      del: (id) => request("DELETE", `/v2/billing/metered_items/${id}`),
      list: () => request("GET", "/v2/billing/metered_items"),
    },

    rates: {
      create: (rateCardId, params) =>
        request("POST", `/v2/billing/rate_cards/${rateCardId}/rates`, params),
      retrieve: (rateCardId, rateId) =>
        request("GET", `/v2/billing/rate_cards/${rateCardId}/rates/${rateId}`),
      update: (rateCardId, rateId, params) =>
        request(
          "POST",
          `/v2/billing/rate_cards/${rateCardId}/rates/${rateId}`,
          params,
        ),
      del: (rateCardId, rateId) =>
        request(
          "DELETE",
          `/v2/billing/rate_cards/${rateCardId}/rates/${rateId}`,
        ),
      list: (rateCardId) =>
        request("GET", `/v2/billing/rate_cards/${rateCardId}/rates`),
    },

    licensedItems: {
      create: (params) => request("POST", "/v2/billing/licensed_items", params),
      retrieve: (id) => request("GET", `/v2/billing/licensed_items/${id}`),
      update: (id, params) =>
        request("POST", `/v2/billing/licensed_items/${id}`, params),
      del: (id) => request("DELETE", `/v2/billing/licensed_items/${id}`),
      list: () => request("GET", "/v2/billing/licensed_items"),
    },

    licenseFees: {
      create: (params) => request("POST", "/v2/billing/license_fees", params),
      retrieve: (id) => request("GET", `/v2/billing/license_fees/${id}`),
      update: (id, params) =>
        request("POST", `/v2/billing/license_fees/${id}`, params),
      del: (id) => request("DELETE", `/v2/billing/license_fees/${id}`),
      list: () => request("GET", "/v2/billing/license_fees"),
    },

    pricingPlanComponents: {
      create: (pricingPlanId, params) =>
        request(
          "POST",
          `/v2/billing/pricing_plans/${pricingPlanId}/components`,
          params,
        ),
      retrieve: (pricingPlanId, componentId) =>
        request(
          "GET",
          `/v2/billing/pricing_plans/${pricingPlanId}/components/${componentId}`,
        ),
      update: (pricingPlanId, componentId, params) =>
        request(
          "POST",
          `/v2/billing/pricing_plans/${pricingPlanId}/components/${componentId}`,
          params,
        ),
      del: (pricingPlanId, componentId) =>
        request(
          "DELETE",
          `/v2/billing/pricing_plans/${pricingPlanId}/components/${componentId}`,
        ),
      list: (pricingPlanId) =>
        request(
          "GET",
          `/v2/billing/pricing_plans/${pricingPlanId}/components`,
        ),
    },
  };
}

/**
 * Determines if a Stripe v2 error should trigger a retry
 */
function isStripeV2RetryableError(error: any): boolean {
  return (
    error?.status === 429 ||
    error?.statusCode === 429 ||
    error?.code === "rate_limit" ||
    error?.type === "rate_limit_error"
  );
}

/**
 * Handle v2 delete errors gracefully
 */
export function handleStripeV2DeleteError(
  error: any,
  resourceType: string,
  resourceId?: string,
): void {
  if (
    error?.code === "resource_missing" ||
    error?.status === 404 ||
    error?.statusCode === 404
  ) {
    logger.log(
      `${resourceType} ${resourceId || "unknown"} not found during deletion (already deleted)`,
    );
    return;
  }

  logger.error(
    `Error deleting ${resourceType} ${resourceId || "unknown"}:`,
    error,
  );
  throw error;
}

/**
 * Check if error is a conflict error (resource already exists)
 */
export function isStripeV2ConflictError(error: any): boolean {
  return error?.status === 409 || error?.statusCode === 409;
}
