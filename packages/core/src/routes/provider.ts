import { Hono } from "hono";
import type { RalphCore } from "../ralph.js";
import { pathParam, sendResult } from "./helpers.js";

export function providerRoutes(core: RalphCore) {
	const app = new Hono();

	app.get("/provider", async (c) => {
		const result = await core.provider.list({
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	app.get("/provider/auth", async (c) => {
		const result = await core.provider.auth({
			directory: c.req.query("directory"),
		});
		return sendResult(c, result);
	});

	app.post("/provider/:providerID/oauth/authorize", async (c) => {
		const body = await c.req.json();
		const result = await core.provider.oauthAuthorize({
			providerID: pathParam(c, "providerID"),
			directory: c.req.query("directory"),
			method: body.method,
		});
		return sendResult(c, result);
	});

	app.post("/provider/:providerID/oauth/callback", async (c) => {
		const body = await c.req.json();
		const result = await core.provider.oauthCallback({
			providerID: pathParam(c, "providerID"),
			directory: c.req.query("directory"),
			method: body.method,
			code: body.code,
		});
		return sendResult(c, result);
	});

	return app;
}
