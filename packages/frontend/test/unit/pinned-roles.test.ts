/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { addPinnedRole, findCohortRole, removePinnedRole, replaceCohortRole } from '@/utility/pinned-roles.js';

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

describe('replaceCohortRole', () => {
	const next = { id: 'c2305', name: 'Cursus 23/05' };

	test('前に足したロールを、同じ位置で新しいロールに差し替える', () => {
		const roles = [{ id: 'a', name: 'A' }, { id: 'c2304', name: 'Cursus 23/04' }, { id: 'b', name: 'B' }];
		expect(replaceCohortRole(roles, 'c2304', next)).toEqual([{ id: 'a', name: 'A' }, next, { id: 'b', name: 'B' }]);
	});

	test('前に足したロールを外していれば、元の配列をそのまま返す', () => {
		const roles = [{ id: 'a', name: 'A' }];
		expect(replaceCohortRole(roles, 'c2304', next)).toBe(roles);
	});

	test('新しいロールがすでにあれば、古いロールを外すだけ', () => {
		const roles = [{ id: 'c2304', name: 'Cursus 23/04' }, next];
		expect(replaceCohortRole(roles, 'c2304', next)).toEqual([next]);
	});

	test('ID を覚えていなければ、名前が入学時期のロールの形のものを差し替える', () => {
		const roles = [{ id: 'c2304', name: 'Cursus 23/04' }, { id: 'p', name: 'Piscine 23/03' }];
		expect(replaceCohortRole(roles, null, next)).toEqual([next, { id: 'p', name: 'Piscine 23/03' }]);
	});

	test('ID を覚えていなくて、入学時期のロールの形のものが複数あるか新しいロールがすでにあれば、何もしない', () => {
		const roles = [{ id: 'c2210', name: 'Cursus 22/10' }, { id: 'c2304', name: 'Cursus 23/04' }];
		expect(replaceCohortRole(roles, null, next)).toBe(roles);
		const pinned = [{ id: 'c2210', name: 'Cursus 22/10' }, next];
		expect(replaceCohortRole(pinned, null, next)).toBe(pinned);
	});

	test('ID を覚えていれば、ほかの入学時期のロールには触れない', () => {
		const roles = [{ id: 'c2210', name: 'Cursus 22/10' }, { id: 'c2304', name: 'Cursus 23/04' }];
		expect(replaceCohortRole(roles, 'c2304', next)).toEqual([{ id: 'c2210', name: 'Cursus 22/10' }, next]);
	});
});
