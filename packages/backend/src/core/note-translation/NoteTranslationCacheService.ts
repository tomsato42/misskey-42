/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import type { MiNote } from '@/models/Note.js';
import { bindThis } from '@/decorators.js';
import {
	NOTE_TRANSLATION_CACHE_TTL_SEC,
	buildNoteTranslationCacheKey,
	parseCachedTranslation,
} from './note-translation.js';
import type { NoteTranslation } from './note-translation.js';

/**
 * ノートを訳した結果を Redis に覚えておく。DeepL でも Claude でも同じキーで、誰が訳しても同じ訳を使う
 */
@Injectable()
export class NoteTranslationCacheService {
	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis,
	) {
	}

	/**
	 * @param lang normalizeTargetLang で確かめた言語コード
	 */
	@bindThis
	public async get(note: Pick<MiNote, 'id' | 'updatedAt'>, lang: string): Promise<NoteTranslation | null> {
		return parseCachedTranslation(await this.redisClient.get(buildNoteTranslationCacheKey(note, lang)));
	}

	/**
	 * いくつものノートの訳をまとめて読む。訳の無いノートは結果に入れない
	 */
	@bindThis
	public async getMany(notes: Pick<MiNote, 'id' | 'updatedAt'>[], lang: string): Promise<Map<MiNote['id'], NoteTranslation>> {
		const result = new Map<MiNote['id'], NoteTranslation>();
		if (notes.length === 0) return result;

		const values = await this.redisClient.mget(notes.map(note => buildNoteTranslationCacheKey(note, lang)));
		notes.forEach((note, i) => {
			const translation = parseCachedTranslation(values[i]);
			if (translation != null) result.set(note.id, translation);
		});
		return result;
	}

	@bindThis
	public async set(note: Pick<MiNote, 'id' | 'updatedAt'>, lang: string, translation: NoteTranslation): Promise<void> {
		await this.redisClient.set(buildNoteTranslationCacheKey(note, lang), JSON.stringify(translation), 'EX', NOTE_TRANSLATION_CACHE_TTL_SEC);
	}
}
