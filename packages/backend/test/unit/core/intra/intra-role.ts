/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import {
	diffIntraRoleAssignments,
	formatYearMonth,
	getCohortRoleTarget,
	getIntraRoleIconUrl,
	getIntraRoleTargets,
	getPoolRoleTarget,
	poolToCohortYearMonth,
	toCohortYearMonth,
} from '@/core/intra/intra-role.js';

const EMPTY_PROFILE = { level: null, campus: null, poolYearMonth: null, poolNameYearMonth: null, cursusBeginAt: null };

describe('getIntraRoleTargets', () => {
	test('レベル・キャンパス・ピシン・入学時期のロール条件を返す', () => {
		expect(getIntraRoleTargets({
			level: 5,
			campus: { id: 26, name: 'Tokyo' },
			poolYearMonth: '2408',
			poolNameYearMonth: '2408',
			cursusBeginAt: new Date('2024-10-01T00:00:00.000Z'),
		})).toEqual([
			{ kind: 'level', key: '5', name: 'Lv.5' },
			{ kind: 'campus', key: '26', name: 'Tokyo' },
			{ kind: 'pool', key: '2408', name: 'Piscine 24/08' },
			{ kind: 'cohort', key: '2410', name: 'Cursus 24/10' },
		]);
	});

	test('レベル 0 も対象にする', () => {
		expect(getIntraRoleTargets({ ...EMPTY_PROFILE, level: 0 })).toEqual([
			{ kind: 'level', key: '0', name: 'Lv.0' },
		]);
	});

	test('どの情報も無ければ空', () => {
		expect(getIntraRoleTargets(EMPTY_PROFILE)).toEqual([]);
	});

	test('ピシンの年月が無ければピシンのロールを含めない', () => {
		expect(getIntraRoleTargets({ ...EMPTY_PROFILE, cursusBeginAt: new Date('2025-02-03T00:00:00.000Z') })).toEqual([
			{ kind: 'cohort', key: '2504', name: 'Cursus 25/04' },
		]);
	});

	test('ピシンのロールは実際の期間の年月、入学時期は名称の年月から決める', () => {
		expect(getIntraRoleTargets({
			...EMPTY_PROFILE,
			poolYearMonth: '2404',
			poolNameYearMonth: '2405',
			cursusBeginAt: new Date('2024-06-01T00:00:00.000Z'),
		})).toEqual([
			{ kind: 'pool', key: '2404', name: 'Piscine 24/04' },
			{ kind: 'cohort', key: '2410', name: 'Cursus 24/10' },
		]);
	});

	test('42cursus の開始日時が無ければ入学時期のロールを含めない', () => {
		expect(getIntraRoleTargets({ ...EMPTY_PROFILE, poolYearMonth: '2307', poolNameYearMonth: '2307' })).toEqual([
			{ kind: 'pool', key: '2307', name: 'Piscine 23/07' },
		]);
	});

	test('コアリションに所属していればコアリションのロール条件を最後に含め、色を付ける', () => {
		expect(getIntraRoleTargets({ ...EMPTY_PROFILE, level: 3 }, null, { id: 301, name: 'Fuji', color: '#FF6950' })).toEqual([
			{ kind: 'level', key: '3', name: 'Lv.3' },
			{ kind: 'coalition', key: '301', name: 'Fuji', color: '#FF6950' },
		]);
	});

	test('コアリションの色が #RRGGBB でなければ色を付けない', () => {
		expect(getIntraRoleTargets(EMPTY_PROFILE, null, { id: 302, name: 'Kaze', color: 'red' })).toEqual([
			{ kind: 'coalition', key: '302', name: 'Kaze', color: null },
		]);
	});
});

describe('formatYearMonth', () => {
	test('YYMM を YY/MM にする', () => {
		expect(formatYearMonth('2408')).toBe('24/08');
		expect(formatYearMonth('0012')).toBe('00/12');
	});

	test('YYMM 形式でなければ null', () => {
		expect(formatYearMonth('')).toBeNull();
		expect(formatYearMonth('240')).toBeNull();
		expect(formatYearMonth('24080')).toBeNull();
		expect(formatYearMonth('2400')).toBeNull();
		expect(formatYearMonth('2413')).toBeNull();
		expect(formatYearMonth('24/8')).toBeNull();
	});
});

