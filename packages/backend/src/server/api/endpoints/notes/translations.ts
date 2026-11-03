/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { NotesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { RoleService } from '@/core/RoleService.js';
import { NoteTranslationCacheService } from '@/core/note-translation/NoteTranslationCacheService.js';
import { MAX_CACHED_TRANSLATION_NOTES, isSameLanguage, normalizeTargetLang } from '@/core/note-translation/note-translation.js';

export const meta = {
	tags: ['notes'],

	description: 'Return the translations of notes that someone has already translated (with notes/translate) into the language. Nothing is translated here, so it costs nothing. Notes you cannot see and notes without a translation are left out.',

	requireCredential: true,
	kind: 'read:account',

	limit: {
		duration: 1000 * 60,
		max: 120,
	},

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				noteId: { type: 'string', optional: false, nullable: false, format: 'id' },
				sourceLang: { type: 'string', optional: false, nullable: false },
				text: { type: 'string', optional: false, nullable: false },
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		noteIds: {
			type: 'array',
			uniqueItems: true,
			minItems: 1,
			maxItems: MAX_CACHED_TRANSLATION_NOTES,
			items: { type: 'string', format: 'misskey:id' },
		},
		targetLang: { type: 'string', maxLength: 32 },
	},
	required: ['noteIds', 'targetLang'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		private noteEntityService: NoteEntityService,
		private roleService: RoleService,
		private noteTranslationCacheService: NoteTranslationCacheService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const lang = normalizeTargetLang(ps.targetLang);
			if (lang == null) return [];

			// 翻訳を使えない人には、訳があっても見せない (notes/translate と同じ)
			const policies = await this.roleService.getUserPolicies(me.id);
			if (!policies.canUseTranslator) return [];

			const notes = await this.notesRepository.findBy({ id: In(ps.noteIds) });
			const translations = await this.noteTranslationCacheService.getMany(notes, lang);
			const candidates = notes.filter(note => translations.has(note.id));
			if (candidates.length === 0) return [];

			// 訳はほかの人が作ったものなので、notes/translate と同じく、自分が見られるノートの訳だけを返す
			const packed = await this.noteEntityService.packMany(candidates, me, { detail: false });
			const visibleIds = new Set(packed.filter(it => !it.isHidden).map(it => it.id));

			return candidates
				.filter(note => visibleIds.has(note.id))
				.map(note => ({ noteId: note.id, ...translations.get(note.id)! }))
				// 元の言語のままなら訳す意味が無いので出さない
				.filter(it => !isSameLanguage(it.sourceLang, lang));
		});
	}
}
