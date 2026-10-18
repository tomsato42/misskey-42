/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ms from 'ms';
import { Inject, Injectable } from '@nestjs/common';
import type { NotesRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CalendarEventService } from '@/core/calendar/CalendarEventService.js';
import { ApiError } from '@/server/api/error.js';
import { toCalendarApiError } from '@/server/api/calendar-api.js';
import { DI } from '@/di-symbols.js';

export const meta = {
	tags: ['calendar', 'notes'],

	requireCredential: true,

	kind: 'write:account',

	limit: {
		duration: ms('1hour'),
		max: 100,
	},

	description: 'Unlink a note from its calendar event. The author of the note, the creator of the event and moderators can do this. Others get NOTE_NOT_LINKED_TO_CALENDAR_EVENT whether the note is linked or not.',

	errors: {
		noSuchNote: {
			message: 'No such note.',
			code: 'NO_SUCH_NOTE',
			id: '15265335-c3f4-4047-9995-fe7e131f9e67',
		},
		notLinked: {
			message: 'The note is not linked to any calendar event, or you do not have permission to unlink it.',
			code: 'NOTE_NOT_LINKED_TO_CALENDAR_EVENT',
			id: '4de63727-115b-483c-905f-a90dc0d3ebb3',
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
		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		private calendarEventService: CalendarEventService,
	) {
		super(meta, paramDef, async (ps, me) => {
			// ノートの作成者以外 (イベントの作成者など) も外せるので、ノートの公開範囲は見ない。
			// 紐づけが無いときと外す権限が無いときは、どちらも notLinked にする (見られないノートの紐づけの有無を明かさない)
			const note = await this.notesRepository.findOne({ where: { id: ps.noteId }, select: { id: true } });
			if (note == null) throw new ApiError(meta.errors.noSuchNote);

			try {
				await this.calendarEventService.unlinkNote(note, me);
			} catch (err) {
				throw toCalendarApiError(err, {
					noteNotLinked: meta.errors.notLinked,
				});
			}
		});
	}
}
