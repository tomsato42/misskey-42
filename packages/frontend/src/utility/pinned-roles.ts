/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// タイムラインのタブに出すロール (preferences の pinnedRoles) の操作

export type PinnedRole = {
	id: string;
	name: string;
};

/**
 * pinnedRoles にロールを足した新しい配列を返す。すでに入っていれば元の配列をそのまま返す
 */
export function addPinnedRole(roles: readonly PinnedRole[], role: PinnedRole): readonly PinnedRole[] {
	if (roles.some(r => r.id === role.id)) return roles;
	return [...roles, { id: role.id, name: role.name }];
}

/**
 * pinnedRoles からロールを外した新しい配列を返す
 */
export function removePinnedRole(roles: readonly PinnedRole[], roleId: string): readonly PinnedRole[] {
	return roles.filter(r => r.id !== roleId);
}

/**
 * i/intra-roles の結果から、入学時期 (cohort) のロールを返す。無ければ null
 */
export function findCohortRole(intraRoles: readonly { kind: string; roleId: string; name: string }[]): PinnedRole | null {
	const cohort = intraRoles.find(r => r.kind === 'cohort');
	return cohort != null ? { id: cohort.roleId, name: cohort.name } : null;
}
