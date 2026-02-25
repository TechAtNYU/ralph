import { Hono } from "hono";
import type { RalphCore } from "../ralph.js";
import { pathParam, sendResult } from "./helpers.js";

export function projectRoutes(core: RalphCore) {
	const app = new Hono();

	app.get("/project", async (c) => {
		const result = await core.project.list({
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	app.get("/project/current", async (c) => {
		const result = await core.project.current({
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	app.patch("/project/:projectID", async (c) => {
		const body = await c.req.json();
		const result = await core.project.update({
			projectID: pathParam(c, "projectID"),
			directory: c.req.query("directory"),
			name: body.name,
			icon: body.icon,
			commands: body.commands,
		});
		return sendResult(c, result);
	});

	return app;
}
