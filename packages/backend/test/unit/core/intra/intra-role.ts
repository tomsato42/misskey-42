/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { diffIntraRoleAssignments, getIntraRoleTargets } from '@/core/intra/intra-role.js';

describe('getIntraRoleTargets', () => {
	test('レベルとキャンパスのロール条件を返す', () => {
		expect(getIntraRoleTargets({ level: 5, campus: { id: 26, name: 'Tokyo' } })).toEqual([
			{ kind: 'level', key: '5', name: 'Lv.5' },
			{ kind: 'campus', key: '26', name: 'Tokyo' },
		]);
	});

	test('レベル 0 も対象にする', () => {
		expect(getIntraRoleTargets({ level: 0, campus: null })).toEqual([
			{ kind: 'level', key: '0', name: 'Lv.0' },
		]);
	});

	test('レベルもキャンパスも無ければ空', () => {
		expect(getIntraRoleTargets({ level: null, campus: null })).toEqual([]);
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
