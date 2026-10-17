/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42 intra の情報から付与するロールを決める純粋関数群。
// DI に依存しないので、ユニットテストから直接呼び出せる。

import type { IntraRoleKind } from '@/models/IntraRole.js';
import type { IntraProfile } from './intra-user.js';

/**
 * ユーザーに付けるべきロールの条件と、ロールを新しく作る場合の名前
 */
export type IntraRoleTarget = {
	kind: IntraRoleKind;
	/** intra_role.key と同じ形式 */
	key: string;
	/** ロールを作成するときだけ使う。既存のロールの名前は変えない */
	name: string;
};

/**
 * intra の情報から、ユーザーに付けるべきロールの条件を返す。
 * レベルやキャンパスが無ければ、その種類のロールは含めない
 */
export function getIntraRoleTargets(profile: Pick<IntraProfile, 'level' | 'campus'>): IntraRoleTarget[] {
	const targets: IntraRoleTarget[] = [];

	if (profile.level != null) {
		targets.push({ kind: 'level', key: String(profile.level), name: `Lv.${profile.level}` });
	}

	if (profile.campus != null) {
		targets.push({ kind: 'campus', key: String(profile.campus.id), name: profile.campus.name });
	}

	return targets;
}

/**
 * 付与・解除するロールを決める。
 * - 付けるべきロールのうち、まだ付いていないものを付与する
 * - intra_role で管理しているロールのうち、付いているが付けるべきでないものを解除する
 * - intra_role で管理していないロール (管理者が手動で作ったロールなど) には触れない
 * @param managedRoleIds intra_role で管理しているすべてのロールの ID
 * @param desiredRoleIds ユーザーに付けるべきロールの ID
 * @param assignedRoleIds ユーザーに現在付いている (期限切れでない) ロールの ID
 */
export function diffIntraRoleAssignments(
	managedRoleIds: Iterable<string>,
	desiredRoleIds: Iterable<string>,
	assignedRoleIds: Iterable<string>,
): { toAssign: string[]; toUnassign: string[] } {
	const managed = new Set(managedRoleIds);
	const desired = new Set(desiredRoleIds);
	const assigned = new Set(assignedRoleIds);

	return {
		toAssign: [...desired].filter(id => !assigned.has(id)),
		toUnassign: [...assigned].filter(id => managed.has(id) && !desired.has(id)),
	};
}
