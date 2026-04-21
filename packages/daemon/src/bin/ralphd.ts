import app from "../cli";

export { app };

if (import.meta.main) {
	await app.execute();
}
