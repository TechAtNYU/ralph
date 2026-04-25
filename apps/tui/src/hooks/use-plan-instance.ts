import { daemon } from "@techatnyu/ralphd";
import { useCallback, useRef, useState } from "react";
import { bootstrapInstanceScaffold } from "../lib/scaffold";

export interface PlanInstanceHandle {
	instanceId: string;
	scaffoldPath: string;
}

interface UsePlanInstanceReturn {
	instanceId: string | null;
	scaffoldPath: string | null;
	loading: boolean;
	error: string | undefined;
	ensure: () => Promise<PlanInstanceHandle>;
}

export function usePlanInstance(): UsePlanInstanceReturn {
	const [instanceId, setInstanceId] = useState<string | null>(null);
	const [scaffoldPath, setScaffoldPath] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string>();
	const resolving = useRef<Promise<PlanInstanceHandle> | null>(null);

	const ensure = useCallback(async (): Promise<PlanInstanceHandle> => {
		if (instanceId && scaffoldPath) {
			return { instanceId, scaffoldPath };
		}
		if (resolving.current) return resolving.current;

		const resolve = async (): Promise<PlanInstanceHandle> => {
			setLoading(true);
			setError(undefined);
			try {
				const cwd = process.cwd();
				const { instances } = await daemon.listInstances();
				const existing = instances.find((i) => i.directory === cwd);
				const id = existing
					? existing.id
					: (await daemon.createInstance({ name: "plan", directory: cwd }))
							.instance.id;

				const path = await bootstrapInstanceScaffold({ instanceId: id });
				setInstanceId(id);
				setScaffoldPath(path);
				return { instanceId: id, scaffoldPath: path };
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
	}, [instanceId, scaffoldPath]);

	return { instanceId, scaffoldPath, loading, error, ensure };
}
