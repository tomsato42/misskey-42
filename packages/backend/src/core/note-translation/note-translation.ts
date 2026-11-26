/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ノートの翻訳を覚えておき、すでに誰かが訳したノートは最初から訳文を出すための、DI 不要の純粋関数と定数

import type { MiNote } from '@/models/Note.js';

export type NoteTranslation = { sourceLang: string; text: string };

/** 訳した結果を覚えておく秒数。翻訳の API (DeepL・Claude) を呼び直さずに済み、ほかの人にも最初から出せる */
export const NOTE_TRANSLATION_CACHE_TTL_SEC = 60 * 60 * 24 * 7;

/** notes/translations で一度に調べられるノートの数 */
export const MAX_CACHED_TRANSLATION_NOTES = 30;

/** 翻訳先として受け付ける言語コードの形 (ja、ja-JP、zh-Hant-TW など) */
const TARGET_LANG_PATTERN = /^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$/i;

/**
 * 翻訳先の言語コードを確かめて小文字にする。形が違えば null。
 * プロンプトとキャッシュのキーにはこれだけを使う (好きな文字列でキャッシュをすり抜けたり、指示を書き足したりできないように)
 */
export function normalizeTargetLang(targetLang: string): string | null {
	const lang = targetLang.trim();
	return TARGET_LANG_PATTERN.test(lang) ? lang.toLowerCase() : null;
}

/**
 * 覚えておくキー。編集されたら (updatedAt が変わったら) 別のキーになり、古い訳は使わない
 * @param lang normalizeTargetLang で確かめた言語コード
 */
export function buildNoteTranslationCacheKey(note: Pick<MiNote, 'id' | 'updatedAt'>, lang: string): string {
	return `noteTranslation:${note.id}:${note.updatedAt?.getTime() ?? 0}:${lang}`;
}

/**
 * 覚えておいた値を読む。形が違えば null
 */
export function parseCachedTranslation(raw: string | null): NoteTranslation | null {
	if (raw == null) return null;
	try {
		const value = JSON.parse(raw) as { sourceLang?: unknown; text?: unknown } | null;
		if (typeof value?.sourceLang !== 'string' || typeof value.text !== 'string' || value.text === '') return null;
		return { sourceLang: value.sourceLang, text: value.text };
	} catch {
		return null;
	}
}

/**
 * 元の言語と翻訳先が同じか (同じなら訳す意味が無いので、最初から出さない)。ja と ja-JP、JA は同じとみなす
 */
export function isSameLanguage(sourceLang: string, targetLang: string): boolean {
	const base = (lang: string) => lang.split('-')[0].toLowerCase();
	return base(sourceLang) === base(targetLang);
}
