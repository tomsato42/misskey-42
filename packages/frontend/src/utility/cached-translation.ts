/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 誰かが翻訳したノートの訳を、表示したときに最初から出すための取得。表示したノートの ID をまとめて notes/translations に問い合わせる

import * as Misskey from 'misskey-js';
import { $i } from '@/i.js';
import { instance } from '@/instance.js';
import { miLocalStorage } from '@/local-storage.js';
import { prefer } from '@/preferences.js';
import { misskeyApi } from '@/utility/misskey-api.js';

export type NoteTranslation = Misskey.entities.NotesTranslateResponse;

/** 一度に問い合わせるノートの数。backend の MAX_CACHED_TRANSLATION_NOTES と同じ */
export const MAX_TRANSLATION_BATCH = 30;

/** 問い合わせた結果 (訳が無かったことも含む) を覚えておくノートの数 */
const MAX_REMEMBERED_NOTES = 1000;

type FetchTranslations = (noteIds: string[]) => Promise<{ noteId: string; sourceLang: string; text: string }[]>;

type NoteVersion = Pick<Misskey.entities.Note, 'id' | 'updatedAt'>;

/** 編集されたら別の訳になるので、版ごとに覚える (backend のキャッシュのキーと同じ) */
function versionKey(note: NoteVersion): string {
	return `${note.id}:${note.updatedAt ?? ''}`;
}

/**
 * 同じタイミングで表示されたノートの問い合わせを、MAX_TRANSLATION_BATCH 件ずつにまとめる
 */
export function createTranslationBatcher(fetchTranslations: FetchTranslations) {
	const remembered = new Map<string, Promise<NoteTranslation | null>>();
	let queue: { noteId: string; key: string; resolve: (translation: NoteTranslation | null) => void }[] = [];
	let scheduled = false;

	async function flush(): Promise<void> {
		scheduled = false;
		const items = queue;
		queue = [];
		for (let i = 0; i < items.length; i += MAX_TRANSLATION_BATCH) {
			const chunk = items.slice(i, i + MAX_TRANSLATION_BATCH);
			try {
				const result = new Map((await fetchTranslations(chunk.map(it => it.noteId))).map(it => [it.noteId, { sourceLang: it.sourceLang, text: it.text }]));
				for (const item of chunk) item.resolve(result.get(item.noteId) ?? null);
			} catch {
				// 取れなくても困らない (メニューから翻訳できる)。次に表示したときにまた問い合わせる
				for (const item of chunk) {
					remembered.delete(item.key);
					item.resolve(null);
				}
			}
		}
	}

	function remember(key: string, promise: Promise<NoteTranslation | null>): void {
		remembered.delete(key);
		remembered.set(key, promise);
		if (remembered.size > MAX_REMEMBERED_NOTES) {
			remembered.delete(remembered.keys().next().value!);
		}
	}

	function load(note: NoteVersion): Promise<NoteTranslation | null> {
		const key = versionKey(note);
		const known = remembered.get(key);
		if (known != null) return known;

		const promise = new Promise<NoteTranslation | null>(resolve => {
			queue.push({ noteId: note.id, key, resolve });
		});
		remember(key, promise);

		if (!scheduled) {
			scheduled = true;
			// タイムラインは一度に何件も表示するので、同じタスクで表示されたものをまとめる
			window.setTimeout(flush, 0);
		}
		return promise;
	}

	/** メニューから翻訳したときに、その訳を覚えておく (覚えていた「訳なし」で、次に表示したときに消えないように) */
	function set(note: NoteVersion, translation: NoteTranslation): void {
		remember(versionKey(note), Promise.resolve(translation));
	}

	return { load, set };
}

/** notes/translate で訳すときと同じ言語 */
export function translationTargetLang(): string {
	return miLocalStorage.getItem('lang') ?? navigator.language;
}

const batcher = createTranslationBatcher(noteIds => misskeyApi('notes/translations', {
	noteIds,
	targetLang: translationTargetLang(),
}));

/**
 * このノートを誰かが自分の言語に訳していれば、その訳を返す。設定で切っている・翻訳を使えない・本文が無いときは問い合わせない
 */
export function fetchCachedTranslation(note: Pick<Misskey.entities.Note, 'id' | 'updatedAt' | 'text' | 'cw'>): Promise<NoteTranslation | null> {
	if (!isCachedTranslationAvailable() || !prefer.s.showCachedTranslations) return Promise.resolve(null);
	if ((note.text ?? '').trim() === '' && note.cw == null) return Promise.resolve(null);
	return batcher.load(note);
}

/** notes/translate で訳した結果を覚えておく */
export function rememberTranslation(note: NoteVersion, translation: NoteTranslation): void {
	batcher.set(note, translation);
}

/** サーバーの翻訳を使えるか (使えなければ、覚えている訳も見せない) */
export function isCachedTranslationAvailable(): boolean {
	return $i != null && $i.policies.canUseTranslator && instance.translatorAvailable;
}
