/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 絵文字のタグの提案の API (admin/emoji/suggest-tags・admin/emoji/test-tagging) が返すエラー。
// サービスの EmojiTaggingError の code ごとに 1 つ。どのエンドポイントでも同じ ID を返す

import { EmojiTaggingError } from '@/core/emoji-tagging/EmojiTagSuggestionService.js';
import type { EmojiTaggingErrorCode } from '@/core/emoji-tagging/EmojiTagSuggestionService.js';
import { ApiError } from './error.js';

type ErrorDef = { message: string; code: string; id: string };

export const emojiTaggingApiErrors = {
	notConfigured: {
		message: 'The Claude API key is not set.',
		code: 'EMOJI_TAGGING_NOT_CONFIGURED',
		id: 'a4ffd505-f72f-42c3-858b-02bfff4c50de',
	},
	failedToLoadImage: {
		message: 'Failed to load the emoji image.',
		code: 'FAILED_TO_LOAD_IMAGE',
		id: '3267fbc5-93b9-459e-839c-a56e8192072f',
	},
	invalidApiKey: {
		message: 'The Claude API key was rejected.',
		code: 'INVALID_API_KEY',
		id: 'cfa3ca37-5ded-4843-9115-31766a914253',
	},
	rateLimited: {
		message: 'The Claude API rate limit was reached. Try again later.',
		code: 'CLAUDE_RATE_LIMITED',
		id: '7dd56bc6-7f6d-43b6-b807-6f8679cc19ee',
	},
	refused: {
		message: 'Claude declined to suggest tags for this emoji.',
		code: 'CLAUDE_REFUSED',
		id: '037e640a-7fd4-431c-9716-63bc627f2f7d',
	},
	failed: {
		message: 'Failed to get tags from Claude.',
		code: 'CLAUDE_FAILED',
		id: '31cb1dcf-062f-405c-8463-3156981d96a7',
	},
} as const satisfies Record<string, ErrorDef>;

const errorKeys = {
	NOT_CONFIGURED: 'notConfigured',
	FAILED_TO_LOAD_IMAGE: 'failedToLoadImage',
	INVALID_API_KEY: 'invalidApiKey',
	RATE_LIMITED: 'rateLimited',
	REFUSED: 'refused',
	FAILED: 'failed',
} as const satisfies Record<EmojiTaggingErrorCode, keyof typeof emojiTaggingApiErrors>;

/**
 * サービスの EmojiTaggingError を API エラーに変換する。その他の例外はそのまま投げる
 */
export async function withEmojiTaggingApiErrors<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		if (err instanceof EmojiTaggingError) throw new ApiError(emojiTaggingApiErrors[errorKeys[err.code]]);
		throw err;
	}
}
