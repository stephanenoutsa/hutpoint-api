import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { SignJWT } from "jose";
import { db } from "../db.js";
import { hashPassword, verifyPassword } from "../lib/crypto.js";
import { referralCode } from "../lib/id.js";
import { errorResponse } from "../middleware/error.js";
import { requireAuth } from "../middleware/requireAuth.js";

type Env = { Variables: { userId: string } };
const app = new Hono<Env>();

const JWT_EXPIRY = "7d";

function getSecret() {
  return new TextEncoder().encode(process.env.JWT_SECRET!);
}

async function signToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(getSecret());
}

// ─── Register ─────────────────────────────────────────────────────────────────

app.post(
  "/register",
  zValidator("json", z.object({
    firstName: z.string().min(1),
    lastName:  z.string().min(1),
    phone:     z.string().min(1).transform(v => v.replace(/\s+/g, "")),
    password:  z.string().min(6),
  })),
  async (c) => {
    const { firstName, lastName, phone, password } = c.req.valid("json");

    const existing = await db.user.findUnique({ where: { phone } });
    if (existing) return errorResponse(c, 409, "Phone number already registered");

    const passwordHash = await hashPassword(password);
    const code = referralCode();

    const user = await db.user.create({
      data: {
        firstName,
        lastName,
        phone,
        passwordHash,
        // Auto-create a linked Customer record
        customer: {
          create: {
            name: `${firstName} ${lastName}`,
            phone,
            referralCode: code,
          },
        },
      },
      include: { customer: true },
    });

    const token = await signToken(user.id);

    return c.json({
      ok: true,
      token,
      user: {
        id:        user.id,
        firstName: user.firstName,
        lastName:  user.lastName,
        phone:     user.phone,
        customer:  user.customer,
      },
    }, 201);
  },
);

// ─── Login ────────────────────────────────────────────────────────────────────

app.post(
  "/login",
  zValidator("json", z.object({
    phone:    z.string().min(1).transform(v => v.replace(/\s+/g, "")),
    password: z.string().min(1),
  })),
  async (c) => {
    const { phone, password } = c.req.valid("json");

    const user = await db.user.findUnique({
      where: { phone },
      include: {
        customer: true,
        businessMembers: {
          include: { business: { include: { wallet: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!user) return errorResponse(c, 401, "Invalid phone number or password");

    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid) return errorResponse(c, 401, "Invalid phone number or password");

    const token = await signToken(user.id);

    return c.json({
      ok: true,
      token,
      user: {
        id:        user.id,
        firstName: user.firstName,
        lastName:  user.lastName,
        phone:     user.phone,
        customer:  user.customer,
        businesses: user.businessMembers.map((m) => ({
          role:     m.role,
          business: m.business,
        })),
      },
    });
  },
);

// ─── Admin login ──────────────────────────────────────────────────────────────

app.post(
  "/admin/login",
  zValidator("json", z.object({
    phone:    z.string().min(1).transform(v => v.replace(/\s+/g, "")),
    password: z.string().min(1),
  })),
  async (c) => {
    const { phone, password } = c.req.valid("json");

    const user = await db.user.findUnique({ where: { phone } });
    if (!user || !user.isAdmin) return errorResponse(c, 401, "Invalid credentials");

    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid) return errorResponse(c, 401, "Invalid credentials");

    const token = await signToken(user.id);

    return c.json({
      ok: true,
      token,
      user: {
        id:        user.id,
        firstName: user.firstName,
        lastName:  user.lastName,
        phone:     user.phone,
        isAdmin:   user.isAdmin,
      },
    });
  },
);

// ─── Me ───────────────────────────────────────────────────────────────────────

app.get("/me", requireAuth, async (c) => {
  const userId = c.get("userId") as string;

  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      customer: true,
      businessMembers: {
        include: { business: { include: { wallet: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!user) return errorResponse(c, 404, "User not found");

  return c.json({
    ok: true,
    user: {
      id:        user.id,
      firstName: user.firstName,
      lastName:  user.lastName,
      phone:     user.phone,
      customer:  user.customer,
      businesses: user.businessMembers.map((m) => ({
        role:     m.role,
        business: m.business,
      })),
    },
  });
});

export default app;
