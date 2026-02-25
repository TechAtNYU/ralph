import type { Context } from "hono";
import type { RalphResult } from "../types.js";

/**
 * Sends a RalphResult as an HTTP response.
 * - ok: true  → 200 with { ok: true, data }
 * - ok: false → error.status with { ok: false, error }
 */
export function sendResult<T>(c: Context, result: RalphResult<T>): Response {
	if (result.ok) {
		return c.json(result, 200);
	}
	return c.json(result, result.error.status as 400);
}

/** Parse an optional integer query param. Returns undefined if not present. */
export function queryInt(c: Context, key: string): number | undefined {
	const val = c.req.query(key);
	if (val === undefined) return undefined;
	const n = Number.parseInt(val, 10);
	return Number.isNaN(n) ? undefined : n;
}

/** Get a required path param. Throws if missing. */
export function pathParam(c: Context, key: string): string {
	const val = c.req.param(key);
	if (!val) {
		throw new Error(`Missing required path param: ${key}`);
	}
	return val;
}
