/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// カスタム絵文字のカテゴリを廃止し、入っている絵文字をほかのカテゴリにまとめる

import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { customEmojis } from '@/custom-emojis.js';

export type CategoryCount = {
	name: string;
	count: number;
};

/**
 * ローカルの絵文字から、カテゴリごとの件数を名前順に数える。カテゴリの無いものは数えない
 */
export function countEmojiCategories(emojis: readonly { category: string | null }[]): CategoryCount[] {
	const counts = new Map<string, number>();
	for (const emoji of emojis) {
		if (emoji.category == null || emoji.category === '') continue;
		counts.set(emoji.category, (counts.get(emoji.category) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort(([a], [b]) => a.localeCompare(b, 'ja'))
		.map(([name, count]) => ({ name, count }));
}

/**
 * まとめる元と先を選ばせ、確かめてから移す。移したら true
 */
export async function openMergeEmojiCategoryDialog(): Promise<boolean> {
	const categories = countEmojiCategories(customEmojis.value);
	if (categories.length < 1) {
		await os.alert({ type: 'info', text: i18n.ts._emojiCategoryMerge.noCategories });
		return false;
	}

	const { canceled, result } = await os.form(i18n.ts._emojiCategoryMerge.title, {
		from: {
			type: 'enum',
			label: i18n.ts._emojiCategoryMerge.from,
			required: true,
			default: categories[0].name,
			enum: categories.map(it => ({ value: it.name, label: i18n.tsx._emojiCategoryMerge.categoryWithCount({ name: it.name, count: it.count }) })),
		},
		to: {
			type: 'string',
			label: i18n.ts._emojiCategoryMerge.to,
			description: i18n.ts._emojiCategoryMerge.toDescription,
			required: false,
			default: '',
		},
	});
	if (canceled) return false;

	const from = String(result.from);
	const to = (result.to ?? '').trim();
	if (to === from) return false;
	const count = categories.find(it => it.name === from)?.count ?? 0;

	const { canceled: confirmCanceled } = await os.confirm({
		type: 'warning',
		text: to === ''
			? i18n.tsx._emojiCategoryMerge.confirmRemove({ from, count })
			: i18n.tsx._emojiCategoryMerge.confirm({ from, to, count }),
	});
	if (confirmCanceled) return false;

	await os.apiWithDialog('admin/emoji/merge-category', { from, to: to === '' ? null : to });
	return true;
}
