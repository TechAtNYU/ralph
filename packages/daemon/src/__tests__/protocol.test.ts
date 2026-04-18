import { describe, expect, test } from "bun:test";

import { DaemonState, RequestMessage, ResponseMessage } from "../protocol";

describe("protocol schemas", () => {
	test("parses a valid submit request", () => {
		const parsed = RequestMessage.safeParse({
			id: "req-1",
			method: "job.submit",
			params: {
				instanceId: "instance-1",
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
				instanceId: "instance-1",
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

	test("parses a valid session.diffs request", () => {
		const parsed = RequestMessage.safeParse({
			id: "req-1",
			method: "session.diffs",
			params: {
				instanceId: "instance-1",
				sessionId: "session-1",
			},
		});

		expect(parsed.success).toBe(true);
	});

	test("parses a valid session.diffs success response", () => {
		const parsed = ResponseMessage.safeParse({
			id: "req-1",
			method: "session.diffs",
			ok: true,
			result: {
				diffs: [
					{
						file: "src/a.ts",
						patch:
							"Index: src/a.ts\n===================================================================\n--- src/a.ts\n+++ src/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
						additions: 1,
						deletions: 1,
						status: "modified",
					},
				],
			},
		});

		expect(parsed.success).toBe(true);
	});

	test("rejects session.diffs request missing sessionId", () => {
		const parsed = RequestMessage.safeParse({
			id: "req-1",
			method: "session.diffs",
			params: {
				instanceId: "instance-1",
			},
		});

		expect(parsed.success).toBe(false);
	});

	test("rejects session.diffs request with empty instanceId", () => {
		const parsed = RequestMessage.safeParse({
			id: "req-1",
			method: "session.diffs",
			params: {
				instanceId: "",
				sessionId: "session-1",
			},
		});

		expect(parsed.success).toBe(false);
	});

	test("rejects session.diffs response with negative additions", () => {
		const parsed = ResponseMessage.safeParse({
			id: "req-1",
			method: "session.diffs",
			ok: true,
			result: {
				diffs: [
					{
						file: "src/a.ts",
						patch: "",
						additions: -1,
						deletions: 0,
					},
				],
			},
		});

		expect(parsed.success).toBe(false);
	});

	test("rejects session.diffs response missing patch field", () => {
		const parsed = ResponseMessage.safeParse({
			id: "req-1",
			method: "session.diffs",
			ok: true,
			result: {
				diffs: [
					{
						file: "src/a.ts",
						additions: 1,
						deletions: 0,
					},
				],
			},
		});

		expect(parsed.success).toBe(false);
	});

	test("parses daemon state", () => {
		const parsed = DaemonState.safeParse({
			instances: [],
			jobs: [],
		});

		expect(parsed.success).toBe(true);
	});
});
