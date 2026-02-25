import { Hono } from "hono";
import type { RalphCore } from "../ralph.js";
import { sendResult } from "./helpers.js";

export function commandRoutes(core: RalphCore) {
	const app = new Hono();

	app.get("/command", async (c) => {
		const result = await core.command.list({
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	return app;
}
