import type { MiddlewareHandler } from "hono";
import { errorResponse } from "./error.js";

// Simple API-key auth for admin routes.
// In production, replace with JWT / Clerk session verification.
export const adminAuth: MiddlewareHandler = async (c, next) => {
  const key = c.req.header("x-admin-key");
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return errorResponse(c, 401, "Unauthorized");
  }
  await next();
};
