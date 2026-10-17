/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import {
	buildIntraUsername,
	extractIntraProfile,
	isEligible,
	parsePoolYearMonth,
} from '@/core/intra/intra-user.js';
import type { IntraUser } from '@/core/intra/intra-user.js';

const CURSUS_42 = 21;
const CURSUS_PISCINE = 9;

function createUser(overrides: Partial<IntraUser> = {}): IntraUser {
	return {
		id: 123456,
		login: 'tomoki',
		pool_year: '2023',
		pool_month: 'july',
		'staff?': false,
		created_at: '2023-05-10T03:00:00.000Z',
		cursus_users: [
			{ cursus_id: CURSUS_PISCINE, level: 8.5, blackholed_at: null, begin_at: '2023-07-03T01:00:00.000Z', end_at: '2023-07-28T09:00:00.000Z' },
			{ cursus_id: CURSUS_42, level: 5.73, blackholed_at: '2025-03-01T00:00:00.000Z', begin_at: '2023-10-02T01:00:00.000Z', end_at: null },
		],
		campus: [
			{ id: 1, name: 'Paris' },
			{ id: 26, name: 'Tokyo' },
		],
		campus_users: [
			{ campus_id: 1, is_primary: false },
			{ campus_id: 26, is_primary: true },
		],
		...overrides,
	};
}

describe('parsePoolYearMonth', () => {
	test('英語の月名', () => {
		expect(parsePoolYearMonth('2023', 'july')).toBe('2307');
		expect(parsePoolYearMonth('2024', 'February')).toBe('2402');
		expect(parsePoolYearMonth('2019', 'SEPTEMBER')).toBe('1909');
	});

	test('月名の略記', () => {
		expect(parsePoolYearMonth('2023', 'jul')).toBe('2307');
		expect(parsePoolYearMonth('2023', 'Sept')).toBe('2309');
	});

	test('数字の月', () => {
		expect(parsePoolYearMonth('2023', '7')).toBe('2307');
		expect(parsePoolYearMonth('2023', '07')).toBe('2307');
		expect(parsePoolYearMonth('2023', '12')).toBe('2312');
	});

	test('前後の空白は無視する', () => {
		expect(parsePoolYearMonth(' 2023 ', ' july ')).toBe('2307');
	});

	test('解釈できない値は null', () => {
		expect(parsePoolYearMonth(null, 'july')).toBeNull();
		expect(parsePoolYearMonth('2023', null)).toBeNull();
		expect(parsePoolYearMonth(undefined, undefined)).toBeNull();
		expect(parsePoolYearMonth('23', 'july')).toBeNull();
		expect(parsePoolYearMonth('2023', '13')).toBeNull();
		expect(parsePoolYearMonth('2023', '0')).toBeNull();
		expect(parsePoolYearMonth('2023', 'ju')).toBeNull();
		expect(parsePoolYearMonth('2023', 'foo')).toBeNull();
		expect(parsePoolYearMonth('', '')).toBeNull();
	});
});

describe('buildIntraUsername', () => {
	test('login_YYMM', () => {
		expect(buildIntraUsername('tomoki', '2307', '2023-05-10T03:00:00.000Z')).toBe('tomoki_2307');
	});

	test('ピシンの年月が無ければ intra の作成年月 (UTC) で代用する', () => {
		expect(buildIntraUsername('staffer', null, '2019-11-30T23:59:59.000Z')).toBe('staffer_1911');
		expect(buildIntraUsername('staffer', null, new Date('2021-01-01T00:00:00.000Z'))).toBe('staffer_2101');
	});

	test('\\w 以外の文字は _ に置き換える', () => {
		expect(buildIntraUsername('jean-luc', '2307', '2023-05-10T03:00:00.000Z')).toBe('jean_luc_2307');
		expect(buildIntraUsername('a.b c', '2307', '2023-05-10T03:00:00.000Z')).toBe('a_b_c_2307');
	});

	test('20 文字に収まるよう login 部分を切り詰める', () => {
		const username = buildIntraUsername('averyveryverylonglogin', '2307', '2023-05-10T03:00:00.000Z');
		expect(username).toBe('averyveryverylo_2307');
		expect(username.length).toBe(20);
		expect(username).toMatch(/^\w{1,20}$/);
	});

	test('ちょうど 15 文字の login は切り詰めない', () => {
		expect(buildIntraUsername('abcdefghijklmno', '2307', '2023-05-10T03:00:00.000Z')).toBe('abcdefghijklmno_2307');
	});

	test('作成日時が不正なら例外', () => {
		expect(() => buildIntraUsername('tomoki', null, 'invalid')).toThrow();
	});
});

