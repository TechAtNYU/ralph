import { Hono } from "hono";
import type { RalphCore } from "../ralph.js";
import { sendResult } from "./helpers.js";

export function vcsRoutes(core: RalphCore) {
	const app = new Hono();

	app.get("/vcs", async (c) => {
		const result = await core.vcs.get({
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	return app;
}
