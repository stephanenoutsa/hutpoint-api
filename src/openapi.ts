/**
 * OpenAPI 3.0 specification for the Hutpoint API.
 * Served as JSON at GET /docs/spec and rendered by Swagger UI at GET /docs.
 */
export const spec = {
  openapi: "3.0.3",
  info: {
    title: "Hutpoint API",
    version: "0.1.0",
    description:
      "REST API for the Hutpoint loyalty platform. Handles businesses, customers, transactions, agreements, redemptions, coalitions, raffle draws, and platform administration.",
  },
  servers: [{ url: "/" }],

  // ─── Security ───────────────────────────────────────────────────────────────
  components: {
    securitySchemes: {
      AdminKey: {
        type: "apiKey",
        in: "header",
        name: "x-admin-key",
        description: "Required for all `/admin` endpoints and `POST /raffle/draw`.",
      },
    },
    schemas: {
      Ok: {
        type: "object",
        properties: { ok: { type: "boolean", example: true } },
        required: ["ok"],
      },
      Error: {
        type: "object",
        properties: {
          ok:    { type: "boolean", example: false },
          error: { type: "string", example: "Not found" },
        },
        required: ["ok", "error"],
      },
      Business: {
        type: "object",
        properties: {
          id:             { type: "string" },
          businessName:   { type: "string" },
          industry:       { type: "string" },
          currency:       { type: "string", example: "FCFA" },
          currencySymbol: { type: "string", example: "FCFA" },
          merchantTierKey: { type: "string", example: "micro" },
          type:           { type: "string", enum: ["standalone", "coalition"] },
          coalitionId:    { type: "string", nullable: true },
          suspended:      { type: "boolean" },
          createdAt:      { type: "string", format: "date-time" },
        },
      },
      BizWallet: {
        type: "object",
        properties: {
          id:             { type: "string" },
          businessId:     { type: "string" },
          points:         { type: "number" },
          totalPurchased: { type: "number" },
          totalSpent:     { type: "number" },
        },
      },
      Customer: {
        type: "object",
        properties: {
          id:           { type: "string" },
          name:         { type: "string" },
          phone:        { type: "string" },
          email:        { type: "string", nullable: true },
          accountType:  { type: "string", enum: ["personal", "business"] },
          referralCode: { type: "string" },
          createdAt:    { type: "string", format: "date-time" },
        },
      },
      Membership: {
        type: "object",
        properties: {
          id:          { type: "string" },
          customerId:  { type: "string" },
          businessId:  { type: "string" },
          points:      { type: "number" },
          lifetimePts: { type: "number" },
          joinedAt:    { type: "string", format: "date-time" },
        },
      },
      Transaction: {
        type: "object",
        properties: {
          id:            { type: "string" },
          businessId:    { type: "string" },
          customerId:    { type: "string" },
          amount:        { type: "number" },
          description:   { type: "string", nullable: true },
          type:          { type: "string", example: "sale" },
          pointsEarned:  { type: "number" },
          pointsOwed:    { type: "number" },
          bonusApplied:  { type: "boolean" },
          createdAt:     { type: "string", format: "date-time" },
        },
      },
      Receipt: {
        type: "object",
        properties: {
          id:            { type: "string" },
          transactionId: { type: "string" },
          customerId:    { type: "string" },
          businessId:    { type: "string" },
          amount:        { type: "number" },
          status:        { type: "string", enum: ["pending", "acknowledged"] },
          createdAt:     { type: "string", format: "date-time" },
        },
      },
      Agreement: {
        type: "object",
        properties: {
          id:           { type: "string" },
          businessId:   { type: "string" },
          customerId:   { type: "string" },
          description:  { type: "string" },
          amount:       { type: "number" },
          status:       { type: "string", enum: ["pending_validation", "validated", "rejected", "void"] },
          amendments:   { type: "array", items: { type: "object" } },
          createdAt:    { type: "string", format: "date-time" },
        },
      },
      PendingRedemption: {
        type: "object",
        properties: {
          id:          { type: "string" },
          customerId:  { type: "string" },
          businessId:  { type: "string" },
          ptsToRedeem: { type: "number" },
          discount:    { type: "number" },
          code:        { type: "string" },
          status:      { type: "string", enum: ["pending", "confirmed", "cancelled"] },
          createdAt:   { type: "string", format: "date-time" },
        },
      },
      Coalition: {
        type: "object",
        properties: {
          id:         { type: "string" },
          name:       { type: "string" },
          businesses: { type: "array", items: { type: "string" } },
          spinPool:   { type: "number" },
          createdAt:  { type: "string", format: "date-time" },
        },
      },
      SpinToken: {
        type: "object",
        properties: {
          id:          { type: "string" },
          customerId:  { type: "string" },
          businessId:  { type: "string", nullable: true },
          coalitionId: { type: "string", nullable: true },
          isCoal:      { type: "boolean" },
          used:        { type: "boolean" },
          createdAt:   { type: "string", format: "date-time" },
        },
      },
    },
    responses: {
      NotFound: {
        description: "Resource not found",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      BadRequest: {
        description: "Invalid request body or parameters",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      Unauthorized: {
        description: "Missing or invalid admin key",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
    },
  },

  // ─── Tags ────────────────────────────────────────────────────────────────────
  tags: [
    { name: "Bootstrap",     description: "Full state snapshot — used by frontend to hydrate on mount" },
    { name: "Businesses",    description: "Register and manage merchant businesses" },
    { name: "Customers",     description: "Register and manage loyalty programme members" },
    { name: "Transactions",  description: "Log sales, receipts, feedback, reminders, and reorders" },
    { name: "Agreements",    description: "Credit agreements and personal ledger records" },
    { name: "Redemptions",   description: "Point redemptions — voucher flow and direct redemption" },
    { name: "Coalitions",    description: "Multi-business loyalty coalitions" },
    { name: "Raffle",        description: "Monthly raffle draws and stats" },
    { name: "Admin",         description: "Platform administration — requires x-admin-key header" },
  ],

  // ─── Paths ───────────────────────────────────────────────────────────────────
  paths: {

    // ── Bootstrap ──────────────────────────────────────────────────────────────
    "/bootstrap": {
      get: {
        tags: ["Bootstrap"],
        summary: "Full platform state snapshot",
        description:
          "Returns every collection in a single response. The frontend calls this on mount to hydrate React state and again after every mutation to re-sync with the server.",
        responses: {
          200: {
            description: "Full state snapshot",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok:                 { type: "boolean" },
                    businesses:         { type: "array", items: { $ref: "#/components/schemas/Business" } },
                    customers:          { type: "array", items: { $ref: "#/components/schemas/Customer" } },
                    memberships:        { type: "array", items: { $ref: "#/components/schemas/Membership" } },
                    bizWallets:         { type: "array", items: { $ref: "#/components/schemas/BizWallet" } },
                    transactions:       { type: "array", items: { $ref: "#/components/schemas/Transaction" } },
                    agreements:         { type: "array", items: { $ref: "#/components/schemas/Agreement" } },
                    receipts:           { type: "array", items: { $ref: "#/components/schemas/Receipt" } },
                    redemptions:        { type: "array", items: { type: "object" } },
                    pendingRedemptions: { type: "array", items: { $ref: "#/components/schemas/PendingRedemption" } },
                    coalitions:         { type: "array", items: { $ref: "#/components/schemas/Coalition" } },
                    coalWallets:        { type: "array", items: { type: "object" } },
                    spinTokens:         { type: "array", items: { $ref: "#/components/schemas/SpinToken" } },
                    feedback:           { type: "array", items: { type: "object" } },
                    feedbackRequests:   { type: "array", items: { type: "object" } },
                    ledgerEntries:      { type: "array", items: { type: "object" } },
                    reminders:          { type: "array", items: { type: "object" } },
                    bonuses:            { type: "array", items: { type: "object" } },
                    reorderRequests:    { type: "array", items: { type: "object" } },
                    raffleTickets:      { type: "array", items: { type: "object" } },
                    raffleDraws:        { type: "array", items: { type: "object" } },
                    activityLog:        { type: "array", items: { type: "object" } },
                    personalLedger:     { type: "array", items: { type: "object" } },
                    scannedReceipts:    { type: "array", items: { type: "object" } },
                    platformConfig:     { type: "object" },
                  },
                },
              },
            },
          },
        },
      },
    },

    // ── Businesses ─────────────────────────────────────────────────────────────
    "/businesses": {
      post: {
        tags: ["Businesses"],
        summary: "Register a new business",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["businessName", "industry"],
                properties: {
                  businessName:    { type: "string", example: "Café Lumière" },
                  industry:        { type: "string", example: "food_beverage" },
                  currency:        { type: "string", default: "FCFA" },
                  currencySymbol:  { type: "string", default: "FCFA" },
                  merchantTierKey: { type: "string", example: "micro", default: "micro" },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: "Business created",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Ok" },
                    { type: "object", properties: { business: { $ref: "#/components/schemas/Business" } } },
                  ],
                },
              },
            },
          },
          400: { $ref: "#/components/responses/BadRequest" },
        },
      },
      get: {
        tags: ["Businesses"],
        summary: "List all businesses",
        responses: {
          200: {
            description: "List of businesses with wallets",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok:         { type: "boolean" },
                    businesses: { type: "array", items: { $ref: "#/components/schemas/Business" } },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/businesses/{id}": {
      get: {
        tags: ["Businesses"],
        summary: "Get a single business",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: { description: "Business record", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/Ok" }, { type: "object", properties: { business: { $ref: "#/components/schemas/Business" } } }] } } } },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/businesses/{id}/settings": {
      patch: {
        tags: ["Businesses"],
        summary: "Update engagement settings",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  bizReturnRate:      { type: "number", description: "Points earned per unit spent" },
                  redemptionRate:     { type: "number", description: "Currency value per point redeemed" },
                  spendThreshold:     { type: "number", description: "Amount that triggers a 2× bonus" },
                  comebackWindowDays: { type: "number", description: "Days of inactivity that triggers comeback bonus" },
                  visitFrequency:     { type: "string", enum: ["daily", "weekly", "monthly", "rarely"] },
                  surpriseMode:       { type: "boolean" },
                  creditFromBronze:   { type: "boolean" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Updated business", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/Ok" }, { type: "object", properties: { business: { $ref: "#/components/schemas/Business" } } }] } } } },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/businesses/{id}/wallet/topup": {
      post: {
        tags: ["Businesses"],
        summary: "Purchase points (top-up wallet)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["pts"], properties: { pts: { type: "number", example: 1000 } } } } },
        },
        responses: {
          200: { description: "Wallet after top-up", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/Ok" }, { type: "object", properties: { wallet: { $ref: "#/components/schemas/BizWallet" } } }] } } } },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/businesses/{id}/customers": {
      get: {
        tags: ["Businesses"],
        summary: "List members with their point balances",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Members list", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, customers: { type: "array", items: { type: "object" } } } } } } } },
      },
    },
    "/businesses/{id}/transactions": {
      get: {
        tags: ["Businesses"],
        summary: "List recent transactions for a business",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Transactions list", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, transactions: { type: "array", items: { $ref: "#/components/schemas/Transaction" } } } } } } } },
      },
    },
    "/businesses/{id}/tiers": {
      get: {
        tags: ["Businesses"],
        summary: "Get loyalty tier thresholds for a business",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Tier definitions", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, tiers: { type: "array", items: { type: "object" } } } } } } } },
      },
    },
    "/businesses/{id}/tier": {
      post: {
        tags: ["Businesses"],
        summary: "Switch merchant tier",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["tierKey"], properties: { tierKey: { type: "string", example: "small" } } } } } },
        responses: {
          200: { description: "Updated business", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/businesses/{id}/churn": {
      get: {
        tags: ["Businesses"],
        summary: "Get churn signal for a business",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Churn signal", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, churn: { type: "object" } } } } } } },
      },
    },

    // ── Customers ──────────────────────────────────────────────────────────────
    "/customers": {
      post: {
        tags: ["Customers"],
        summary: "Register a customer",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "phone"],
                properties: {
                  name:          { type: "string", example: "Amara Diallo" },
                  phone:         { type: "string", example: "+2250700000000" },
                  email:         { type: "string", format: "email" },
                  accountType:   { type: "string", enum: ["personal", "business"], default: "personal" },
                  referralInput: { type: "string", description: "Referrer's referral code" },
                },
              },
            },
          },
        },
        responses: {
          201: { description: "Customer created", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/Ok" }, { type: "object", properties: { customer: { $ref: "#/components/schemas/Customer" } } }] } } } },
          409: { description: "Phone already registered", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
      get: {
        tags: ["Customers"],
        summary: "List all customers",
        responses: { 200: { description: "Customers list", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, customers: { type: "array", items: { $ref: "#/components/schemas/Customer" } } } } } } } },
      },
    },
    "/customers/inline": {
      post: {
        tags: ["Customers"],
        summary: "Add a provisional customer by phone number",
        description: "Creates a minimal customer record with only a phone number. Used when a merchant logs a sale for a non-registered customer.",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["phone"], properties: { phone: { type: "string", example: "+2250700000001" } } } } } },
        responses: {
          201: { description: "Customer created or found", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/Ok" }, { type: "object", properties: { customer: { $ref: "#/components/schemas/Customer" } } }] } } } },
        },
      },
    },
    "/customers/{id}": {
      get: {
        tags: ["Customers"],
        summary: "Get a single customer with memberships",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: { description: "Customer with memberships", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/Ok" }, { type: "object", properties: { customer: { $ref: "#/components/schemas/Customer" } } }] } } } },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/customers/{id}/join": {
      post: {
        tags: ["Customers"],
        summary: "Join a business loyalty programme",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["businessId"], properties: { businessId: { type: "string" } } } } } },
        responses: {
          200: { description: "Membership created", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/Ok" }, { type: "object", properties: { membership: { $ref: "#/components/schemas/Membership" } } }] } } } },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/customers/{id}/memberships": {
      get: {
        tags: ["Customers"],
        summary: "Get point balances per business",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Memberships list", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, memberships: { type: "array", items: { $ref: "#/components/schemas/Membership" } } } } } } } },
      },
    },
    "/customers/{id}/spin-tokens": {
      get: {
        tags: ["Customers"],
        summary: "Get unused spin tokens for a customer",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Spin tokens", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, tokens: { type: "array", items: { $ref: "#/components/schemas/SpinToken" } } } } } } } },
      },
    },
    "/customers/{id}/raffle-tickets": {
      get: {
        tags: ["Customers"],
        summary: "Get current month's raffle tickets",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Raffle tickets", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, tickets: { type: "array", items: { type: "object" } } } } } } } },
      },
    },
    "/customers/{id}/spin": {
      post: {
        tags: ["Customers"],
        summary: "Use a spin token",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["tokenId"], properties: { tokenId: { type: "string" } } } } } },
        responses: {
          200: { description: "Spin result with points won", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, pts: { type: "number" }, boost: { type: "boolean" } } } } } },
          400: { $ref: "#/components/responses/BadRequest" },
        },
      },
    },
    "/customers/{id}/transfer-points": {
      post: {
        tags: ["Customers"],
        summary: "Transfer points between two businesses",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["fromBizId", "toBizId"], properties: { fromBizId: { type: "string" }, toBizId: { type: "string" } } } } } },
        responses: {
          200: { description: "Transfer result", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, pts: { type: "number" } } } } } },
          400: { $ref: "#/components/responses/BadRequest" },
        },
      },
    },

    // ── Transactions ───────────────────────────────────────────────────────────
    "/transactions": {
      post: {
        tags: ["Transactions"],
        summary: "Log a sale or service transaction",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["businessId", "customerId", "amount"],
                properties: {
                  businessId:  { type: "string" },
                  customerId:  { type: "string" },
                  amount:      { type: "number", example: 5000 },
                  description: { type: "string" },
                  type:        { type: "string", enum: ["sale", "rental", "service", "stay", "appointment", "order", "session", "consultation"], default: "sale" },
                  lineItems:   { type: "array", items: { type: "object" } },
                  role:        { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          201: { description: "Transaction created", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/Ok" }, { type: "object", properties: { transaction: { $ref: "#/components/schemas/Transaction" } } }] } } } },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/transactions/receipts": {
      post: {
        tags: ["Transactions"],
        summary: "Generate a receipt for a transaction",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["transactionId", "customerId", "businessId", "amount"],
                properties: {
                  transactionId: { type: "string" },
                  customerId:    { type: "string" },
                  businessId:    { type: "string" },
                  description:   { type: "string" },
                  amount:        { type: "number" },
                  lineItems:     { type: "array", items: { type: "object" } },
                },
              },
            },
          },
        },
        responses: {
          201: { description: "Receipt created", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/Ok" }, { type: "object", properties: { receipt: { $ref: "#/components/schemas/Receipt" } } }] } } } },
        },
      },
    },
    "/transactions/receipts/{id}/acknowledge": {
      post: {
        tags: ["Transactions"],
        summary: "Customer acknowledges a receipt",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["customerId"], properties: { customerId: { type: "string" } } } } } },
        responses: {
          200: { description: "Receipt acknowledged", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/transactions/scan": {
      post: {
        tags: ["Transactions"],
        summary: "Customer scans a receipt to earn points",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["customerId", "businessId", "amount", "receiptDate", "receiptHash"],
                properties: {
                  customerId:   { type: "string" },
                  businessId:   { type: "string" },
                  amount:       { type: "number" },
                  lineItems:    { type: "array", items: { type: "object" } },
                  receiptDate:  { type: "string", format: "date-time" },
                  receiptHash:  { type: "string", description: "Unique hash to prevent duplicate scans" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Scan result", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, pts: { type: "number" }, deferred: { type: "boolean" } } } } } },
          400: { $ref: "#/components/responses/BadRequest" },
        },
      },
    },
    "/transactions/expire-points": {
      post: {
        tags: ["Transactions"],
        summary: "Run the point expiry check",
        description: "Expires points for members who have been inactive beyond their tier's expiry window. Call this nightly via cron.",
        responses: { 200: { description: "Expiry results", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, expired: { type: "number" } } } } } } },
      },
    },
    "/transactions/feedback/request": {
      post: {
        tags: ["Transactions"],
        summary: "Request feedback from a customer",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["businessId", "customerId", "receiptId"], properties: { businessId: { type: "string" }, customerId: { type: "string" }, receiptId: { type: "string" } } } } } },
        responses: { 201: { description: "Feedback request created", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },
    "/transactions/feedback": {
      post: {
        tags: ["Transactions"],
        summary: "Submit customer feedback",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["customerId", "businessId", "rating"],
                properties: {
                  requestId:  { type: "string" },
                  customerId: { type: "string" },
                  businessId: { type: "string" },
                  receiptId:  { type: "string" },
                  rating:     { type: "number", minimum: 1, maximum: 5 },
                  comment:    { type: "string" },
                },
              },
            },
          },
        },
        responses: { 201: { description: "Feedback submitted", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },
    "/transactions/reminders": {
      post: {
        tags: ["Transactions"],
        summary: "Set a reorder reminder for a product",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["customerId", "businessId", "product", "days"], properties: { customerId: { type: "string" }, businessId: { type: "string" }, receiptId: { type: "string" }, product: { type: "string" }, days: { type: "number" } } } } } },
        responses: { 201: { description: "Reminder created", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },
    "/transactions/reminders/{id}/dismiss": {
      patch: {
        tags: ["Transactions"],
        summary: "Dismiss a reminder",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: { description: "Reminder dismissed", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/transactions/reorders": {
      post: {
        tags: ["Transactions"],
        summary: "Request a reorder",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["customerId", "businessId", "product", "transactionId"], properties: { customerId: { type: "string" }, businessId: { type: "string" }, product: { type: "string" }, transactionId: { type: "string" } } } } } },
        responses: { 201: { description: "Reorder request created", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },
    "/transactions/reorders/{id}/fulfill": {
      patch: {
        tags: ["Transactions"],
        summary: "Mark a reorder as fulfilled",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: { description: "Reorder fulfilled", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },

    // ── Agreements ─────────────────────────────────────────────────────────────
    "/agreements": {
      post: {
        tags: ["Agreements"],
        summary: "Create a credit agreement",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["businessId", "customerId", "description", "amount"],
                properties: {
                  businessId:   { type: "string" },
                  customerId:   { type: "string" },
                  description:  { type: "string" },
                  amount:       { type: "number" },
                  sym:          { type: "string", default: "FCFA" },
                  service:      { type: "string" },
                  paymentTerms: { type: "string" },
                  serviceDate:  { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          201: { description: "Agreement created", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/Ok" }, { type: "object", properties: { agreement: { $ref: "#/components/schemas/Agreement" } } }] } } } },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/agreements/business/{businessId}": {
      get: {
        tags: ["Agreements"],
        summary: "List agreements for a business",
        parameters: [{ name: "businessId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Agreements", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, agreements: { type: "array", items: { $ref: "#/components/schemas/Agreement" } } } } } } } },
      },
    },
    "/agreements/customer/{customerId}": {
      get: {
        tags: ["Agreements"],
        summary: "List agreements for a customer",
        parameters: [{ name: "customerId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Agreements", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, agreements: { type: "array", items: { $ref: "#/components/schemas/Agreement" } } } } } } } },
      },
    },
    "/agreements/{id}/validate": {
      post: {
        tags: ["Agreements"],
        summary: "Validate an agreement",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["customerId"], properties: { customerId: { type: "string" } } } } } },
        responses: { 200: { description: "Agreement validated", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },
    "/agreements/{id}/reject": {
      post: {
        tags: ["Agreements"],
        summary: "Reject an agreement",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["reason"], properties: { reason: { type: "string" } } } } } },
        responses: { 200: { description: "Agreement rejected", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },
    "/agreements/{id}/void": {
      post: {
        tags: ["Agreements"],
        summary: "Void an agreement",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Agreement voided", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },
    "/agreements/{id}/amendments": {
      post: {
        tags: ["Agreements"],
        summary: "Add an amendment to an agreement",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { lineItems: { type: "array", items: { type: "object" } }, paymentDueDate: { type: "string" }, note: { type: "string" } } } } } },
        responses: { 201: { description: "Amendment added", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },
    "/agreements/{id}/amendments/{amendId}/validate": {
      post: {
        tags: ["Agreements"],
        summary: "Validate an amendment",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "amendId", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["customerId"], properties: { customerId: { type: "string" } } } } } },
        responses: { 200: { description: "Amendment validated", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },
    "/agreements/{id}/amendments/{amendId}/reject": {
      post: {
        tags: ["Agreements"],
        summary: "Reject an amendment",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "amendId", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["reason"], properties: { reason: { type: "string" } } } } } },
        responses: { 200: { description: "Amendment rejected", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },
    "/agreements/personal": {
      post: {
        tags: ["Agreements"],
        summary: "Create a personal ledger record",
        description: "Tracks a debt between a customer and an off-platform vendor.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["customerId", "vendorName", "description", "totalAmount"],
                properties: {
                  customerId:   { type: "string" },
                  vendorName:   { type: "string" },
                  vendorPhone:  { type: "string" },
                  description:  { type: "string" },
                  totalAmount:  { type: "number" },
                  paymentTerms: { type: "string" },
                  dueDate:      { type: "string" },
                },
              },
            },
          },
        },
        responses: { 201: { description: "Record created", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },
    "/agreements/personal/customer/{customerId}": {
      get: {
        tags: ["Agreements"],
        summary: "List personal ledger records for a customer",
        parameters: [{ name: "customerId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Personal ledger records", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, records: { type: "array", items: { type: "object" } } } } } } } },
      },
    },
    "/agreements/personal/{id}/payment": {
      post: {
        tags: ["Agreements"],
        summary: "Add a payment to a personal ledger record",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["amount"], properties: { amount: { type: "number" }, note: { type: "string" }, date: { type: "string" } } } } } },
        responses: { 201: { description: "Payment added", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },
    "/agreements/personal/{id}/amendment": {
      post: {
        tags: ["Agreements"],
        summary: "Add an amendment to a personal ledger record",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { description: { type: "string" }, additionalAmount: { type: "number" }, dueDate: { type: "string" }, note: { type: "string" } } } } } },
        responses: { 201: { description: "Amendment added", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },
    "/agreements/personal/resolve-invite": {
      post: {
        tags: ["Agreements"],
        summary: "Resolve an invite code to a personal ledger record",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["code"], properties: { code: { type: "string" } } } } } },
        responses: { 200: { description: "Resolved record", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },
    "/agreements/personal/{id}/mark-invite-sent": {
      post: {
        tags: ["Agreements"],
        summary: "Mark an invite as sent",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Invite marked sent", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },
    "/agreements/personal/{id}/link": {
      post: {
        tags: ["Agreements"],
        summary: "Link a personal ledger record to a business agreement",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["businessId", "customerId"], properties: { businessId: { type: "string" }, customerId: { type: "string" } } } } } },
        responses: { 200: { description: "Record linked", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },

    // ── Redemptions ────────────────────────────────────────────────────────────
    "/redemptions": {
      post: {
        tags: ["Redemptions"],
        summary: "Request a redemption — generates a voucher code",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["customerId", "businessId", "ptsToRedeem"],
                properties: {
                  customerId:  { type: "string" },
                  businessId:  { type: "string" },
                  ptsToRedeem: { type: "integer", example: 500 },
                  tierName:    { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          201: { description: "Voucher code generated", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, code: { type: "string" }, discount: { type: "number" }, pending: { $ref: "#/components/schemas/PendingRedemption" } } } } } },
          400: { $ref: "#/components/responses/BadRequest" },
        },
      },
    },
    "/redemptions/{id}/confirm": {
      post: {
        tags: ["Redemptions"],
        summary: "Merchant confirms a voucher",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: { description: "Redemption confirmed", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } },
          400: { $ref: "#/components/responses/BadRequest" },
        },
      },
    },
    "/redemptions/{id}/cancel": {
      post: {
        tags: ["Redemptions"],
        summary: "Cancel a pending redemption",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Redemption cancelled", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },
    "/redemptions/direct": {
      post: {
        tags: ["Redemptions"],
        summary: "Redeem points immediately without a voucher stage",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["customerId", "businessId", "ptsToRedeem"],
                properties: {
                  customerId:  { type: "string" },
                  businessId:  { type: "string" },
                  ptsToRedeem: { type: "integer" },
                  tierName:    { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Redemption applied", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, discount: { type: "number" } } } } } },
          400: { $ref: "#/components/responses/BadRequest" },
        },
      },
    },
    "/redemptions/business/{businessId}": {
      get: {
        tags: ["Redemptions"],
        summary: "List confirmed redemptions for a business",
        parameters: [{ name: "businessId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Redemptions list", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, redemptions: { type: "array", items: { type: "object" } } } } } } } },
      },
    },

    // ── Coalitions ─────────────────────────────────────────────────────────────
    "/coalitions": {
      post: {
        tags: ["Coalitions"],
        summary: "Create a coalition",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "businessId"],
                properties: {
                  name:       { type: "string", example: "Marché Plateau Alliance" },
                  businessId: { type: "string" },
                },
              },
            },
          },
        },
        responses: { 201: { description: "Coalition created", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/Ok" }, { type: "object", properties: { coalition: { $ref: "#/components/schemas/Coalition" } } }] } } } } },
      },
      get: {
        tags: ["Coalitions"],
        summary: "List all coalitions",
        responses: { 200: { description: "Coalitions list", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, coalitions: { type: "array", items: { $ref: "#/components/schemas/Coalition" } } } } } } } },
      },
    },
    "/coalitions/{id}": {
      get: {
        tags: ["Coalitions"],
        summary: "Get a single coalition",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: { description: "Coalition", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/Ok" }, { type: "object", properties: { coalition: { $ref: "#/components/schemas/Coalition" } } }] } } } },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/coalitions/{id}/join": {
      post: {
        tags: ["Coalitions"],
        summary: "Add a business to a coalition",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["businessId"], properties: { businessId: { type: "string" } } } } } },
        responses: { 200: { description: "Business joined coalition", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },
    "/coalitions/{id}/leave": {
      post: {
        tags: ["Coalitions"],
        summary: "Remove a business from a coalition",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["businessId"], properties: { businessId: { type: "string" } } } } } },
        responses: { 200: { description: "Business left coalition", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },

    // ── Raffle ─────────────────────────────────────────────────────────────────
    "/raffle/stats": {
      get: {
        tags: ["Raffle"],
        summary: "Current month stats and draw eligibility",
        responses: {
          200: {
            description: "Raffle stats",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok:           { type: "boolean" },
                    monthKey:     { type: "string", example: "2026-04" },
                    uniqueBuyers: { type: "number" },
                    totalTickets: { type: "number" },
                    prizePool:    { type: "number" },
                    eligible:     { type: "boolean" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/raffle/draw": {
      post: {
        tags: ["Raffle"],
        summary: "Run the monthly raffle draw",
        description: "Requires the admin key. Picks a winner from eligible tickets for the given month.",
        security: [{ AdminKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["monthKey"], properties: { monthKey: { type: "string", example: "2026-04" } } } } } },
        responses: {
          200: { description: "Draw result", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, winner: { type: "object" }, prize: { type: "number" } } } } } },
          400: { $ref: "#/components/responses/BadRequest" },
          401: { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/raffle/draws": {
      get: {
        tags: ["Raffle"],
        summary: "List all past draws",
        responses: { 200: { description: "Past draws", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, draws: { type: "array", items: { type: "object" } } } } } } } },
      },
    },

    // ── Admin ──────────────────────────────────────────────────────────────────
    "/admin/stats": {
      get: {
        tags: ["Admin"],
        summary: "Platform overview counts",
        security: [{ AdminKey: [] }],
        responses: {
          200: { description: "Stats", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, businesses: { type: "number" }, customers: { type: "number" }, transactions: { type: "number" } } } } } },
          401: { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/admin/config": {
      get: {
        tags: ["Admin"],
        summary: "Get platform configuration",
        security: [{ AdminKey: [] }],
        responses: { 200: { description: "Platform config", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, config: { type: "object" } } } } } } },
      },
      patch: {
        tags: ["Admin"],
        summary: "Update platform configuration",
        security: [{ AdminKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { returnRate: { type: "number" }, platformMargin: { type: "number" }, coalitionRedemptionRate: { type: "number" }, currencies: { type: "array", items: { type: "object" } } } } } } },
        responses: { 200: { description: "Updated config", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },
    "/admin/config/currency/{code}": {
      patch: {
        tags: ["Admin"],
        summary: "Update a currency's price or redemption rate",
        security: [{ AdminKey: [] }],
        parameters: [{ name: "code", in: "path", required: true, schema: { type: "string" }, example: "FCFA" }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { ptPrice: { type: "number" }, redemptionRate: { type: "number" } } } } } },
        responses: { 200: { description: "Currency updated", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },
    "/admin/gift/business": {
      post: {
        tags: ["Admin"],
        summary: "Gift points to a business wallet",
        security: [{ AdminKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["businessId", "pts"], properties: { businessId: { type: "string" }, pts: { type: "number" }, reason: { type: "string" } } } } } },
        responses: { 200: { description: "Points gifted", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },
    "/admin/gift/customers": {
      post: {
        tags: ["Admin"],
        summary: "Gift points to a list of customers",
        security: [{ AdminKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["customerIds", "pts"], properties: { customerIds: { type: "array", items: { type: "string" } }, pts: { type: "number" } } } } } },
        responses: { 200: { description: "Points gifted", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },
    "/admin/gift/coalition": {
      post: {
        tags: ["Admin"],
        summary: "Add points to a coalition spin pool",
        security: [{ AdminKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["coalitionId", "pts"], properties: { coalitionId: { type: "string" }, pts: { type: "number" } } } } } },
        responses: { 200: { description: "Points added to spin pool", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },
    "/admin/businesses/{id}/suspend": {
      patch: {
        tags: ["Admin"],
        summary: "Suspend or reinstate a business",
        security: [{ AdminKey: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["suspended"], properties: { suspended: { type: "boolean" } } } } } },
        responses: { 200: { description: "Status updated", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },
    "/admin/businesses/{id}/suspend-coalition": {
      patch: {
        tags: ["Admin"],
        summary: "Suspend coalition benefits for a business",
        security: [{ AdminKey: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["suspended"], properties: { suspended: { type: "boolean" } } } } } },
        responses: { 200: { description: "Coalition benefits status updated", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },
    "/admin/businesses/{id}/merchant-tier": {
      patch: {
        tags: ["Admin"],
        summary: "Override a business's merchant tier",
        security: [{ AdminKey: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["tierKey"], properties: { tierKey: { type: "string" } } } } } },
        responses: { 200: { description: "Tier updated", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },
    "/admin/activity": {
      get: {
        tags: ["Admin"],
        summary: "View the last 200 activity log entries",
        security: [{ AdminKey: [] }],
        responses: { 200: { description: "Activity log", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, log: { type: "array", items: { type: "object" } } } } } } } },
      },
    },
  },
};
