/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42 のコアリション (キャンパスの cursus ごとのチーム) を扱う純粋関数群。
// DI に依存しないので、ユニットテストから直接呼び出せる。

/**
 * 42 API の coalition (使う項目だけ)
 */
export type IntraCoalition = {
	id: number;
	name: string;
	/** 例: "#FF6950"。無い場合がある */
	color?: string | null;
};

/**
 * 42 API の GET /v2/blocs の要素 (使う項目だけ)。bloc はキャンパス・cursus ごとのコアリションのまとまり
 */
export type IntraBloc = {
	id: number;
	campus_id: number;
	cursus_id: number;
	coalitions: IntraCoalition[];
};

/**
 * 42 API の GET /v2/users/:id/coalitions_users の要素 (使う項目だけ)
 */
export type IntraCoalitionUser = {
	coalition_id: number;
	created_at: string | null;
};

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * ユーザーのコアリションを返す。キャンパス・cursus の bloc のコアリションのうち、ユーザーが所属しているもの。
 * ピシンのコアリションなど、ほかの bloc のものは使わない。
 * 複数あれば最も新しく所属したもの (移籍などで残っている場合のため)。無ければ null
 */
export function findUserCoalition(
	blocs: readonly IntraBloc[],
	campusId: number,
	cursusId: number,
	coalitionUsers: readonly IntraCoalitionUser[],
): IntraCoalition | null {
	const coalitions = new Map<number, IntraCoalition>();
	for (const bloc of blocs) {
		if (bloc.campus_id !== campusId || bloc.cursus_id !== cursusId) continue;
		for (const coalition of bloc.coalitions) coalitions.set(coalition.id, coalition);
	}

	let found: { coalition: IntraCoalition; joinedAt: number } | null = null;
	for (const coalitionUser of coalitionUsers) {
		const coalition = coalitions.get(coalitionUser.coalition_id);
		if (coalition == null) continue;
		const joinedAt = coalitionUser.created_at != null ? new Date(coalitionUser.created_at).getTime() : NaN;
		const time = isNaN(joinedAt) ? -Infinity : joinedAt;
		if (found == null || time > found.joinedAt) found = { coalition, joinedAt: time };
	}

	return found?.coalition ?? null;
}

/**
 * コアリションの色をロールの色 (#RRGGBB) にする。形式が違えば null
 */
export function toCoalitionRoleColor(color: string | null | undefined): string | null {
	return color != null && COLOR_PATTERN.test(color) ? color : null;
}
