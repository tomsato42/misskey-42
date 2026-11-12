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

/** 入学時期のロールの名前 (Cursus YY/MM)。前に足したロールの ID を覚えていない人の、古い入学時期のロールを見分ける */
const COHORT_ROLE_NAME = /^Cursus \d{2}\/\d{2}$/;

/**
 * 入学時期のロールが変わったとき、pinnedRoles の古い入学時期のロールを新しいロールに差し替えた新しい配列を返す。
 * 新しいロールは古いロールがあった位置に入れ、すでに入っていれば古いロールを外すだけにする。
 * 古いロールが入っていなければ (ユーザーが外していれば) 元の配列をそのまま返す
 * @param previousId 前に足した入学時期のロールの ID。覚えていなければ null で、名前が「Cursus YY/MM」のロールが 1 つだけあり、
 * 新しいロールが入っていないときだけそれを古いロールとみなす (自分でほかの入学時期のロールを足した人のロールを消さないため)
 */
export function replaceCohortRole(roles: readonly PinnedRole[], previousId: string | null, role: PinnedRole): readonly PinnedRole[] {
	const alreadyPinned = roles.some(r => r.id === role.id);

	let oldId = previousId;
	if (oldId == null) {
		const candidates = roles.filter(r => r.id !== role.id && COHORT_ROLE_NAME.test(r.name));
		if (candidates.length !== 1 || alreadyPinned) return roles;
		oldId = candidates[0].id;
	}

	const index = roles.findIndex(r => r.id === oldId);
	if (index === -1 || oldId === role.id) return roles;

	if (alreadyPinned) return roles.filter(r => r.id !== oldId);
	return roles.map((r, i) => i === index ? { id: role.id, name: role.name } : r);
}

/**
 * i/intra-roles の結果から、入学時期 (cohort) のロールを返す。無ければ null
 */
export function findCohortRole(intraRoles: readonly { kind: string; roleId: string; name: string }[]): PinnedRole | null {
	const cohort = intraRoles.find(r => r.kind === 'cohort');
	return cohort != null ? { id: cohort.roleId, name: cohort.name } : null;
}
