import { Hono } from "hono";
import type { RalphCore } from "../ralph.js";
import { sendResult } from "./helpers.js";

export function pathRoutes(core: RalphCore) {
	const app = new Hono();

	app.get("/path", async (c) => {
		const result = await core.path.get({
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	return app;
}
