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

	prohibitMoved: true,

	kind: 'write:account',

	limit: {
		duration: ms('1hour'),
		max: 300,
	},

	description: 'Unsubscribe from a calendar event. Does nothing if not subscribed. The creator cannot unsubscribe.',

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'CalendarEvent',
	},

	errors: {
		noSuchEvent: {
			message: 'No such calendar event.',
			code: 'NO_SUCH_CALENDAR_EVENT',
			id: 'c0c8b27b-3858-4ef0-9c13-c255a97be389',
		},
		cannotUnsubscribeOwnEvent: {
			message: 'The creator of the calendar event cannot unsubscribe from it.',
			code: 'CANNOT_UNSUBSCRIBE_OWN_CALENDAR_EVENT',
			id: '50299446-02a9-485e-8c3c-2f1c02680cf6',
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
				await this.calendarEventService.unsubscribe(event, me);
				return await this.calendarEventEntityService.pack(event, me, { isSubscribed: false });
			} catch (err) {
				throw toCalendarApiError(err, {
					notFound: meta.errors.noSuchEvent,
					cannotUnsubscribeOwn: meta.errors.cannotUnsubscribeOwnEvent,
				});
			}
		});
	}
}
