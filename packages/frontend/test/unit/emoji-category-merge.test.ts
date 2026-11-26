/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { countEmojiCategories } from '@/utility/emoji-category-merge.js';

describe('countEmojiCategories', () => {
	test('カテゴリごとに数え、名前順に並べる。カテゴリの無いものは数えない', () => {
		expect(countEmojiCategories([
			{ category: 'blob' },
			{ category: 'ablob' },
			{ category: 'blob' },
			{ category: null },
			{ category: '' },
		])).toEqual([
			{ name: 'ablob', count: 1 },
			{ name: 'blob', count: 2 },
		]);
	});

	test('絵文字が無ければ空', () => {
		expect(countEmojiCategories([])).toEqual([]);
	});
});
