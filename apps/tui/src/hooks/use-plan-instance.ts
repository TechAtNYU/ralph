import { daemon } from "@techatnyu/ralphd";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	createProjectSlug,
	ensureProjectStore,
	resolveProjectRoot,
} from "../lib/project-store";

export interface PlanInstanceHandle {
	instanceId: string;
	scaffoldPath: string;
	projectRoot: string;
	projectSlug: string;
}

interface UsePlanInstanceReturn {
	instanceId: string | null;
	scaffoldPath: string | null;
	projectRoot: string | null;
	projectSlug: string | null;
	loading: boolean;
	error: string | undefined;
	ensure: () => Promise<PlanInstanceHandle>;
}

export function usePlanInstance(): UsePlanInstanceReturn {
	const [instanceId, setInstanceId] = useState<string | null>(null);
	const [scaffoldPath, setScaffoldPath] = useState<string | null>(null);
	const [projectRoot, setProjectRoot] = useState<string | null>(null);
	const [projectSlug, setProjectSlug] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string>();
	const resolving = useRef<Promise<PlanInstanceHandle> | null>(null);

	const ensure = useCallback(async (): Promise<PlanInstanceHandle> => {
		if (instanceId && scaffoldPath && projectRoot && projectSlug) {
			return { instanceId, scaffoldPath, projectRoot, projectSlug };
		}
		if (resolving.current) return resolving.current;

		const resolve = async (): Promise<PlanInstanceHandle> => {
			setLoading(true);
			setError(undefined);
			try {
				const root = await resolveProjectRoot(process.cwd());
				const slug = createProjectSlug(root);
				const { instances } = await daemon.listInstances();
				const existing = instances.find((i) => i.directory === root);
				const id = existing
					? existing.id
					: (await daemon.createInstance({ name: slug, directory: root }))
							.instance.id;

				const store = await ensureProjectStore({
					projectRoot: root,
					legacyInstanceId: id,
				});
				setInstanceId(id);
				setScaffoldPath(store.storeDir);
				setProjectRoot(store.projectRoot);
				setProjectSlug(store.slug);
				return {
					instanceId: id,
					scaffoldPath: store.storeDir,
					projectRoot: store.projectRoot,
					projectSlug: store.slug,
				};
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
	}, [instanceId, scaffoldPath, projectRoot, projectSlug]);

	useEffect(() => {
		void ensure().catch(() => {
			// The error state is set inside ensure; callers can retry explicitly.
		});
	}, [ensure]);

	return {
		instanceId,
		scaffoldPath,
		projectRoot,
		projectSlug,
		loading,
		error,
		ensure,
	};
}
