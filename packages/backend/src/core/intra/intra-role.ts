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

/** 日本時間の UTC からのずれ。日本に夏時間は無いので固定値でよい */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** YYMM 形式 (月は 01〜12) */
const YEAR_MONTH_PATTERN = /^(\d{2})(0[1-9]|1[0-2])$/;

function toYearMonth(year: number, month: number): string {
	return `${String(year % 100).padStart(2, '0')}${String(month).padStart(2, '0')}`;
}

/**
 * YYMM を "YY/MM" に変える。YYMM 形式でなければ null
 */
export function formatYearMonth(yearMonth: string): string | null {
	const match = YEAR_MONTH_PATTERN.exec(yearMonth);
	return match == null ? null : `${match[1]}/${match[2]}`;
}

/**
 * 年月を入学時期 (YYMM) にまとめる。11〜4 月なら次の 4 月 (11・12 月は翌年、1〜4 月は同じ年)、5〜10 月なら同じ年の 10 月
 */
function roundToCohort(year: number, month: number): string {
	if (month >= 11) return toYearMonth(year + 1, 4);
	if (month <= 4) return toYearMonth(year, 4);
	return toYearMonth(year, 10);
}

/**
 * ピシンの年月 (YYMM) から、本科への入学時期 (YYMM) を求める。YYMM 形式でなければ null。
 * 例: ピシン 24/03 → 24/04、24/08・24/09 → 24/10
 */
export function poolToCohortYearMonth(poolYearMonth: string): string | null {
	const match = YEAR_MONTH_PATTERN.exec(poolYearMonth);
	if (match == null) return null;
	return roundToCohort(2000 + parseInt(match[1], 10), parseInt(match[2], 10));
}

/**
 * 42cursus の開始日時から、本科への入学時期 (YYMM) を求める (ピシンの年月が無い人向け)。
 * 開始日時を日本時間の年月にしてから入学時期にまとめる。日時が不正なら null
 */
export function toCohortYearMonth(beginAt: Date): string | null {
	const time = beginAt.getTime();
	if (isNaN(time)) return null;

	// UTC の値として読むと日本時間の年月になるよう、9 時間ずらす
	const jst = new Date(time + JST_OFFSET_MS);
	const year = jst.getUTCFullYear();
	const month = jst.getUTCMonth() + 1;

	return roundToCohort(year, month);
}

/**
 * ピシンの時期のロール条件。ピシンの年月が無いか YYMM 形式でなければ null
 */
export function getPoolRoleTarget(poolYearMonth: string | null): IntraRoleTarget | null {
	if (poolYearMonth == null) return null;
	const label = formatYearMonth(poolYearMonth);
	if (label == null) return null;
	return { kind: 'pool', key: poolYearMonth, name: `Piscine ${label}` };
}

/**
 * 本科への入学時期のロール条件。42cursus に在籍していなければ (開始日時が無ければ) null。
 * 入学時期はピシンの年月から求める (42cursus の開始日時は入学時期より後になることがあるため)。
 * ピシンの年月が無い人 (スタッフなど) だけ、42cursus の開始日時から求める
 */
export function getCohortRoleTarget(cursusBeginAt: Date | null, poolYearMonth: string | null = null): IntraRoleTarget | null {
	if (cursusBeginAt == null) return null;
	const fromPool = poolYearMonth != null ? poolToCohortYearMonth(poolYearMonth) : null;
	const yearMonth = fromPool ?? toCohortYearMonth(cursusBeginAt);
	if (yearMonth == null) return null;
	return { kind: 'cohort', key: yearMonth, name: `Cursus ${formatYearMonth(yearMonth)}` };
}

/** 先に作っておくレベルのロールの最大値 (42cursus の Common Core を終えるあたりまで) */
export const PRECREATED_MAX_LEVEL = 21;

/**
 * レベルのロール条件
 */
export function getLevelRoleTarget(level: number): IntraRoleTarget {
	return { kind: 'level', key: String(level), name: `Lv.${level}` };
}

/**
 * intra の情報から、ユーザーに付けるべきロールの条件を返す。
 * レベル・キャンパス・ピシンの年月・42cursus の開始日時のうち無いものは、その種類のロールを含めない
 */
export function getIntraRoleTargets(profile: Pick<IntraProfile, 'level' | 'campus' | 'poolYearMonth' | 'cursusBeginAt'>): IntraRoleTarget[] {
	const targets: IntraRoleTarget[] = [];

	if (profile.level != null) {
		targets.push(getLevelRoleTarget(profile.level));
	}

	if (profile.campus != null) {
		targets.push({ kind: 'campus', key: String(profile.campus.id), name: profile.campus.name });
	}

	const pool = getPoolRoleTarget(profile.poolYearMonth);
	if (pool != null) targets.push(pool);

	const cohort = getCohortRoleTarget(profile.cursusBeginAt, profile.poolYearMonth);
	if (cohort != null) targets.push(cohort);

	return targets;
}

/**
 * ロールのアイコンの URL。レベルのロールで、ひな形 (config.intra.levelBadgeUrl) があるときだけ返す
 */
export function getIntraRoleIconUrl(target: Pick<IntraRoleTarget, 'kind' | 'key'>, template: string | null): string | null {
	if (template == null || target.kind !== 'level') return null;
	return template.replaceAll('{level}', target.key);
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
