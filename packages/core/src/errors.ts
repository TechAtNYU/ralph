import type { RalphError, RalphResult } from "./types.js";

export function mapSdkError(error: unknown): RalphError {
	if (error && typeof error === "object") {
		// SDK BadRequestError shape: { errors, success: false }
		if (
			"errors" in error &&
			Array.isArray((error as { errors: unknown }).errors)
		) {
			return {
				code: "BAD_REQUEST",
				message: "Validation failed",
				status: 400,
				details: (error as { errors: unknown[] }).errors,
			};
		}

		// SDK NotFoundError shape: { message }
		if (
			"message" in error &&
			typeof (error as { message: unknown }).message === "string"
		) {
			const msg = (error as { message: string }).message;

			if (msg.toLowerCase().includes("not found")) {
				return { code: "NOT_FOUND", message: msg, status: 404 };
			}

			return { code: "SDK_ERROR", message: msg, status: 500 };
		}
	}

	return {
		code: "UNKNOWN_ERROR",
		message:
			error instanceof Error ? error.message : "An unknown error occurred",
		status: 500,
		details: error,
	};
}

/**
 * Wraps an SDK call that returns { data, error } into a RalphResult<T>.
 * Also catches thrown exceptions.
 */
export async function wrapSdkCall<T>(
	fn: () => Promise<{ data?: T; error?: unknown }>,
): Promise<RalphResult<T>> {
	try {
		const result = await fn();

		if (result.error !== undefined) {
			return { ok: false, error: mapSdkError(result.error) };
		}

		return { ok: true, data: result.data as T };
	} catch (thrown: unknown) {
		return { ok: false, error: mapSdkError(thrown) };
	}
}
