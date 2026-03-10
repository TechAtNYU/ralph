import { describe, expect, test } from "bun:test";

import { DaemonState, RequestMessage, ResponseMessage } from "../protocol";

describe("protocol schemas", () => {
	test("parses a valid submit request", () => {
		const parsed = RequestMessage.safeParse({
			id: "req-1",
			method: "job.submit",
			params: {
				session: { type: "new" },
				task: {
					type: "prompt",
					prompt: "hello",
				},
			},
		});

		expect(parsed.success).toBe(true);
	});

	test("rejects invalid request params", () => {
		const parsed = RequestMessage.safeParse({
			id: "req-1",
			method: "job.submit",
			params: {
				session: { type: "new" },
				task: {
					type: "prompt",
					prompt: "",
				},
			},
		});

		expect(parsed.success).toBe(false);
	});

	test("parses a valid success response", () => {
		const parsed = ResponseMessage.safeParse({
			id: "req-1",
			method: "instance.list",
			ok: true,
			result: {
				instances: [],
			},
		});

		expect(parsed.success).toBe(true);
	});

	test("rejects malformed error response", () => {
		const parsed = ResponseMessage.safeParse({
			id: "req-1",
			method: "job.get",
			ok: false,
			error: {
				code: "not_found",
			},
		});

		expect(parsed.success).toBe(false);
	});

	test("parses versioned daemon state", () => {
		const parsed = DaemonState.safeParse({
			version: 2,
			instances: [],
			jobs: [],
		});

		expect(parsed.success).toBe(true);
	});
});
