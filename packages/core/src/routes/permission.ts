import { Hono } from "hono";
import type { RalphCore } from "../ralph.js";
import { pathParam, sendResult } from "./helpers.js";

export function permissionRoutes(core: RalphCore) {
	const app = new Hono();

	app.get("/permission", async (c) => {
		const result = await core.permission.list({
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	app.post("/permission/:requestID/reply", async (c) => {
		const body = await c.req.json();
		const result = await core.permission.reply({
			requestID: pathParam(c, "requestID"),
			directory: c.req.query("directory"),
			reply: body.reply,
			message: body.message,
		});
		return sendResult(c, result);
	});

	return app;
}
