import type { Context } from "hono";

export function errorResponse(c: Context, status: 400 | 401 | 403 | 404 | 409 | 422 | 500, message: string) {
  return c.json({ ok: false, error: message }, status);
}

export function notFound(c: Context) {
  return errorResponse(c, 404, "Not found");
}
