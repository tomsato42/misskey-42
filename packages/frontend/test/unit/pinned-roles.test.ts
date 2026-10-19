/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { addPinnedRole, findCohortRole, removePinnedRole } from '@/utility/pinned-roles.js';

describe('addPinnedRole', () => {
	test('末尾に足す', () => {
		const roles = [{ id: 'a', name: 'A' }];
		expect(addPinnedRole(roles, { id: 'b', name: 'B' })).toEqual([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
	});

	test('すでに入っていれば元の配列をそのまま返す', () => {
		const roles = [{ id: 'a', name: 'A' }];
		expect(addPinnedRole(roles, { id: 'a', name: 'A2' })).toBe(roles);
	});

	test('id と name 以外の項目は持たない', () => {
		const role = { id: 'a', name: 'A', color: '#fff', iconUrl: null };
		expect(addPinnedRole([], role)).toEqual([{ id: 'a', name: 'A' }]);
	});
});

describe('removePinnedRole', () => {
	test('指定したロールだけ外す', () => {
		const roles = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
		expect(removePinnedRole(roles, 'a')).toEqual([{ id: 'b', name: 'B' }]);
	});
});

describe('findCohortRole', () => {
	test('入学時期のロールを返す', () => {
		expect(findCohortRole([
			{ kind: 'level', roleId: 'l', name: 'Lv.3' },
			{ kind: 'cohort', roleId: 'c', name: 'Cursus 25/04' },
		])).toEqual({ id: 'c', name: 'Cursus 25/04' });
	});

	test('無ければ null', () => {
		expect(findCohortRole([{ kind: 'pool', roleId: 'p', name: 'Piscine 25/02' }])).toBeNull();
	});
});
