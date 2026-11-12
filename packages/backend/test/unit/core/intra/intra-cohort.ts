/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { buildCohortTable, findNearestIntake, getIntakeYearMonths } from '@/core/intra/intra-cohort.js';
import type { IntraCursusUserWithUser } from '@/core/intra/intra-cohort.js';

function users(poolYear: string | null, poolMonth: string | null, beginAt: string | null, count = 1): IntraCursusUserWithUser[] {
	return Array.from({ length: count }, () => ({ begin_at: beginAt, user: { pool_year: poolYear, pool_month: poolMonth } }));
}

describe('buildCohortTable', () => {
	test('ピシンごとに、42cursus を始めた人が最も多い月を入学時期にする', () => {
		// 42 Tokyo の 2023 年の実際の人数 (一部)
		expect(buildCohortTable([
			...users('2023', 'april', '2023-05-16T00:00:00.000Z', 32),
			...users('2023', 'august', '2023-09-19T00:00:00.000Z', 88),
			...users('2023', 'august', '2024-04-15T00:00:00.000Z', 4),
		])).toEqual([
			{ poolYearMonth: '2304', cohortYearMonth: '2305', userCount: 32 },
			{ poolYearMonth: '2308', cohortYearMonth: '2309', userCount: 88 },
		]);
	});

	test('月は日本時間で決める', () => {
		// 日本時間では 2024-04-01
		expect(buildCohortTable(users('2024', 'february', '2024-03-31T15:00:00.000Z', 3))).toEqual([
			{ poolYearMonth: '2402', cohortYearMonth: '2404', userCount: 3 },
		]);
	});

	test('人数が同じ月があれば早い月にする', () => {
		expect(buildCohortTable([
			...users('2021', 'december', '2022-10-04T00:00:00.000Z', 4),
			...users('2021', 'december', '2022-07-05T00:00:00.000Z', 4),
			...users('2021', 'december', '2022-04-05T00:00:00.000Z', 3),
		])).toEqual([
			{ poolYearMonth: '2112', cohortYearMonth: '2207', userCount: 4 },
		]);
	});

	test('ピシンより前に始めた人は数えない', () => {
		expect(buildCohortTable([
			...users('2023', 'march', '2022-01-04T00:00:00.000Z', 5),
			...users('2023', 'march', '2023-05-16T00:00:00.000Z', 3),
		])).toEqual([
			{ poolYearMonth: '2303', cohortYearMonth: '2305', userCount: 3 },
		]);
	});

	test('最も多い月が 3 人未満で半分以下なら決めない', () => {
		expect(buildCohortTable([
			...users('2017', 'july', '2026-04-27T00:00:00.000Z', 2),
			...users('2017', 'july', '2025-09-01T00:00:00.000Z'),
			...users('2017', 'july', '2025-05-13T00:00:00.000Z'),
		])).toEqual([]);
	});

	test('1 人だけのピシンはその人の月にする', () => {
		expect(buildCohortTable(users('2019', 'september', '2019-11-04T00:00:00.000Z'))).toEqual([
			{ poolYearMonth: '1909', cohortYearMonth: '1911', userCount: 1 },
		]);
	});

	test('ピシンの年月や開始日時が無い人は数えない', () => {
		expect(buildCohortTable([
			...users(null, null, '2025-05-19T00:00:00.000Z', 3),
			...users('2025', 'march', null, 3),
		])).toEqual([]);
	});
});

describe('getIntakeYearMonths', () => {
	test('3 人以上が入学した月だけを、重なりを除いて並べる', () => {
		expect(getIntakeYearMonths([
			{ cohortYearMonth: '2309', userCount: 88 },
			{ cohortYearMonth: '2305', userCount: 61 },
			{ cohortYearMonth: '2305', userCount: 26 },
			{ cohortYearMonth: '2211', userCount: 1 },
		])).toEqual(['2305', '2309']);
	});
});

describe('findNearestIntake', () => {
	const intakes = ['2210', '2301', '2305', '2309', '2404', '2410'];

	test.each([
		// 普通に入学した人
		['2023-05-16T00:00:00.000Z', '2305'],
		// 高校生などで、同じピシンの人より後に入学した人
		['2024-04-15T00:00:00.000Z', '2404'],
		// 入学の月から少しずれて始めた人
		['2023-04-26T00:00:00.000Z', '2305'],
		['2024-02-14T00:00:00.000Z', '2404'],
		['2023-11-13T00:00:00.000Z', '2309'],
		// 同じだけ離れていれば早い月 (2023-07 は 2305 と 2309 の真ん中)
		['2023-07-21T00:00:00.000Z', '2305'],
	])('%s → %s', (beginAt, expected) => {
		expect(findNearestIntake(new Date(beginAt), intakes)).toBe(expected);
	});

	test('月は日本時間で決める', () => {
		// 日本時間では 2024-10-01
		expect(findNearestIntake(new Date('2024-09-30T15:00:00.000Z'), ['2404', '2410'])).toBe('2410');
	});

	test('3 か月より離れているか、入学の月が無ければ null', () => {
		expect(findNearestIntake(new Date('2016-11-02T00:00:00.000Z'), intakes)).toBeNull();
		expect(findNearestIntake(new Date('2023-05-16T00:00:00.000Z'), [])).toBeNull();
		expect(findNearestIntake(new Date('invalid'), intakes)).toBeNull();
	});
});
