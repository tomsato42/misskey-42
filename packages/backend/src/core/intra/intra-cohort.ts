/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ピシンごとの本科 (42cursus) への入学時期を、キャンパスの 42cursus の在籍者から集計する純粋関数群。
// DI に依存しないので、ユニットテストから直接呼び出せる。

import { parsePoolYearMonth } from './intra-user.js';

/**
 * 42 API の GET /v2/cursus/:id/cursus_users の要素 (使う項目だけ)
 */
export type IntraCursusUserWithUser = {
	begin_at: string | null;
	user: {
		pool_year: string | null;
		pool_month: string | null;
	};
};

export type IntraCohortEntry = {
	/** intra の名称 (pool_year / pool_month) のピシンの年月 (YYMM) */
	poolYearMonth: string;
	/** 入学時期 (YYMM) */
	cohortYearMonth: string;
	/** 入学時期に 42cursus を始めた人数 */
	userCount: number;
};

/** 日本時間の UTC からのずれ。日本に夏時間は無いので固定値でよい */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 人数がこれ以上なら、半分に満たなくてもその月を入学時期にする */
const MIN_COHORT_USERS = 3;

function toJstYearMonth(value: string | null): string | null {
	if (value == null) return null;
	const time = new Date(value).getTime();
	if (isNaN(time)) return null;
	const jst = new Date(time + JST_OFFSET_MS);
	return `${String(jst.getUTCFullYear() % 100).padStart(2, '0')}${String(jst.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** YYMM を月の通し番号にする (前後を比べるため) */
function toMonthIndex(yearMonth: string): number {
	return parseInt(yearMonth.slice(0, 2), 10) * 12 + parseInt(yearMonth.slice(2), 10) - 1;
}

/**
 * ピシン (intra の名称の年月) ごとに、42cursus を始めた月 (日本時間) で最も人数の多い月を入学時期とする。
 * 入学の月は年によって違う (2021〜2022 年は 1・4・7・10 月、2023 年は 5・9 月、2024 年からは 4・10 月) ため、決まった月に丸めずに実際の人数から決める。
 * ピシンより前に始めた人 (テスト用のアカウントなど) は数えない。
 * 最も多い月の人数が MIN_COHORT_USERS 未満で、そのピシンの人の半分以下なら決めない (ばらばらで当てにならないため)。
 * 人数が同じ月があれば早い月にする
 */
export function buildCohortTable(cursusUsers: readonly IntraCursusUserWithUser[]): IntraCohortEntry[] {
	const counts = new Map<string, Map<string, number>>();
	for (const cu of cursusUsers) {
		const pool = parsePoolYearMonth(cu.user?.pool_year, cu.user?.pool_month);
		if (pool == null) continue;
		const begin = toJstYearMonth(cu.begin_at);
		if (begin == null || toMonthIndex(begin) < toMonthIndex(pool)) continue;

		const byMonth = counts.get(pool) ?? new Map<string, number>();
		byMonth.set(begin, (byMonth.get(begin) ?? 0) + 1);
		counts.set(pool, byMonth);
	}

	const entries: IntraCohortEntry[] = [];
	for (const [pool, byMonth] of counts) {
		let total = 0;
		let best: { yearMonth: string; count: number } | null = null;
		for (const [yearMonth, count] of byMonth) {
			total += count;
			if (best == null || count > best.count || (count === best.count && toMonthIndex(yearMonth) < toMonthIndex(best.yearMonth))) {
				best = { yearMonth, count };
			}
		}
		if (best == null) continue;
		if (best.count < MIN_COHORT_USERS && best.count * 2 <= total) continue;
		entries.push({ poolYearMonth: pool, cohortYearMonth: best.yearMonth, userCount: best.count });
	}

	return entries.sort((a, b) => a.poolYearMonth.localeCompare(b.poolYearMonth));
}
