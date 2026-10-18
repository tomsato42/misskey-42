/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CalendarEventService } from '@/core/calendar/CalendarEventService.js';
import { CalendarEventEntityService } from '@/core/entities/CalendarEventEntityService.js';
import { CALENDAR_EVENT_CREATE_LIMIT } from '@/core/calendar/calendar-limits.js';
import { calendarEventCreateProperties, toCalendarApiError, toCalendarEventInput } from '@/server/api/calendar-api.js';

export const meta = {
	tags: ['calendar'],

	requireCredential: true,

	prohibitMoved: true,

	kind: 'write:account',

	// notes/create でノートと一緒に作るときも、同じ上限を CalendarNotePostService で確かめる
	limit: CALENDAR_EVENT_CREATE_LIMIT,

	description: 'Create a calendar event. The creator is subscribed to it automatically.',

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'CalendarEvent',
	},

	errors: {
		invalidEvent: {
			message: 'Invalid calendar event. See info.reason for details.',
			code: 'INVALID_CALENDAR_EVENT',
			id: 'b48e0f85-835e-4c35-a8f3-a5c520d3727d',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: calendarEventCreateProperties,
	required: ['title', 'date'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private calendarEventService: CalendarEventService,
		private calendarEventEntityService: CalendarEventEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const event = await this.calendarEventService.create(me, toCalendarEventInput(ps));
				// 作ったばかりのイベントの購読者は作成者だけ
				return await this.calendarEventEntityService.pack(event, me, { subscribersCount: 1, isSubscribed: true, canManage: true });
			} catch (err) {
				throw toCalendarApiError(err, {
					validation: meta.errors.invalidEvent,
				});
			}
		});
	}
}
