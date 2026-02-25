import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { RalphCore } from "../ralph.js";

export function eventRoutes(core: RalphCore) {
	const app = new Hono();

	app.get("/event", (c) => {
		c.header("X-Accel-Buffering", "no");
		c.header("X-Content-Type-Options", "nosniff");

		return streamSSE(c, async (stream) => {
			const events = await core.event.subscribe({
				directory: c.req.query("directory"),
			});

			const heartbeat = setInterval(() => {
				stream.writeSSE({
					data: JSON.stringify({
						type: "server.heartbeat",
						properties: {},
					}),
				});
			}, 10_000);

			const done = new Promise<void>((resolve) => {
				stream.onAbort(() => {
					clearInterval(heartbeat);
					resolve();
				});
			});

			(async () => {
				try {
					for await (const event of events.stream) {
						await stream.writeSSE({
							data: JSON.stringify(event),
							event: event.type,
						});
					}
				} catch {
					// Stream closed by client or server — clean up
				}
				clearInterval(heartbeat);
				stream.close();
			})();

			await done;
		});
	});

	app.get("/global/event", (c) => {
		c.header("X-Accel-Buffering", "no");
		c.header("X-Content-Type-Options", "nosniff");

		return streamSSE(c, async (stream) => {
			const events = await core.event.subscribeGlobal();

			const heartbeat = setInterval(() => {
				stream.writeSSE({
					data: JSON.stringify({
						payload: {
							type: "server.heartbeat",
							properties: {},
						},
					}),
				});
			}, 10_000);

			const done = new Promise<void>((resolve) => {
				stream.onAbort(() => {
					clearInterval(heartbeat);
					resolve();
				});
			});

			(async () => {
				try {
					for await (const event of events.stream) {
						await stream.writeSSE({
							data: JSON.stringify(event),
						});
					}
				} catch {
					// Stream closed by client or server — clean up
				}
				clearInterval(heartbeat);
				stream.close();
			})();

			await done;
		});
	});

	return app;
}
