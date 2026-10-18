/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ms from 'ms';
import { Inject, Injectable } from '@nestjs/common';
import type { NotesRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CalendarEventService } from '@/core/calendar/CalendarEventService.js';
import { CalendarEventCanceledError } from '@/core/calendar/calendar-errors.js';
import { assertCalendarLinkableNote } from '@/core/calendar/calendar-note-link.js';
import { ApiError } from '@/server/api/error.js';
import { toCalendarApiError } from '@/server/api/calendar-api.js';
import { DI } from '@/di-symbols.js';

export const meta = {
	tags: ['calendar', 'notes'],

	requireCredential: true,

	prohibitMoved: true,

	kind: 'write:account',

	limit: {
		duration: ms('1hour'),
		max: 100,
	},

	description: 'Link your note to a calendar event. A note can be linked to only one event. Does nothing if already linked to the same event.',

	errors: {
		noSuchNote: {
			message: 'No such note.',
			code: 'NO_SUCH_NOTE',
			id: 'd54587c1-87ba-4d56-a113-9e29357d7529',
		},
		noSuchEvent: {
			message: 'No such calendar event.',
			code: 'NO_SUCH_CALENDAR_EVENT',
			id: 'cea2e56f-0bcd-4557-9dc7-bc4b9a3d642d',
		},
		accessDenied: {
			message: 'You can only link your own notes.',
			code: 'ACCESS_DENIED',
			id: '9fae17be-db0d-41ef-b418-eb4aeeefb8c6',
		},
		cannotLinkNote: {
			message: 'This note cannot be linked to a calendar event. See info.reason for details.',
			code: 'CANNOT_LINK_NOTE_TO_CALENDAR_EVENT',
			id: 'b7471874-1199-42df-bd78-a6f518d8f626',
		},
		eventCanceled: {
			message: 'The calendar event has been canceled.',
			code: 'CALENDAR_EVENT_CANCELED',
			id: 'fd44ba04-6922-48f3-9718-5408c7f3ff8a',
		},
		alreadyLinked: {
			message: 'The note is already linked to another calendar event.',
			code: 'NOTE_ALREADY_LINKED_TO_ANOTHER_CALENDAR_EVENT',
			id: '5b98c05e-f4ed-4cb1-889d-bf635c5b4603',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		noteId: { type: 'string', format: 'misskey:id' },
		eventId: { type: 'string', format: 'misskey:id' },
	},
	required: ['noteId', 'eventId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		private calendarEventService: CalendarEventService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const note = await this.notesRepository.findOneBy({ id: ps.noteId });
			if (note == null) throw new ApiError(meta.errors.noSuchNote);
			if (note.userId !== me.id) throw new ApiError(meta.errors.accessDenied);

			try {
				const event = await this.calendarEventService.findByIdOrFail(ps.eventId);
				assertCalendarLinkableNote(note);
				if (event.canceledAt != null) throw new CalendarEventCanceledError();
				await this.calendarEventService.linkNote(note, event.id, me);
			} catch (err) {
				throw toCalendarApiError(err, {
					notFound: meta.errors.noSuchEvent,
					permission: meta.errors.accessDenied,
					noteNotLinkable: meta.errors.cannotLinkNote,
					canceled: meta.errors.eventCanceled,
					noteAlreadyLinked: meta.errors.alreadyLinked,
				});
			}
		});
	}
}