describe('toCohortYearMonth', () => {
	// 日本時間の月の中ほど (15 日の正午) で、丸め方を確認する
	const jst = (year: number, month: number) => new Date(`${year}-${String(month).padStart(2, '0')}-15T12:00:00+09:00`);

	test.each([
		[2024, 8, '2410'],
		[2024, 9, '2410'],
		[2024, 10, '2410'],
		[2024, 11, '2504'],
		[2024, 12, '2504'],
		[2025, 1, '2504'],
		[2025, 2, '2504'],
		[2025, 4, '2504'],
		[2025, 5, '2510'],
	])('%i 年 %i 月 → %s', (year, month, expected) => {
		expect(toCohortYearMonth(jst(year, month))).toBe(expected);
	});

	test('すべての月を 4 月か 10 月にまとめる', () => {
		const results = Array.from({ length: 12 }, (_, i) => toCohortYearMonth(jst(2024, i + 1)));
		expect(results).toEqual(['2404', '2404', '2404', '2404', '2410', '2410', '2410', '2410', '2410', '2410', '2504', '2504']);
	});

	test('月の境目は日本時間で判定する', () => {
		// UTC では 10 月 31 日だが、日本時間では 11 月 1 日
		expect(toCohortYearMonth(new Date('2024-10-31T15:00:00.000Z'))).toBe('2504');
		// 日本時間でも 10 月 31 日
		expect(toCohortYearMonth(new Date('2024-10-31T14:59:59.999Z'))).toBe('2410');
		// UTC では 4 月 30 日だが、日本時間では 5 月 1 日
		expect(toCohortYearMonth(new Date('2025-04-30T15:00:00.000Z'))).toBe('2510');
		// UTC では 12 月 31 日だが、日本時間では翌年 1 月 1 日
		expect(toCohortYearMonth(new Date('2024-12-31T15:00:00.000Z'))).toBe('2504');
	});

	test('不正な日時なら null', () => {
		expect(toCohortYearMonth(new Date('invalid'))).toBeNull();
	});
});

describe('getPoolRoleTarget', () => {
	test('ピシンの年月からロール名と key を作る', () => {
		expect(getPoolRoleTarget('2408')).toEqual({ kind: 'pool', key: '2408', name: 'Piscine 24/08' });
	});

	test('ピシンの年月が無いか不正なら null', () => {
		expect(getPoolRoleTarget(null)).toBeNull();
		expect(getPoolRoleTarget('2413')).toBeNull();
	});
});

describe('getCohortRoleTarget', () => {
	test.each([
		['2024-08-05T00:00:00.000Z', '2410', 'Cursus 24/10'],
		['2024-09-30T00:00:00.000Z', '2410', 'Cursus 24/10'],
		['2024-10-01T00:00:00.000Z', '2410', 'Cursus 24/10'],
		['2024-11-04T00:00:00.000Z', '2504', 'Cursus 25/04'],
		['2025-02-03T00:00:00.000Z', '2504', 'Cursus 25/04'],
		['2025-04-07T00:00:00.000Z', '2504', 'Cursus 25/04'],
		['2025-05-12T00:00:00.000Z', '2510', 'Cursus 25/10'],
	])('%s → %s', (beginAt, key, name) => {
		expect(getCohortRoleTarget(new Date(beginAt))).toEqual({ kind: 'cohort', key, name });
	});

	test('42cursus の開始日時が無いか不正なら null', () => {
		expect(getCohortRoleTarget(null)).toBeNull();
		expect(getCohortRoleTarget(new Date('invalid'))).toBeNull();
	});

	test.each([
		// 本番で 42cursus の開始日時から求めると 10 月期になっていた、3 月ピシンの例
		['2303', '2023-05-15T00:00:00.000Z', '2304'],
		['2403', '2024-05-13T00:00:00.000Z', '2404'],
		['2408', '2024-10-01T00:00:00.000Z', '2410'],
		['2409', '2024-10-01T00:00:00.000Z', '2410'],
		['2501', '2025-04-01T00:00:00.000Z', '2504'],
		['2602', '2026-04-01T00:00:00.000Z', '2604'],
		['2511', '2026-04-01T00:00:00.000Z', '2604'],
	])('ピシン %s があれば、42cursus の開始日時 (%s) ではなくピシンの年月から求める → %s', (pool, beginAt, key) => {
		expect(getCohortRoleTarget(new Date(beginAt), pool)).toEqual({ kind: 'cohort', key, name: `Cursus ${key.slice(0, 2)}/${key.slice(2)}` });
	});

	test('集計した入学時期があれば、ピシンの年月の丸めより優先する', () => {
		expect(getCohortRoleTarget(new Date('2023-05-16T00:00:00.000Z'), '2304', '2305')).toEqual({ kind: 'cohort', key: '2305', name: 'Cursus 23/05' });
		expect(getIntraRoleTargets({ ...EMPTY_PROFILE, poolNameYearMonth: '2304', cursusBeginAt: new Date('2023-05-16T00:00:00.000Z') }, '2305')).toEqual([
			{ kind: 'cohort', key: '2305', name: 'Cursus 23/05' },
		]);
	});

	test('集計した入学時期が YYMM 形式でなければ使わない', () => {
		expect(getCohortRoleTarget(new Date('2023-05-16T00:00:00.000Z'), '2304', '2313')).toEqual({ kind: 'cohort', key: '2304', name: 'Cursus 23/04' });
	});

	test('ピシンの年月があっても、42cursus に在籍していなければ null', () => {
		expect(getCohortRoleTarget(null, '2403')).toBeNull();
	});

	test('ピシンの年月が YYMM 形式でなければ、42cursus の開始日時から求める', () => {
		expect(getCohortRoleTarget(new Date('2024-05-13T00:00:00.000Z'), '2413')).toEqual({ kind: 'cohort', key: '2410', name: 'Cursus 24/10' });
	});
});

