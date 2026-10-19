/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ms from 'ms';
import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CalendarEventService } from '@/core/calendar/CalendarEventService.js';
import { CalendarInvitationService } from '@/core/calendar/CalendarInvitationService.js';
import { toCalendarApiError } from '@/server/api/calendar-api.js';

export const meta = {
	tags: ['calendar'],

	requireCredential: true,

	prohibitMoved: true,

	kind: 'write:account',

	// 1 回で最大 200 人に送れるので、回数は少なめにする
	limit: {
		duration: ms('1hour'),
		max: 30,
	},

	description: 'Invite users and/or the members of one of your lists to a calendar event. Subscribers can invite to public, followers and mutual events; the creator and moderators can invite to any event. Each user is invited only once (by whoever invites first) and gets a calendarEventInvited notification. Subscribed users and users who cannot see the event are skipped. Up to 200 users (including the list members) are processed per call. With dryRun, nothing is saved and the counts are returned.',

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			invited: {
				type: 'integer',
				optional: false, nullable: false,
				description: 'The number of users invited (with dryRun, the number of users who would be invited).',
			},
			subscribed: {
				type: 'integer',
				optional: false, nullable: false,
				description: 'Skipped because they already subscribe (including the creator).',
			},
			alreadyInvited: {
				type: 'integer',
				optional: false, nullable: false,
				description: 'Skipped because they have already been invited.',
			},
			unavailable: {
				type: 'integer',
				optional: false, nullable: false,
				description: 'Skipped because they cannot see the event, are suspended or deleted, or are you.',
			},
		},
	},

	errors: {
		noSuchEvent: {
			message: 'No such calendar event.',
			code: 'NO_SUCH_CALENDAR_EVENT',
			id: '983c16f8-0bed-49ec-92f6-2a639172d2e0',
		},
		accessDenied: {
			message: 'You cannot invite users to this calendar event.',
			code: 'ACCESS_DENIED',
			id: 'ffe95d7b-cf6b-4975-8d4c-d2d9443e3bf8',
		},
		eventCanceled: {
			message: 'The calendar event has been canceled.',
			code: 'CALENDAR_EVENT_CANCELED',
			id: '8873aebe-3ee9-4ce7-83df-d20af01cd98d',
		},
		noSuchList: {
			message: 'No such list.',
			code: 'NO_SUCH_LIST',
			id: 'ad4767f7-72d5-4995-bc83-c194c0aa350c',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		eventId: { type: 'string', format: 'misskey:id' },
		userIds: {
			type: 'array', uniqueItems: true, maxItems: 100,
			items: { type: 'string', format: 'misskey:id' },
		},
		userListId: { type: 'string', format: 'misskey:id', nullable: true, description: 'One of your lists.' },
		dryRun: { type: 'boolean', default: false },
	},
	required: ['eventId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private calendarEventService: CalendarEventService,
		private calendarInvitationService: CalendarInvitationService,
	) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const event = await this.calendarEventService.findVisibleByIdOrFail(ps.eventId, me);
				return await this.calendarInvitationService.invite(event, me, {
					userIds: ps.userIds,
					userListId: ps.userListId,
					dryRun: ps.dryRun,
				});
			} catch (err) {
				throw toCalendarApiError(err, {
					notFound: meta.errors.noSuchEvent,
					permission: meta.errors.accessDenied,
					canceled: meta.errors.eventCanceled,
					userListNotFound: meta.errors.noSuchList,
				});
			}
		});
	}
}
