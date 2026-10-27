/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { findUserCoalition, toCoalitionRoleColor } from '@/core/intra/intra-coalition.js';
import type { IntraBloc } from '@/core/intra/intra-coalition.js';

const TOKYO = 26;
const CURSUS_42 = 21;
const PISCINE = 9;

const BLOCS: IntraBloc[] = [
	{ id: 1, campus_id: TOKYO, cursus_id: CURSUS_42, coalitions: [{ id: 301, name: 'Fuji', color: '#FF6950' }, { id: 302, name: 'Kaze', color: '#4180DB' }] },
	{ id: 2, campus_id: TOKYO, cursus_id: PISCINE, coalitions: [{ id: 401, name: 'Piscine A', color: '#000000' }] },
	{ id: 3, campus_id: 1, cursus_id: CURSUS_42, coalitions: [{ id: 501, name: 'Paris A', color: '#111111' }] },
];

describe('findUserCoalition', () => {
	test('キャンパス・cursus の bloc のコアリションのうち、所属しているものを返す', () => {
		expect(findUserCoalition(BLOCS, TOKYO, CURSUS_42, [
			{ coalition_id: 401, created_at: '2023-07-01T00:00:00.000Z' },
			{ coalition_id: 302, created_at: '2023-10-02T00:00:00.000Z' },
		])).toEqual({ id: 302, name: 'Kaze', color: '#4180DB' });
	});

	test('ほかの bloc のコアリションしか無ければ null', () => {
		expect(findUserCoalition(BLOCS, TOKYO, CURSUS_42, [
			{ coalition_id: 401, created_at: '2023-07-01T00:00:00.000Z' },
			{ coalition_id: 501, created_at: '2023-07-01T00:00:00.000Z' },
		])).toBeNull();
		expect(findUserCoalition(BLOCS, TOKYO, CURSUS_42, [])).toBeNull();
	});

	test('複数あれば最も新しく所属したものを返す', () => {
		expect(findUserCoalition(BLOCS, TOKYO, CURSUS_42, [
			{ coalition_id: 302, created_at: '2024-01-01T00:00:00.000Z' },
			{ coalition_id: 301, created_at: '2023-10-02T00:00:00.000Z' },
			{ coalition_id: 301, created_at: null },
		])?.name).toBe('Kaze');
	});
});

describe('toCoalitionRoleColor', () => {
	test('#RRGGBB だけを色にする', () => {
		expect(toCoalitionRoleColor('#ff6950')).toBe('#ff6950');
		expect(toCoalitionRoleColor('#fff')).toBeNull();
		expect(toCoalitionRoleColor('')).toBeNull();
		expect(toCoalitionRoleColor(null)).toBeNull();
		expect(toCoalitionRoleColor(undefined)).toBeNull();
	});
});
