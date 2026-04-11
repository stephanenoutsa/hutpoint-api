import type { MiddlewareHandler } from "hono";
import { jwtVerify } from "jose";
import { errorResponse } from "./error.js";

type AuthEnv = { Variables: { userId: string } };

export const requireAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return errorResponse(c, 401, "Unauthorized");
  }
  const token = header.slice(7);
  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
    const { payload } = await jwtVerify(token, secret);
    c.set("userId", payload.sub as string);
    await next();
  } catch {
    return errorResponse(c, 401, "Invalid or expired token");
  }
};
