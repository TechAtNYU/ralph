import { Hono } from "hono";
import type { RalphCore } from "../ralph.js";
import { pathParam, sendResult } from "./helpers.js";

export function authRoutes(core: RalphCore) {
	const app = new Hono();

	app.put("/auth/:providerID", async (c) => {
		const body = await c.req.json();
		const result = await core.auth.set({
			providerID: pathParam(c, "providerID"),
			auth: body,
		});
		return sendResult(c, result);
	});

	app.delete("/auth/:providerID", async (c) => {
		const result = await core.auth.remove({
			providerID: pathParam(c, "providerID"),
		});
		return sendResult(c, result);
	});

	return app;
}
