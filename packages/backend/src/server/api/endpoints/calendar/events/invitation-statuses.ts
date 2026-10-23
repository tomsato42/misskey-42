/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CalendarEventService } from '@/core/calendar/CalendarEventService.js';
import { CalendarInvitationService, calendarInvitationStatuses } from '@/core/calendar/CalendarInvitationService.js';
import { CalendarEventPermissionError } from '@/core/calendar/calendar-errors.js';
import { toCalendarApiError } from '@/server/api/calendar-api.js';

export const meta = {
	tags: ['calendar'],

	requireCredential: true,

	kind: 'read:account',

	description: 'Get whether you can invite each user to a calendar event. Only those who can invite to the event (see calendar/events/invite) can use this.',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				userId: {
					type: 'string',
					optional: false, nullable: false,
					format: 'id',
				},
				status: {
					type: 'string',
					optional: false, nullable: false,
					enum: calendarInvitationStatuses,
					description: 'invitable: you can invite the user, subscribed: the user subscribes (including the creator), invited: the user has already been invited, unavailable: you cannot invite the user (yourself, or the user cannot see the event, or is suspended or deleted).',
				},
			},
		},
	},

	errors: {
		noSuchEvent: {
			message: 'No such calendar event.',
			code: 'NO_SUCH_CALENDAR_EVENT',
			id: '3fe65baa-d325-4863-8fe7-3f384762647f',
		},
		accessDenied: {
			message: 'You cannot invite users to this calendar event.',
			code: 'ACCESS_DENIED',
			id: 'e0a93603-1026-4c20-b625-74f569937d68',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		eventId: { type: 'string', format: 'misskey:id' },
		userIds: {
			type: 'array', uniqueItems: true, minItems: 1, maxItems: 100,
			items: { type: 'string', format: 'misskey:id' },
		},
	},
	required: ['eventId', 'userIds'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private calendarEventService: CalendarEventService,
		private calendarInvitationService: CalendarInvitationService,
	) {
		super(meta, paramDef, async (ps, me) => {
			try {
				// 管理の操作なので、モデレーター以上は公開範囲に関係なくできる
				const event = await this.calendarEventService.findVisibleByIdOrFail(ps.eventId, me, { moderatorView: true });
				// 誰が招待されているかを、招待できない人には見せない
				if (!await this.calendarInvitationService.canInvite(event, me)) throw new CalendarEventPermissionError();

				const statuses = await this.calendarInvitationService.getStatuses(event, me, ps.userIds);
				return ps.userIds.map(userId => ({ userId, status: statuses.get(userId) ?? 'unavailable' }));
			} catch (err) {
				throw toCalendarApiError(err, {
					notFound: meta.errors.noSuchEvent,
					permission: meta.errors.accessDenied,
				});
			}
		});
	}
}
