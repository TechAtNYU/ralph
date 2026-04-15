import { daemon } from "@techatnyu/ralphd";
import { useCallback, useRef, useState } from "react";

interface UsePlanInstanceReturn {
	instanceId: string | null;
	loading: boolean;
	error: string | undefined;
	ensure: () => Promise<string>;
}

export function usePlanInstance(): UsePlanInstanceReturn {
	const [instanceId, setInstanceId] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string>();
	const resolving = useRef<Promise<string> | null>(null);

	const ensure = useCallback(async (): Promise<string> => {
		if (instanceId) return instanceId;
		if (resolving.current) return resolving.current;

		const resolve = async (): Promise<string> => {
			setLoading(true);
			setError(undefined);
			try {
				const cwd = process.cwd();
				const { instances } = await daemon.listInstances();
				const existing = instances.find((i) => i.directory === cwd);
				if (existing) {
					setInstanceId(existing.id);
					return existing.id;
				}

				const { instance } = await daemon.createInstance({
					name: "plan",
					directory: cwd,
				});
				setInstanceId(instance.id);
				return instance.id;
			} catch (e) {
				const msg =
					e instanceof Error ? e.message : "Failed to resolve instance";
				setError(msg);
				throw new Error(msg);
			} finally {
				setLoading(false);
				resolving.current = null;
			}
		};

		resolving.current = resolve();
		return resolving.current;
	}, [instanceId]);

	return { instanceId, loading, error, ensure };
}
