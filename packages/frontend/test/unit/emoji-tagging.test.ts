/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

const me = vi.hoisted(() => ({ isAdmin: true as boolean }));

vi.mock('@/i.js', async (importOriginal) => ({
	...await importOriginal<typeof import('@/i.js')>(),
	$i: me,
}));

const misskeyApiMock = vi.hoisted(() => vi.fn(async (endpoint: string, params?: unknown): Promise<unknown> => ({ anthropicApiKeyHint: 'Qx7A' })));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: misskeyApiMock }));

import {
	emojiTaggingErrorMessage,
	isEmojiTaggingAvailable,
	matchesTaggingTarget,
	mergeTags,
	parseTags,
	replaceSuggestedTags,
} from '@/utility/emoji-tagging.js';
import { i18n } from '@/i18n.js';

describe('parseTags', () => {
	test('空白で区切り、空を除く', () => {
		expect(parseTags(' うれしい  smile\tやったー ')).toEqual(['うれしい', 'smile', 'やったー']);
		expect(parseTags('')).toEqual([]);
	});
});

describe('mergeTags', () => {
	test('今のタグを残して、無いものだけ足す', () => {
		expect(mergeTags(['にこ', 'smile'], ['smile', 'うれしい'])).toEqual(['にこ', 'smile', 'うれしい']);
	});
});

describe('replaceSuggestedTags', () => {
	test('前の提案から入った語だけを差し替え、人が書き足した語は残す', () => {
		expect(replaceSuggestedTags(['うれしい', '自作', 'smile'], ['うれしい', 'smile'], ['やったー', 'happy'])).toEqual(['自作', 'やったー', 'happy']);
	});

	test('前の提案が無ければ足すだけ', () => {
		expect(replaceSuggestedTags(['自作'], [], ['やったー'])).toEqual(['自作', 'やったー']);
	});
});

describe('matchesTaggingTarget', () => {
	const emoji = (count: number) => ({ aliases: Array.from({ length: count }, (_, i) => `t${i}`) });

	test('タグの数で対象を決める', () => {
		expect(matchesTaggingTarget(emoji(0), 'noTags')).toBe(true);
		expect(matchesTaggingTarget(emoji(1), 'noTags')).toBe(false);
		expect(matchesTaggingTarget(emoji(2), 'fewTags')).toBe(true);
		expect(matchesTaggingTarget(emoji(3), 'fewTags')).toBe(false);
		expect(matchesTaggingTarget(emoji(5), 'someTags')).toBe(true);
		expect(matchesTaggingTarget(emoji(6), 'someTags')).toBe(false);
		expect(matchesTaggingTarget(emoji(30), 'all')).toBe(true);
	});

	test('空のタグは数えない', () => {
		expect(matchesTaggingTarget({ aliases: [''] }, 'noTags')).toBe(true);
	});
});

describe('emojiTaggingErrorMessage', () => {
	test('エラーの code ごとの文にする', () => {
		expect(emojiTaggingErrorMessage({ code: 'INVALID_API_KEY' })).toBe(i18n.ts._emojiTagging._errors.invalidApiKey);
		expect(emojiTaggingErrorMessage({ code: 'CLAUDE_RATE_LIMITED' })).toBe(i18n.ts._emojiTagging._errors.rateLimited);
		// このサーバーの API の上限も同じ文にする
		expect(emojiTaggingErrorMessage({ code: 'RATE_LIMIT_EXCEEDED' })).toBe(i18n.ts._emojiTagging._errors.rateLimited);
	});

	test('知らないエラーは一般の文にする', () => {
		expect(emojiTaggingErrorMessage({ code: 'UNKNOWN' })).toBe(i18n.ts.somethingHappened);
		expect(emojiTaggingErrorMessage(new Error('x'))).toBe(i18n.ts.somethingHappened);
	});
});

describe('isEmojiTaggingAvailable', () => {
	beforeEach(() => {
		misskeyApiMock.mockClear();
		me.isAdmin = true;
	});

	test('管理者でキーが登録されていれば使える。一度調べたら覚えておく', async () => {
		expect(await isEmojiTaggingAvailable(true)).toBe(true);
		expect(await isEmojiTaggingAvailable()).toBe(true);
		expect(misskeyApiMock).toHaveBeenCalledTimes(1);
		expect(misskeyApiMock).toHaveBeenCalledWith('admin/meta');
	});

	test('キーが無ければ使えない', async () => {
		misskeyApiMock.mockResolvedValueOnce({ anthropicApiKeyHint: null });
		expect(await isEmojiTaggingAvailable(true)).toBe(false);
	});

	test('管理者でなければ API を呼ばずに使えない', async () => {
		me.isAdmin = false;
		expect(await isEmojiTaggingAvailable(true)).toBe(false);
		expect(misskeyApiMock).not.toHaveBeenCalled();
	});
});
