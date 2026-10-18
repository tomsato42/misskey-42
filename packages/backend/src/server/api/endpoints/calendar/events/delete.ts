/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ms from 'ms';
import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CalendarEventService } from '@/core/calendar/CalendarEventService.js';
import { toCalendarApiError } from '@/server/api/calendar-api.js';

export const meta = {
	tags: ['calendar'],

	requireCredential: true,

	kind: 'write:account',

	limit: {
		duration: ms('1hour'),
		max: 60,
	},

	description: 'Delete a calendar event. Linked notes are kept. Only the creator and moderators can delete it.',

	errors: {
		noSuchEvent: {
			message: 'No such calendar event.',
			code: 'NO_SUCH_CALENDAR_EVENT',
			id: '5affb905-2875-4fec-af6b-6850012a299f',
		},
		accessDenied: {
			message: 'You do not have permission to manage this calendar event.',
			code: 'ACCESS_DENIED',
			id: '714f14ea-c6b0-42f9-8f1a-d8fbc21c62ce',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		eventId: { type: 'string', format: 'misskey:id' },
	},
	required: ['eventId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private calendarEventService: CalendarEventService,
	) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const event = await this.calendarEventService.findByIdOrFail(ps.eventId);
				await this.calendarEventService.delete(event, me);
			} catch (err) {
				throw toCalendarApiError(err, {
					notFound: meta.errors.noSuchEvent,
					permission: meta.errors.accessDenied,
				});
			}
		});
	}
}
