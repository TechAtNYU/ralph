import { Hono } from "hono";
import type { RalphCore } from "../ralph.js";
import { sendResult } from "./helpers.js";

export function healthRoutes(core: RalphCore) {
	const app = new Hono();

	app.get("/global/health", async (c) => {
		const result = await core.health.health();
		return sendResult(c, result);
	});

	return app;
}
