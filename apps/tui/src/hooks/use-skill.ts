import { useCallback, useState } from "react";
import { type ActiveSkill, getSkill, type Skill } from "../skills";

interface UseSkillReturn {
	activeSkill: ActiveSkill;
	skill: Skill | undefined;
	startSkill: (id: "spec" | "prd") => Skill;
	clearSkill: () => void;
}

export function useSkill(): UseSkillReturn {
	const [activeSkill, setActiveSkill] = useState<ActiveSkill>(null);

	const skill = activeSkill ? getSkill(activeSkill) : undefined;

	const startSkill = useCallback((id: "spec" | "prd"): Skill => {
		const s = getSkill(id);
		if (!s) throw new Error(`Unknown skill: ${id}`);
		setActiveSkill(id);
		return s;
	}, []);

	const clearSkill = useCallback(() => {
		setActiveSkill(null);
	}, []);

	return { activeSkill, skill, startSkill, clearSkill };
}
