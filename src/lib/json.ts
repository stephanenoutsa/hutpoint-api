import { Prisma } from "@prisma/client";

/** Cast any value to Prisma's InputJsonValue (for non-nullable Json fields). */
export const toJson = (v: unknown): Prisma.InputJsonValue =>
  v as Prisma.InputJsonValue;

/** Cast any value to Prisma's NullableJsonInput (for nullable Json fields). */
export const toNullableJson = (v: unknown): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue =>
  v == null ? Prisma.JsonNull : (v as Prisma.InputJsonValue);
