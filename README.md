# Hutpoint API

REST API backend for the Hutpoint loyalty platform.

Built with **Hono + TypeScript + Prisma + PostgreSQL** (Supabase recommended). Handles all business logic: point calculations, transactions, agreements, redemptions, coalitions, raffle draws, and platform administration.

---

## Project structure

```
prisma/
  schema.prisma          # Full database schema (24 models)
src/
  index.ts               # Server entry point — middleware, routes, error handling
  db.ts                  # Prisma client singleton
  lib/
    tiers.ts             # Loyalty tier builder, merchant tiers, platform defaults
    churn.ts             # Merchant churn signal logic
    id.ts                # uid, referralCode, voucherCode, inviteCode generators
    json.ts              # Prisma JSON field cast helpers
  middleware/
    auth.ts              # Admin API key guard
    error.ts             # errorResponse helper
  routes/
    bootstrap.ts         # GET /bootstrap — full state snapshot for frontend hydration
    businesses.ts        # Register, wallet top-up, settings, tier management, churn
    customers.ts         # Register, join business, spin wheel, point transfer
    transactions.ts      # Log sales, scan receipts, feedback, reminders, reorders
    agreements.ts        # Credit agreements, amendments, personal ledger
    redemptions.ts       # Request, confirm, cancel, direct redemption
    coalitions.ts        # Create, join, leave coalitions
    raffle.ts            # Monthly raffle stats and draw execution
    admin.ts             # Platform config, gifts, suspend, stats (all key-gated)
```

---

## Prerequisites