describe('isEligible', () => {
	test('対象 cursus に在籍していれば許可', () => {
		expect(isEligible(createUser(), CURSUS_42)).toBe(true);
	});

	test('ピシンの cursus しか無ければ不許可', () => {
		const user = createUser({
			cursus_users: [
				{ cursus_id: CURSUS_PISCINE, level: 8.5, blackholed_at: null, begin_at: '2023-07-03T01:00:00.000Z', end_at: '2023-07-28T09:00:00.000Z' },
			],
		});
		expect(isEligible(user, CURSUS_42)).toBe(false);
	});

	test('スタッフは cursus に在籍していなくても許可', () => {
		const user = createUser({ 'staff?': true, cursus_users: [] });
		expect(isEligible(user, CURSUS_42)).toBe(true);
	});
});

describe('extractIntraProfile', () => {
	test('必要な情報を取り出す', () => {
		expect(extractIntraProfile(createUser(), CURSUS_42)).toEqual({
			intraId: 123456,
			login: 'tomoki',
			poolYearMonth: '2307',
			blackholedAt: new Date('2025-03-01T00:00:00.000Z'),
			paceDeadlineAt: null,
			level: 5,
			campus: { id: 26, name: 'Tokyo' },
		});
	});

	test('対象 cursus に在籍していなければ level と BH は null', () => {
		const profile = extractIntraProfile(createUser({ 'staff?': true, cursus_users: [] }), CURSUS_42);
		expect(profile.level).toBeNull();
		expect(profile.blackholedAt).toBeNull();
	});

	test('対象 cursus の cursus_user が複数あれば begin_at が新しいものを使う', () => {
		const user = createUser({
			cursus_users: [
				{ cursus_id: CURSUS_42, level: 2.1, blackholed_at: '2021-01-01T00:00:00.000Z', begin_at: '2020-01-01T00:00:00.000Z', end_at: '2021-01-01T00:00:00.000Z' },
				{ cursus_id: CURSUS_42, level: 7.9, blackholed_at: null, begin_at: '2023-01-01T00:00:00.000Z', end_at: null },
			],
		});
		const profile = extractIntraProfile(user, CURSUS_42);
		expect(profile.level).toBe(7);
		expect(profile.blackholedAt).toBeNull();
	});

	test('is_primary のキャンパスが無ければ campus の先頭を使う', () => {
		const user = createUser({ campus_users: [] });
		expect(extractIntraProfile(user, CURSUS_42).campus).toEqual({ id: 1, name: 'Paris' });
	});

	test('キャンパスが無ければ null', () => {
		const user = createUser({ campus: [], campus_users: [] });
		expect(extractIntraProfile(user, CURSUS_42).campus).toBeNull();
	});

	test('ピシンの年月が無ければ null', () => {
		const user = createUser({ pool_year: null, pool_month: null });
		expect(extractIntraProfile(user, CURSUS_42).poolYearMonth).toBeNull();
	});

	test('ペース期日は API の項目が未確認のため常に null', () => {
		expect(extractIntraProfile(createUser(), CURSUS_42).paceDeadlineAt).toBeNull();
	});
});
