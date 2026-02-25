import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export async function pathExists(target: string): Promise<boolean> {
	try {
		await fs.access(target);
		return true;
	} catch {
		return false;
	}
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
	try {
		const raw = await fs.readFile(filePath, "utf8");
		return JSON.parse(raw) as T;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

export async function atomicWriteFile(filePath: string, contents: string) {
	const dir = path.dirname(filePath);
	const tmpName = `.tmp-${path.basename(filePath)}-${crypto.randomBytes(6).toString("hex")}`;
	const tmpPath = path.join(dir, tmpName);
	await fs.writeFile(tmpPath, contents, "utf8");
	await fs.rename(tmpPath, filePath);
}

export async function writeJsonFile(filePath: string, value: unknown) {
	const payload = `${JSON.stringify(value, null, 2)}\n`;
	await atomicWriteFile(filePath, payload);
}
