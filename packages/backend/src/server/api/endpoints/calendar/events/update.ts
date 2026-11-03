/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ms from 'ms';
import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CalendarEventService } from '@/core/calendar/CalendarEventService.js';
import { CalendarEventEntityService } from '@/core/entities/CalendarEventEntityService.js';
import { calendarEventUpdateProperties, toCalendarApiError, toCalendarEventVisibilityInput } from '@/server/api/calendar-api.js';

export const meta = {
	tags: ['calendar'],

	requireCredential: true,

	prohibitMoved: true,

	kind: 'write:account',

	limit: {
		duration: ms('1hour'),
		max: 60,
	},

	description: 'Update a calendar event. Omitted fields are left unchanged; null clears optional fields. Only the creator and moderators can update it. If the visibility changes to specified or list, the users who can newly see the event are invited.',

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'CalendarEvent',
	},

	errors: {
		noSuchEvent: {
			message: 'No such calendar event.',
			code: 'NO_SUCH_CALENDAR_EVENT',
			id: '4a76d49b-9560-4c56-b199-ba395d7f2c1f',
		},
		accessDenied: {
			message: 'You do not have permission to manage this calendar event.',
			code: 'ACCESS_DENIED',
			id: '1055669a-4b7a-4347-bdba-7549df982583',
		},
		eventCanceled: {
			message: 'The calendar event has been canceled.',
			code: 'CALENDAR_EVENT_CANCELED',
			id: 'd831c855-bc77-4673-8ebf-b1de2601613e',
		},
		invalidEvent: {
			message: 'Invalid calendar event. See info.reason for details.',
			code: 'INVALID_CALENDAR_EVENT',
			id: '13a37cc3-39ee-4367-883e-878c19e69e02',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		eventId: { type: 'string', format: 'misskey:id' },
		...calendarEventUpdateProperties,
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
				// 管理の操作なので、モデレーター以上は公開範囲に関係なくできる
				const event = await this.calendarEventService.findVisibleByIdOrFail(ps.eventId, me, { moderatorView: true });
				const { event: updated } = await this.calendarEventService.update(event, {
					title: ps.title,
					date: ps.date,
					startTime: ps.startTime,
					endTime: ps.endTime,
					isAllDay: ps.isAllDay,
					location: ps.location,
					description: ps.description,
					hashtag: ps.hashtag,
				}, me, toCalendarEventVisibilityInput(ps));
				return await this.calendarEventEntityService.pack(updated, me);
			} catch (err) {
				throw toCalendarApiError(err, {
					notFound: meta.errors.noSuchEvent,
					permission: meta.errors.accessDenied,
					canceled: meta.errors.eventCanceled,
					validation: meta.errors.invalidEvent,
				});
			}
		});
	}
}
