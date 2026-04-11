import type { MiddlewareHandler } from "hono";
import { jwtVerify } from "jose";
import { db } from "../db.js";
import { errorResponse } from "./error.js";

// ─── Admin key auth (API scripts / CI) ───────────────────────────────────────
// Accepts either the x-admin-key header OR a valid JWT belonging to an isAdmin user.
export const adminAuth: MiddlewareHandler = async (c, next) => {
  // Fast path: static API key (used by scripts / hutpoint-admin fallback)
  const key = c.req.header("x-admin-key");
  if (key && key === process.env.ADMIN_API_KEY) {
    await next();
    return;
  }

  // JWT path: platform admin logged in via the admin app
  const header = c.req.header("Authorization");
  if (header?.startsWith("Bearer ")) {
    try {
      const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
      const { payload } = await jwtVerify(header.slice(7), secret);
      const userId = payload.sub as string;
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { isAdmin: true },
      });
      if (user?.isAdmin) {
        await next();
        return;
      }
    } catch {
      // fall through to 401
    }
  }

  return errorResponse(c, 401, "Unauthorized");
};
