/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { NoteHistoriesRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { GetterService } from '@/server/api/GetterService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { IdService } from '@/core/IdService.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '../../error.js';

// 42times: ノートの編集履歴 (編集する前の版)。新しい順。ノートを見られる人だけが見られる

export const meta = {
	tags: ['notes'],

	requireCredential: true,

	kind: 'read:account',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				id: { type: 'string', optional: false, nullable: false, format: 'id' },
				text: { type: 'string', optional: false, nullable: true },
				cw: { type: 'string', optional: false, nullable: true },
				createdAt: {
					type: 'string', optional: false, nullable: false, format: 'date-time',
					description: 'When this version was written (the note creation or the previous edit).',
				},
				replacedAt: {
					type: 'string', optional: false, nullable: false, format: 'date-time',
					description: 'When this version was replaced by the next edit.',
				},
			},
		},
	},

	errors: {
		noSuchNote: {
			message: 'No such note.',
			code: 'NO_SUCH_NOTE',
			id: 'a6c69777-f601-4e22-9a14-343ff4e8bbda',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		noteId: { type: 'string', format: 'misskey:id' },
	},
	required: ['noteId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.noteHistoriesRepository)
		private noteHistoriesRepository: NoteHistoriesRepository,

		private getterService: GetterService,
		private noteEntityService: NoteEntityService,
		private idService: IdService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const note = await this.getterService.getNote(ps.noteId).catch(err => {
				if (err.id === '9725d0ce-ba28-4dde-95a7-2cbb2c15de24') throw new ApiError(meta.errors.noSuchNote);
				throw err;
			});

			// 見られないノート (公開範囲の外など) は、履歴があるかも分からないようにする
			const packed = await this.noteEntityService.pack(note, me, { detail: false });
			if (packed.isHidden) throw new ApiError(meta.errors.noSuchNote);

			const histories = await this.noteHistoriesRepository.find({
				where: { noteId: note.id },
				order: { id: 'ASC' },
			});

			const versions = histories.map((h, i) => ({
				id: h.id,
				text: h.text,
				cw: h.cw,
				createdAt: (i === 0 ? this.idService.parse(note.id).date : this.idService.parse(histories[i - 1].id).date).toISOString(),
				replacedAt: this.idService.parse(h.id).date.toISOString(),
			}));

			return versions.reverse();
		});
	}
}
