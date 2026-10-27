/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { URLSearchParams } from 'node:url';
import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { GetterService } from '@/server/api/GetterService.js';
import { RoleService } from '@/core/RoleService.js';
import { ClaudeTranslationService } from '@/core/anthropic/ClaudeTranslationService.js';
import { ClaudeError } from '@/core/anthropic/AnthropicService.js';
import { NoteTranslationCacheService } from '@/core/note-translation/NoteTranslationCacheService.js';
import { normalizeTargetLang } from '@/core/note-translation/note-translation.js';
import { MiMeta } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '../../error.js';

export const meta = {
	tags: ['notes'],

	requireCredential: true,
	kind: 'read:account',

	// Claude で訳すときは 1 回ごとに費用がかかるので、続けて送れる数を絞る (同じノートの翻訳は覚えておく)
	limit: {
		duration: 1000 * 60,
		max: 60,
	},

	res: {
		type: 'object',
		optional: true, nullable: false,
		properties: {
			sourceLang: { type: 'string' },
			text: { type: 'string' },
		},
	},

	errors: {
		unavailable: {
			message: 'Translate of notes unavailable.',
			code: 'UNAVAILABLE',
			id: '50a70314-2d8a-431b-b433-efa5cc56444c',
		},
		noSuchNote: {
			message: 'No such note.',
			code: 'NO_SUCH_NOTE',
			id: 'bea9b03f-36e0-49c5-a4db-627a029f8971',
		},
		cannotTranslateInvisibleNote: {
			message: 'Cannot translate invisible note.',
			code: 'CANNOT_TRANSLATE_INVISIBLE_NOTE',
			id: 'ea29f2ca-c368-43b3-aaf1-5ac3e74bbe5d',
		},
		translationFailed: {
			message: 'Failed to translate the note. Try again later.',
			code: 'TRANSLATION_FAILED',
			id: '2e0cb9ea-3a83-4dfb-a0de-5b7aad20c947',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		noteId: { type: 'string', format: 'misskey:id' },
		targetLang: { type: 'string' },
	},
	required: ['noteId', 'targetLang'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meta)
		private serverSettings: MiMeta,

		private noteEntityService: NoteEntityService,
		private getterService: GetterService,
		private httpRequestService: HttpRequestService,
		private roleService: RoleService,
		private claudeTranslationService: ClaudeTranslationService,
		private noteTranslationCacheService: NoteTranslationCacheService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const policies = await this.roleService.getUserPolicies(me.id);
			if (!policies.canUseTranslator) {
				throw new ApiError(meta.errors.unavailable);
			}

			const note = await this.getterService.getNote(ps.noteId).catch(err => {
				if (err.id === '9725d0ce-ba28-4dde-95a7-2cbb2c15de24') throw new ApiError(meta.errors.noSuchNote);
				throw err;
			});

			if (!(await this.noteEntityService.isVisibleForMe(note, me.id))) {
				throw new ApiError(meta.errors.cannotTranslateInvisibleNote);
			}

			// makeNotesHiddenBefore などで中身が隠されるノート
			const packedNote = await this.noteEntityService.pack(note, me);
			if (packedNote.isHidden) {
				throw new ApiError(meta.errors.cannotTranslateInvisibleNote);
			}

			let text = note.text ?? '';
			if (note.cw != null) {
				text = `${note.cw}\n-----\n${text}`;
			}

			if (text.trim() === '') {
				return;
			}

			// 同じノート (同じ版) を同じ言語に訳したことがあれば、翻訳の API を呼ばずにそれを返す
			const lang = normalizeTargetLang(ps.targetLang);
			if (lang != null) {
				const cached = await this.noteTranslationCacheService.get(note, lang);
				if (cached != null) return cached;
			}

			const translation = await this.translate(text, ps.targetLang);
			if (lang != null) await this.noteTranslationCacheService.set(note, lang, translation);
			return translation;
		});
	}

	/**
	 * 設定に合わせて DeepL か Claude で訳す
	 */
	private async translate(text: string, rawTargetLang: string): Promise<{ sourceLang: string; text: string }> {
		if (this.claudeTranslationService.isEnabled) {
			try {
				return await this.claudeTranslationService.translate(text, rawTargetLang);
			} catch (err) {
				if (err instanceof ClaudeError) throw new ApiError(meta.errors.translationFailed);
				throw err;
			}
		}

		if (this.serverSettings.deeplAuthKey == null) {
			throw new ApiError(meta.errors.unavailable);
		}

		let targetLang = rawTargetLang;
		if (targetLang.includes('-')) targetLang = targetLang.split('-')[0];

		const params = new URLSearchParams();
		params.append('text', text);
		params.append('target_lang', targetLang);

		const endpoint = this.serverSettings.deeplIsPro ? 'https://api.deepl.com/v2/translate' : 'https://api-free.deepl.com/v2/translate';

		const res = await this.httpRequestService.send(endpoint, {
			method: 'POST',
			headers: {
				'Authorization': `DeepL-Auth-Key ${this.serverSettings.deeplAuthKey}`,
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json, */*',
			},
			body: params.toString(),
		});

		const json = (await res.json()) as {
			translations: {
				detected_source_language: string;
				text: string;
			}[];
		};

		return {
			sourceLang: json.translations[0].detected_source_language,
			text: json.translations[0].text,
		};
	}
}