- Node.js 18+
- npm 9+
- A PostgreSQL database (Supabase recommended — free tier available at [supabase.com](https://supabase.com))

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in all values:

```env
# Pooled connection — used by the running API (port 6543 with pgbouncer)
DATABASE_URL="postgresql://postgres:[PASSWORD]@[HOST]:6543/postgres?pgbouncer=true"

# Direct connection — used by Prisma for migrations (port 5432)
DIRECT_URL="postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres"

# Secret used to verify admin requests (set a long random string)
ADMIN_API_KEY="your-secret-admin-key"

# Port the server listens on (default: 3001)
PORT=3001
```

**Getting your Supabase connection strings:**
1. Go to [supabase.com](https://supabase.com) and create a project
2. Navigate to **Settings → Database → Connection string**
3. Copy the **Transaction pooler URI** (port 6543) → `DATABASE_URL`
4. Copy the **Session pooler or direct URI** (port 5432) → `DIRECT_URL`

### 3. Generate the Prisma client

```bash
npm run db:generate
```

### 4. Run database migrations

This creates all tables in your database:

```bash
npm run db:migrate
```

---

## Running locally

```bash
npm run dev
```

The API will be available at **http://localhost:3001**.

Check it's running:

```bash
curl http://localhost:3001/health
```

---

## Building for production

```bash
npm run build       # Compiles TypeScript to dist/
npm start           # Runs the compiled output
```

---

## Deploying to Railway

1. Push the project to a GitHub repo
2. Go to [railway.app](https://railway.app) → **New Project → Deploy from GitHub**
3. Select the `hutpoint-api` repo
4. Under **Variables**, add all values from your `.env`
5. Under the public domain settings, set the **target port** to `3001` and add `PORT=3001` as an environment variable so the app and Railway's proxy agree on the port
6. Railway auto-detects the start command (`npm start`) and deploys

> The server binds to `0.0.0.0` so Railway's proxy can route external traffic to it.

---

## API reference

All endpoints return `{ ok: true, ... }` on success or `{ ok: false, error: "..." }` on failure.

### Bootstrap
| Method | Path | Description |
|---|---|---|
| `GET` | `/bootstrap` | Returns all platform state in one response — used by the frontend to hydrate on mount |

### Businesses
| Method | Path | Description |
|---|---|---|
| `POST` | `/businesses` | Register a new business |
| `GET` | `/businesses` | List all businesses |
| `GET` | `/businesses/:id` | Get a single business |
| `PATCH` | `/businesses/:id/settings` | Update engagement settings |
| `POST` | `/businesses/:id/wallet/topup` | Purchase points (top-up wallet) |
| `GET` | `/businesses/:id/customers` | List members with their point balances |
| `GET` | `/businesses/:id/transactions` | List recent transactions |
| `GET` | `/businesses/:id/tiers` | Get loyalty tiers for this business |
| `POST` | `/businesses/:id/tier` | Switch merchant tier |
| `GET` | `/businesses/:id/churn` | Get churn signal |

### Customers
| Method | Path | Description |
|---|---|---|
| `POST` | `/customers` | Register a customer |
| `POST` | `/customers/inline` | Add a provisional customer by phone |
| `GET` | `/customers` | List all customers |
| `GET` | `/customers/:id` | Get a single customer with memberships |
| `POST` | `/customers/:id/join` | Join a business loyalty programme |
| `GET` | `/customers/:id/memberships` | Get point balances per business |
| `GET` | `/customers/:id/spin-tokens` | Get unused spin tokens |
| `GET` | `/customers/:id/raffle-tickets` | Get current month's raffle tickets |
| `POST` | `/customers/:id/spin` | Use a spin token |
| `POST` | `/customers/:id/transfer-points` | Transfer points between businesses |

### Transactions
| Method | Path | Description |
|---|---|---|
| `POST` | `/transactions` | Log a sale / service transaction |
| `POST` | `/transactions/receipts` | Generate a receipt |
| `POST` | `/transactions/receipts/:id/acknowledge` | Customer acknowledges a receipt |
| `POST` | `/transactions/scan` | Customer scans a receipt to earn points |
| `POST` | `/transactions/expire-points` | Run point expiry check (call via cron) |
| `POST` | `/transactions/feedback/request` | Request feedback from a customer |
| `POST` | `/transactions/feedback` | Submit customer feedback |
| `POST` | `/transactions/reminders` | Set a reorder reminder |
| `PATCH` | `/transactions/reminders/:id/dismiss` | Dismiss a reminder |
| `POST` | `/transactions/reorders` | Request a reorder |
| `PATCH` | `/transactions/reorders/:id/fulfill` | Mark a reorder as fulfilled |

### Agreements
| Method | Path | Description |
|---|---|---|
| `POST` | `/agreements` | Create a credit agreement |
| `GET` | `/agreements/business/:businessId` | List agreements for a business |
| `GET` | `/agreements/customer/:customerId` | List agreements for a customer |
| `POST` | `/agreements/:id/validate` | Validate an agreement |
| `POST` | `/agreements/:id/reject` | Reject an agreement |
| `POST` | `/agreements/:id/void` | Void an agreement |
| `POST` | `/agreements/:id/amendments` | Add an amendment |
| `POST` | `/agreements/:id/amendments/:amendId/validate` | Validate an amendment |
| `POST` | `/agreements/:id/amendments/:amendId/reject` | Reject an amendment |
| `POST` | `/agreements/personal` | Create a personal ledger record |
| `GET` | `/agreements/personal/customer/:customerId` | List personal ledger records |
| `POST` | `/agreements/personal/:id/payment` | Add a payment to a record |
| `POST` | `/agreements/personal/:id/amendment` | Add an amendment to a record |
| `POST` | `/agreements/personal/resolve-invite` | Resolve an invite code |
| `POST` | `/agreements/personal/:id/mark-invite-sent` | Mark invite as sent |
| `POST` | `/agreements/personal/:id/link` | Link record to a business agreement |

### Redemptions
| Method | Path | Description |
|---|---|---|
| `POST` | `/redemptions` | Request a redemption (generates voucher code) |
| `POST` | `/redemptions/:id/confirm` | Merchant confirms the voucher |
| `POST` | `/redemptions/:id/cancel` | Cancel a pending redemption |
| `POST` | `/redemptions/direct` | Redeem points immediately (no voucher stage) |
| `GET` | `/redemptions/business/:businessId` | List redemptions for a business |

### Coalitions
| Method | Path | Description |
|---|---|---|
| `POST` | `/coalitions` | Create a coalition |
| `GET` | `/coalitions` | List all coalitions |
| `GET` | `/coalitions/:id` | Get a single coalition |
| `POST` | `/coalitions/:id/join` | Add a business to a coalition |
| `POST` | `/coalitions/:id/leave` | Remove a business from a coalition |

### Raffle
| Method | Path | Description |
|---|---|---|
| `GET` | `/raffle/stats` | Current month stats and eligibility |
| `POST` | `/raffle/draw` | Run the monthly draw (admin key required) |
| `GET` | `/raffle/draws` | List all past draws |

### Admin (all require `x-admin-key` header)
| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/stats` | Platform overview (business/customer/tx counts) |
| `GET` | `/admin/config` | Get platform configuration |
| `PATCH` | `/admin/config` | Update platform configuration |
| `PATCH` | `/admin/config/currency/:code` | Update a currency's price or redemption rate |
| `POST` | `/admin/gift/business` | Gift points to a business wallet |
| `POST` | `/admin/gift/customers` | Gift points to a list of customers |
| `POST` | `/admin/gift/coalition` | Add points to a coalition spin pool |
| `PATCH` | `/admin/businesses/:id/suspend` | Suspend or reinstate a business |
| `PATCH` | `/admin/businesses/:id/suspend-coalition` | Suspend coalition benefits for a business |
| `PATCH` | `/admin/businesses/:id/merchant-tier` | Override a business's merchant tier |
| `GET` | `/admin/activity` | View the last 200 activity log entries |

**Admin requests must include the header:**
```
x-admin-key: your-secret-admin-key
```

---

## Point expiry

The `/transactions/expire-points` endpoint should be called on a schedule (e.g. nightly). Use a free service like [cron-job.org](https://cron-job.org) to call it:

```
POST https://your-api.railway.app/transactions/expire-points
```

---

## Related projects

| Project | Description |
|---|---|
| `Hutpoint` | Main merchant and customer-facing React app |
| `hutpoint-admin` | PIN-gated admin panel React app |
