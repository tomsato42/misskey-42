/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ms from 'ms';
import { Injectable } from '@nestjs/common';
import { MAX_NOTE_TEXT_LENGTH } from '@/const.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { GetterService } from '@/server/api/GetterService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { isEditedNoteEmpty, isUneditableNote, NoteUpdateService } from '@/core/NoteUpdateService.js';
import { ApiError } from '../../error.js';

// 42times: 自分のノートの本文と CW を編集する

export const meta = {
	tags: ['notes'],

	requireCredential: true,

	prohibitMoved: true,

	kind: 'write:notes',

	limit: {
		duration: ms('1hour'),
		max: 300,
		minInterval: ms('1sec'),
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'Note',
	},

	errors: {
		noSuchNote: {
			message: 'No such note.',
			code: 'NO_SUCH_NOTE',
			id: 'daef4f8a-0826-4392-a384-3b127439321d',
		},

		accessDenied: {
			message: 'You can only edit your own notes.',
			code: 'ACCESS_DENIED',
			id: '0737f513-a1f9-4bfe-867c-85d00098c295',
		},

		cannotEditRenote: {
			message: 'You can not edit a pure Renote.',
			code: 'CANNOT_EDIT_RENOTE',
			id: 'fc398242-cc3e-4638-8f0d-f58f1f4800cd',
		},

		emptyNote: {
			message: 'The note would have no content.',
			code: 'EMPTY_NOTE',
			id: 'a8df4a14-03b6-4b5f-961e-e3639f0581a3',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		noteId: { type: 'string', format: 'misskey:id' },
		text: {
			type: 'string',
			minLength: 1,
			maxLength: MAX_NOTE_TEXT_LENGTH,
			nullable: true,
		},
		cw: { type: 'string', nullable: true, minLength: 1, maxLength: 100 },
	},
	required: ['noteId', 'text', 'cw'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private getterService: GetterService,
		private noteEntityService: NoteEntityService,
		private noteUpdateService: NoteUpdateService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const note = await this.getterService.getNote(ps.noteId).catch(err => {
				if (err.id === '9725d0ce-ba28-4dde-95a7-2cbb2c15de24') throw new ApiError(meta.errors.noSuchNote);
				throw err;
			});

			// モデレーターでも人のノートは編集できない (削除はできる)
			if (note.userId !== me.id) throw new ApiError(meta.errors.accessDenied);
			if (isUneditableNote(note)) throw new ApiError(meta.errors.cannotEditRenote);

			const edit = { text: ps.text, cw: ps.cw };
			if (isEditedNoteEmpty(note, edit)) throw new ApiError(meta.errors.emptyNote);

			const updated = await this.noteUpdateService.update(me, note, edit);
			return await this.noteEntityService.pack(updated, me);
		});
	}
}
