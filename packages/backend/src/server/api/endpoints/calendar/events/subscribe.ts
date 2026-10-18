/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ms from 'ms';
import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CalendarEventService } from '@/core/calendar/CalendarEventService.js';
import { CalendarEventEntityService } from '@/core/entities/CalendarEventEntityService.js';
import { toCalendarApiError } from '@/server/api/calendar-api.js';

export const meta = {
	tags: ['calendar'],

	requireCredential: true,

	kind: 'write:account',

	limit: {
		duration: ms('1hour'),
		max: 300,
	},

	description: 'Subscribe to a calendar event. Does nothing if already subscribed.',

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'CalendarEvent',
	},

	errors: {
		noSuchEvent: {
			message: 'No such calendar event.',
			code: 'NO_SUCH_CALENDAR_EVENT',
			id: '7ca24a7a-de71-4aa9-84da-160776c9a929',
		},
		eventCanceled: {
			message: 'The calendar event has been canceled.',
			code: 'CALENDAR_EVENT_CANCELED',
			id: '959f2887-4596-498a-ae47-0581f6bc862e',
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
		private calendarEventEntityService: CalendarEventEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const event = await this.calendarEventService.findByIdOrFail(ps.eventId);
				await this.calendarEventService.subscribe(event, me);
				return await this.calendarEventEntityService.pack(event, me, { isSubscribed: true });
			} catch (err) {
				throw toCalendarApiError(err, {
					notFound: meta.errors.noSuchEvent,
					canceled: meta.errors.eventCanceled,
				});
			}
		});
	}
}
