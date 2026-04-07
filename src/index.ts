import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { swaggerUI } from "@hono/swagger-ui";

import bootstrap    from "./routes/bootstrap.js";
import businesses   from "./routes/businesses.js";
import customers    from "./routes/customers.js";
import transactions from "./routes/transactions.js";
import agreements   from "./routes/agreements.js";
import redemptions  from "./routes/redemptions.js";
import coalitions   from "./routes/coalitions.js";
import raffle       from "./routes/raffle.js";
import admin        from "./routes/admin.js";
import { spec }     from "./openapi.js";

const app = new Hono();

// ─── Global middleware ────────────────────────────────────────────────────────

app.use("*", logger());
app.use("*", prettyJSON());
app.use(
  "*",
  cors({
    origin: [
      "http://localhost:5173", // hutpoint (main app)
      "http://localhost:5174", // hutpoint-admin
      "https://hutpoint.vercel.app",
      "https://hutpoint-admin.vercel.app",
    ],
    allowHeaders: ["Content-Type", "x-admin-key"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }),
);

// ─── Health check ─────────────────────────────────────────────────────────────

app.get("/health", (c) => c.json({ ok: true, service: "hutpoint-api", ts: new Date().toISOString() }));

// ─── Swagger UI ───────────────────────────────────────────────────────────────

app.get("/docs/spec", (c) => c.json(spec));
app.get("/docs", swaggerUI({ url: "/docs/spec" }));

app.route("/bootstrap", bootstrap);

// ─── Routes ───────────────────────────────────────────────────────────────────

app.route("/businesses",  businesses);
app.route("/customers",   customers);
app.route("/transactions", transactions);
app.route("/agreements",  agreements);
app.route("/redemptions", redemptions);
app.route("/coalitions",  coalitions);
app.route("/raffle",      raffle);
app.route("/admin",       admin);

// ─── 404 fallback ─────────────────────────────────────────────────────────────

app.notFound((c) => c.json({ ok: false, error: "Not found" }, 404));

// ─── Global error handler ─────────────────────────────────────────────────────

app.onError((err, c) => {
  console.error(err);
  return c.json({ ok: false, error: "Internal server error" }, 500);
});

// ─── Start ────────────────────────────────────────────────────────────────────

const port = Number(process.env.PORT ?? 3001);
console.log(`hutpoint-api listening on http://0.0.0.0:${port}`);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
