import { Hono } from "hono";
import type { RalphCore } from "../ralph.js";
import { sendResult } from "./helpers.js";

export function appRoutes(core: RalphCore) {
	const app = new Hono();

	app.post("/log", async (c) => {
		const body = await c.req.json();
		const result = await core.app.log({
			directory: c.req.query("directory"),
			...body,
		});
		return sendResult(c, result);
	});

	app.get("/agent", async (c) => {
		const result = await core.app.agents({
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	app.get("/skill", async (c) => {
		const result = await core.app.skills({
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	return app;
}
