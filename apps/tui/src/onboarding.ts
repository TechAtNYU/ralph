import { spawn } from "node:child_process";

type CommandResult = {
    exitCode: number;
    stdout: string;
    stderr: string;
    error?: Error;
};

async function runCommand(
    command: string,
    args: string[],
    options:{ inheritStdio?: boolean } = {},
): Promise<CommandResult> {
    return await new Promise((resolve) => {
        const child = spawn(command, args, {
            stdio: options.inheritStdio ? "inherit" : "pipe",
        });

        let stdout = "";
        let stderr = "";

        if (!options.inheritStdio) {
            child.stdout?.on("data", (chunk) => {
                stdout += chunk.toString();
            });

            child.stderr?.on("data", (chunk) => {
                stderr += chunk.toString();
            });
        }

        child.on("error", (error) => {
            resolve({
                exitCode: 1,
                stdout,
                stderr,
                error: error instanceof Error ? error : new Error(String(error)),
            });
        });

        child.on("close", (code) => {
            resolve({
                exitCode: code ?? 1,
                stdout,
                stderr,
            });
        });
    });
}

export async function isOpencodeInstalled(): Promise<boolean> {
    const result = await runCommand("opencode", ["--version"]);
    return !result.error && result.exitCode === 0;
}

export async function hasOpencodeAuth(): Promise<boolean> {
    const result = await runCommand("opencode", ["auth", "list"]);

    if (result.error || result.exitCode !== 0) {
        return false;
    }

    const output = `${result.stdout}\n${result.stderr}`.trim().toLowerCase();

    if (!output) {
        return false;
    }

    if (
        output.includes("no auth") || 
        output.includes("not logged in") ||
        output.includes("0 credentials")
    ) {
        return false;
    }

    return true;
}

export async function loginOpencode(): Promise<boolean> {
    const result = await runCommand(
        "opencode",
        ["auth", "login"],
        { inheritStdio: true },
    );

    return !result.error && result.exitCode === 0;
}

export type OnboardingResult = 
    | { ok: true }
    | { ok: false; message: string};

export async function ensureOpencodeReady(): Promise<OnboardingResult> {
    const installed = await isOpencodeInstalled();
    if (!installed) {
        return {
            ok: false,
            message: "`opencode` is not installed or not in PATH.",
        };
    }

    const authed = await hasOpencodeAuth();
    if (authed) {
        return { ok: true};
    }

    console.log("No OpenCode auth found. Starting `opencode auth login`...");
    const loggedIn = await loginOpencode();

    if (!loggedIn) {
        return {
            ok: false,
            message: "OpenCode login did not complete successfully.",
        };
    }

    const authedAfterLogin = await hasOpencodeAuth();
    if (!authedAfterLogin) {
        return {
            ok: false,
            message: "OpenCode login finished, but no auth was detected afterward.",
        };
    }

    return { ok: true };
}