import { z } from "zod";

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be ISO-8601 date (YYYY-MM-DD).");

export const dayCountConvention = z
  .enum(["30/360", "ACT/ACT", "ACT/360", "ACT/365F"])
  .describe("Day-count convention for accrual. Default 30/360 (US corporate).");

export const frequencyPerYear = z
  .union([z.literal(1), z.literal(2), z.literal(4), z.literal(12)])
  .describe("Coupon payments per year: 1 (annual), 2 (semi-annual), 4 (quarterly), 12 (monthly).");

const scheduleEntry = z.object({
  date: isoDate.describe("Call or put date (YYYY-MM-DD)."),
  price: z.number().positive().describe("Call or put price per 100 par (e.g. 101 for 101% of par)."),
});

// Raw Zod shape used as inputSchema on the MCP tool. v1 ships the fixed-coupon
// subset that /api/v1/compute/bond supports today. FRN / zero / TIPS are
// deferred. Callable and putable bonds are supported via callSchedule / putSchedule.
export const priceBondInputShape = {
  faceValue: z
    .number()
    .positive()
    .describe("Face value (par) of the bond, typically 1000."),
  couponPct: z
    .number()
    .min(0)
    .describe("Annual coupon rate in percent (e.g. 4.25 for 4.25%)."),
  frequencyPerYear: frequencyPerYear,
  settlementDate: isoDate.describe("Settlement date (YYYY-MM-DD)."),
  maturityDate: isoDate.describe("Bond maturity date (YYYY-MM-DD); must be after settlementDate."),
  ytmPct: z
    .number()
    .optional()
    .describe("If supplied, price the bond at this yield-to-maturity (percent). Mutually exclusive with cleanPrice; one of the two must be provided."),
  cleanPrice: z
    .number()
    .positive()
    .optional()
    .describe("If supplied, solve YTM from this clean price (per 100 par). Mutually exclusive with ytmPct."),
  notional: z
    .number()
    .positive()
    .optional()
    .describe("Position notional used to scale DV01 (defaults to faceValue)."),
  dayCountConvention: dayCountConvention.optional(),
  callSchedule: z
    .array(scheduleEntry)
    .max(30)
    .optional()
    .describe(
      "Optional call schedule for callable bonds. Each entry: { date: YYYY-MM-DD, price: per-100-par }. Returns ytcPct (min YTC), ytwPct, ytwType.",
    ),
  putSchedule: z
    .array(scheduleEntry)
    .max(30)
    .optional()
    .describe(
      "Optional put schedule for putable bonds. Each entry: { date: YYYY-MM-DD, price: per-100-par }. Returns ytpPct (min YTP). Puts are not included in YTW per standard convention.",
    ),
} as const;

/**
 * Subset of the bond shape used by routes that don't take ytmPct / cleanPrice
 * (stress: prices from the supplied curve; horizon: prices from activeYtmPct).
 */
export const bondCoreInputShape = {
  faceValue: priceBondInputShape.faceValue,
  couponPct: priceBondInputShape.couponPct,
  frequencyPerYear: priceBondInputShape.frequencyPerYear,
  settlementDate: priceBondInputShape.settlementDate,
  maturityDate: priceBondInputShape.maturityDate,
  notional: priceBondInputShape.notional,
  dayCountConvention: priceBondInputShape.dayCountConvention,
} as const;

export const curvePoint = z.object({
  t: z.number().positive().describe("Tenor in years (e.g. 0.5, 1, 2, 5, 10, 30)."),
  zeroPct: z.number().describe("Zero rate in percent at this tenor."),
});
