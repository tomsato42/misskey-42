/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import {
	DEFAULT_EMOJI_TAGGING_MODEL,
	MAX_SUGGESTED_TAGS,
	buildCategoryListPrompt,
	buildEmojiTaggingPrompt,
	collectCategories,
	maskApiKey,
	normalizeSuggestedCategory,
	normalizeSuggestedTags,
	toEmojiTaggingModel,
} from '@/core/emoji-tagging/emoji-tagging.js';

describe('normalizeSuggestedTags', () => {
	const options = { name: 'happy', currentTags: ['にこ'], excludedTags: ['ハッピー'] };

	test('空白を詰め、空・記号だけ・文字列でないものを外す', () => {
		expect(normalizeSuggestedTags(['うれ しい', ' ', '!!!', 42, null, 'smile'], options)).toEqual(['うれしい', 'smile']);
	});

	test('絵文字名・今のタグ・除く語と同じものを、大文字小文字と全角半角を区別せずに外す', () => {
		expect(normalizeSuggestedTags(['HAPPY', 'ｈａｐｐｙ', 'にこ', 'ﾊｯﾋﾟｰ', 'やったー'], options)).toEqual(['やったー']);
	});

	test('重複を除き、最大数までにする', () => {
		const raw = ['a1', 'A1', ...Array.from({ length: 30 }, (_, i) => `tag${i}`)];
		const result = normalizeSuggestedTags(raw, options);
		expect(result[0]).toBe('a1');
		expect(result).not.toContain('A1');
		expect(result).toHaveLength(MAX_SUGGESTED_TAGS);
	});

	test('長すぎるタグは外す', () => {
		expect(normalizeSuggestedTags(['あ'.repeat(33), 'あ'.repeat(32)], options)).toEqual(['あ'.repeat(32)]);
	});

	test('配列でなければ空にする', () => {
		expect(normalizeSuggestedTags('うれしい', options)).toEqual([]);
		expect(normalizeSuggestedTags(undefined, options)).toEqual([]);
	});
});

describe('normalizeSuggestedCategory', () => {
	const categories = ['きもち', 'Food', '42/課題'];

	test('今あるカテゴリと同じなら、今あるほうの名前にそろえる', () => {
		expect(normalizeSuggestedCategory('food', categories)).toEqual({ name: 'Food', isNew: false });
		expect(normalizeSuggestedCategory(' 42/課題 ', categories)).toEqual({ name: '42/課題', isNew: false });
	});

	test('無ければ新しいカテゴリにする', () => {
		expect(normalizeSuggestedCategory('どうぶつ', categories)).toEqual({ name: 'どうぶつ', isNew: true });
	});

	test('空・長すぎる・文字列でないものは null', () => {
		expect(normalizeSuggestedCategory('  ', categories)).toBeNull();
		expect(normalizeSuggestedCategory('あ'.repeat(65), categories)).toBeNull();
		expect(normalizeSuggestedCategory(null, categories)).toBeNull();
	});
});

describe('collectCategories', () => {
	test('空と重複を除いて並べる', () => {
		expect(collectCategories(['b', null, 'a', '', 'b'])).toEqual(['a', 'b']);
	});
});

describe('buildCategoryListPrompt', () => {
	test('一覧を箇条書きにする', () => {
		expect(buildCategoryListPrompt(['a', 'b'])).toBe('今あるカテゴリ:\n- a\n- b');
	});

	test('カテゴリが無いときもそう伝える', () => {
		expect(buildCategoryListPrompt([])).toBe('今あるカテゴリ: (まだ無い)');
	});
});

describe('buildEmojiTaggingPrompt', () => {
	test('今のタグ・除く語・ヒントがあれば入れる', () => {
		const prompt = buildEmojiTaggingPrompt({
			name: 'cry',
			category: null,
			currentTags: ['泣き'],
			excludedTags: ['涙', 'sad'],
			hint: '顔文字っぽく',
		});
		expect(prompt).toContain('絵文字の名前: cry');
		expect(prompt).toContain('今のカテゴリ: (未設定)');
		expect(prompt).toContain('泣き');
		expect(prompt).toContain('涙 sad');
		expect(prompt).toContain('顔文字っぽく');
	});

	test('無いものは入れない', () => {
		const prompt = buildEmojiTaggingPrompt({ name: 'cry', category: 'きもち', currentTags: [], excludedTags: [], hint: null });
		expect(prompt).toContain('今のカテゴリ: きもち');
		expect(prompt).not.toContain('今付いているタグ');
		expect(prompt).not.toContain('前に提案');
		expect(prompt).not.toContain('ヒント');
	});
});

describe('toEmojiTaggingModel', () => {
	test('選べないモデルは既定にする', () => {
		expect(toEmojiTaggingModel('claude-haiku-5-5')).toBe('claude-haiku-5-5');
		expect(toEmojiTaggingModel('claude-3-opus')).toBe(DEFAULT_EMOJI_TAGGING_MODEL);
	});
});

describe('maskApiKey', () => {
	test('末尾 4 文字だけにする', () => {
		expect(maskApiKey('sk-ant-api03-abcdefghQx7A')).toBe('Qx7A');
	});

	test('無ければ null、短すぎれば空', () => {
		expect(maskApiKey(null)).toBeNull();
		expect(maskApiKey('')).toBeNull();
		expect(maskApiKey('short')).toBe('****');
	});
});
