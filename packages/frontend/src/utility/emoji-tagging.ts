/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 絵文字のタグとカテゴリを Claude に提案させる機能 (管理者だけ) の、判定と API の呼び出し

import * as Misskey from 'misskey-js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';

export type EmojiTagSuggestion = Misskey.entities.AdminEmojiSuggestTagsResponse;
export type EmojiTagSuggestionRequest = Misskey.entities.AdminEmojiSuggestTagsRequest;

/** 管理画面で選べるモデル。backend の EMOJI_TAGGING_MODELS と同じ */
export const EMOJI_TAGGING_MODELS = [
	{ value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
	{ value: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
	{ value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
] as const;

/** 提案のリクエストを同時に送る数 */
export const EMOJI_TAGGING_CONCURRENCY = 4;

/** まとめて提案するときの対象 */
export type EmojiTaggingTarget = 'noTags' | 'fewTags' | 'someTags' | 'all';

let availability: Promise<boolean> | null = null;

/**
 * 自分が提案を使えるか (管理者で、Claude の API キーが登録されている)。一度調べたら覚えておく
 */
export function isEmojiTaggingAvailable(refresh = false): Promise<boolean> {
	if ($i == null || !$i.isAdmin) return Promise.resolve(false);
	if (availability == null || refresh) {
		availability = misskeyApi('admin/meta').then(meta => meta.anthropicApiKeyHint != null).catch(() => false);
	}
	return availability;
}

export function suggestEmojiTags(params: EmojiTagSuggestionRequest): Promise<EmojiTagSuggestion> {
	return misskeyApi<EmojiTagSuggestion, 'admin/emoji/suggest-tags', EmojiTagSuggestionRequest>('admin/emoji/suggest-tags', params);
}

/** タグの欄 (スペース区切り) を配列にする */
export function parseTags(text: string): string[] {
	return text.split(/\s+/u).filter(it => it !== '');
}

/**
 * 今のタグに提案を足す。今のタグは消さず、重複は足さない
 */
export function mergeTags(current: readonly string[], suggested: readonly string[]): string[] {
	const result = [...current];
	for (const tag of suggested) {
		if (!result.includes(tag)) result.push(tag);
	}
	return result;
}

/**
 * 登録の表で再提案したときのタグの欄。前の提案から入った語だけを新しい提案に差し替え、人が書き足した語は残す
 */
export function replaceSuggestedTags(cell: readonly string[], previous: readonly string[], suggested: readonly string[]): string[] {
	return mergeTags(cell.filter(it => !previous.includes(it)), suggested);
}

/**
 * まとめて提案するときに、この絵文字を対象にするか
 */
export function matchesTaggingTarget(emoji: { aliases: string[] }, target: EmojiTaggingTarget): boolean {
	const count = emoji.aliases.filter(it => it !== '').length;
	switch (target) {
		case 'noTags': return count === 0;
		case 'fewTags': return count <= 2;
		case 'someTags': return count <= 5;
		case 'all': return true;
	}
}

/**
 * 提案の API のエラーを画面に出す文にする
 */
export function emojiTaggingErrorMessage(err: unknown): string {
	const code = typeof err === 'object' && err != null && 'code' in err ? (err as { code: unknown }).code : null;
	switch (code) {
		case 'EMOJI_TAGGING_NOT_CONFIGURED': return i18n.ts._emojiTagging._errors.notConfigured;
		case 'FAILED_TO_LOAD_IMAGE': return i18n.ts._emojiTagging._errors.failedToLoadImage;
		case 'INVALID_API_KEY': return i18n.ts._emojiTagging._errors.invalidApiKey;
		case 'CLAUDE_RATE_LIMITED': return i18n.ts._emojiTagging._errors.rateLimited;
		case 'CLAUDE_REFUSED': return i18n.ts._emojiTagging._errors.refused;
		case 'CLAUDE_FAILED': return i18n.ts._emojiTagging._errors.failed;
		default: return i18n.ts.somethingHappened;
	}
}
