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
		max: 60,
	},

	description: 'Cancel a calendar event. The event remains with isCanceled set. Only the creator and moderators can cancel it.',

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'CalendarEvent',
	},

	errors: {
		noSuchEvent: {
			message: 'No such calendar event.',
			code: 'NO_SUCH_CALENDAR_EVENT',
			id: 'd12d9bd1-4a34-41f8-8821-ac06f1efc844',
		},
		accessDenied: {
			message: 'You do not have permission to manage this calendar event.',
			code: 'ACCESS_DENIED',
			id: 'f70e5f07-dcb0-4727-81e4-9c925d4439bb',
		},
		eventCanceled: {
			message: 'The calendar event has already been canceled.',
			code: 'CALENDAR_EVENT_CANCELED',
			id: '58426b92-8f54-409b-82dd-ce8617828dae',
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
				// 公開範囲の外のイベントは、存在しないのと同じエラーにする (権限のエラーで存在が分からないように)
				const event = await this.calendarEventService.findVisibleByIdOrFail(ps.eventId, me);
				const canceled = await this.calendarEventService.cancel(event, me);
				return await this.calendarEventEntityService.pack(canceled, me);
			} catch (err) {
				throw toCalendarApiError(err, {
					notFound: meta.errors.noSuchEvent,
					permission: meta.errors.accessDenied,
					canceled: meta.errors.eventCanceled,
				});
			}
		});
	}
}
