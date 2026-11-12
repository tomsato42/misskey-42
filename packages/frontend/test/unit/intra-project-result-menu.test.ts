/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { addProjectShareToMenu } from '@/utility/intra-project-result-menu.js';

describe('addProjectShareToMenu', () => {
	test('ペア募集の直後に足す', () => {
		expect(addProjectShareToMenu(['notifications', 'pair', '-', 'ui'])).toEqual(['notifications', 'pair', 'projectShare', '-', 'ui']);
	});

	test('ペア募集が無ければ最初の区切りの前、区切りも無ければ末尾に足す', () => {
		expect(addProjectShareToMenu(['notifications', '-', 'ui'])).toEqual(['notifications', 'projectShare', '-', 'ui']);
		expect(addProjectShareToMenu(['notifications'])).toEqual(['notifications', 'projectShare']);
	});

	test('すでにあれば元の配列をそのまま返す', () => {
		const menu = ['projectShare', 'pair'];
		expect(addProjectShareToMenu(menu)).toBe(menu);
	});
});
