/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CalendarEventService } from '@/core/calendar/CalendarEventService.js';
import { CalendarEventEntityService } from '@/core/entities/CalendarEventEntityService.js';
import { ApiError } from '@/server/api/error.js';
import { calendarModeratorViewParam } from '@/server/api/calendar-api.js';

export const meta = {
	tags: ['calendar'],

	requireCredential: true,

	kind: 'read:account',

	description: 'Show a calendar event. Canceled events are also returned (with isCanceled set). Events outside your visibility are treated as not found, except for moderators with moderatorView.',

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'CalendarEvent',
	},

	errors: {
		noSuchEvent: {
			message: 'No such calendar event.',
			code: 'NO_SUCH_CALENDAR_EVENT',
			id: '14d2357d-a3a3-4f49-b23a-ca7c0d19fe31',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		eventId: { type: 'string', format: 'misskey:id' },
		moderatorView: calendarModeratorViewParam,
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
			const event = await this.calendarEventService.findById(ps.eventId);
			// 公開範囲の外のイベントは、存在しないときと同じエラーにする
			if (event == null || !await this.calendarEventService.canView(event, me, { moderatorView: ps.moderatorView })) throw new ApiError(meta.errors.noSuchEvent);
			return await this.calendarEventEntityService.pack(event, me, undefined, { detail: true, moderatorView: ps.moderatorView });
		});
	}
}
