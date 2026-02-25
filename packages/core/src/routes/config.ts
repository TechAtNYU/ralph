import { Hono } from "hono";
import type { RalphCore } from "../ralph.js";
import { sendResult } from "./helpers.js";

export function configRoutes(core: RalphCore) {
	const app = new Hono();

	app.get("/config", async (c) => {
		const result = await core.config.get({
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	app.patch("/config", async (c) => {
		const body = await c.req.json();
		const result = await core.config.update({
			directory: c.req.query("directory"),
			config: body,
		});
		return sendResult(c, result);
	});

	app.get("/config/providers", async (c) => {
		const result = await core.config.providers({
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	app.get("/global/config", async (c) => {
		const result = await core.config.globalGet();
		return sendResult(c, result);
	});

	app.patch("/global/config", async (c) => {
		const body = await c.req.json();
		const result = await core.config.globalUpdate({ config: body });
		return sendResult(c, result);
	});

	return app;
}