describe('poolToCohortYearMonth', () => {
	test('12 か月すべてを 4 月期と 10 月期にまとめる', () => {
		const results = Array.from({ length: 12 }, (_, i) => poolToCohortYearMonth(`24${String(i + 1).padStart(2, '0')}`));
		expect(results).toEqual(['2404', '2404', '2404', '2404', '2410', '2410', '2410', '2410', '2410', '2410', '2504', '2504']);
	});

	test('YYMM 形式でなければ null', () => {
		expect(poolToCohortYearMonth('2400')).toBeNull();
		expect(poolToCohortYearMonth('abc')).toBeNull();
	});
});

describe('diffIntraRoleAssignments', () => {
	test('付いていないロールを付与し、管理対象の不要なロールを解除する', () => {
		const result = diffIntraRoleAssignments(
			['lv4', 'lv5', 'tokyo', 'paris'],
			['lv5', 'tokyo'],
			['lv4', 'tokyo', 'manual'],
		);
		expect(result.toAssign).toEqual(['lv5']);
		expect(result.toUnassign).toEqual(['lv4']);
	});

	test('管理対象でないロールには触れない', () => {
		const result = diffIntraRoleAssignments(['lv5'], [], ['manual1', 'manual2']);
		expect(result).toEqual({ toAssign: [], toUnassign: [] });
	});

	test('付けるべきロールが無ければ、管理対象のロールをすべて解除する', () => {
		const result = diffIntraRoleAssignments(['lv4', 'lv5', 'tokyo'], [], ['lv4', 'tokyo', 'manual']);
		expect(result.toAssign).toEqual([]);
		expect(result.toUnassign).toEqual(['lv4', 'tokyo']);
	});

	test('すでに揃っていれば何もしない', () => {
		const result = diffIntraRoleAssignments(['lv5', 'tokyo'], ['lv5', 'tokyo'], ['tokyo', 'lv5']);
		expect(result).toEqual({ toAssign: [], toUnassign: [] });
	});

	test('重複した入力でも同じロールを二度扱わない', () => {
		const result = diffIntraRoleAssignments(['lv4', 'lv4'], ['lv5', 'lv5'], ['lv4', 'lv4']);
		expect(result).toEqual({ toAssign: ['lv5'], toUnassign: ['lv4'] });
	});
});

describe('getIntraRoleIconUrl', () => {
	const templates = { levelBadgeUrl: 'https://example.com/lv-{level}.svg', coalitionIconUrl: 'https://example.com/coalitions/{id}.svg' };

	test('レベルのロールは {level} を、コアリションのロールは {id} を置き換え、ほかの種類は null', () => {
		expect(getIntraRoleIconUrl({ kind: 'level', key: '10' }, templates)).toBe('https://example.com/lv-10.svg');
		expect(getIntraRoleIconUrl({ kind: 'coalition', key: '308' }, templates)).toBe('https://example.com/coalitions/308.svg');
		expect(getIntraRoleIconUrl({ kind: 'campus', key: '26' }, templates)).toBeNull();
		expect(getIntraRoleIconUrl({ kind: 'cohort', key: '2410' }, templates)).toBeNull();
	});

	test('ひな形が無ければ null', () => {
		expect(getIntraRoleIconUrl({ kind: 'level', key: '10' }, { levelBadgeUrl: null, coalitionIconUrl: null })).toBeNull();
		expect(getIntraRoleIconUrl({ kind: 'coalition', key: '308' }, { ...templates, coalitionIconUrl: null })).toBeNull();
	});
});
