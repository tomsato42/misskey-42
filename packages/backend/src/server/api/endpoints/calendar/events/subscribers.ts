/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CalendarEventService } from '@/core/calendar/CalendarEventService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { IdService } from '@/core/IdService.js';
import { ApiError } from '@/server/api/error.js';
import { calendarModeratorViewParam } from '@/server/api/calendar-api.js';

export const meta = {
	tags: ['calendar'],

	requireCredential: true,

	kind: 'read:account',

	description: 'List the subscribers of a calendar event, excluding the creator, newest first. Suspended and deleted users are excluded.',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				id: {
					type: 'string',
					optional: false, nullable: false,
					format: 'id',
					description: 'The subscription ID (use it for sinceId / untilId).',
				},
				createdAt: {
					type: 'string',
					optional: false, nullable: false,
					format: 'date-time',
				},
				user: {
					type: 'object',
					optional: false, nullable: false,
					ref: 'UserLite',
				},
			},
		},
	},

	errors: {
		noSuchEvent: {
			message: 'No such calendar event.',
			code: 'NO_SUCH_CALENDAR_EVENT',
			id: '66935c2f-b273-477d-94ef-0e3358048e32',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		eventId: { type: 'string', format: 'misskey:id' },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
		moderatorView: calendarModeratorViewParam,
	},
	required: ['eventId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private calendarEventService: CalendarEventService,
		private userEntityService: UserEntityService,
		private idService: IdService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const event = await this.calendarEventService.findById(ps.eventId);
			if (event == null || !await this.calendarEventService.canView(event, me, { moderatorView: ps.moderatorView })) throw new ApiError(meta.errors.noSuchEvent);

			const subscriptions = await this.calendarEventService.listSubscribers(event, {
				limit: ps.limit,
				sinceId: ps.sinceId,
				untilId: ps.untilId,
			});
			if (subscriptions.length === 0) return [];

			const users = new Map((await this.userEntityService.packMany(subscriptions.map(s => s.user ?? s.userId), me)).map(u => [u.id, u]));

			return subscriptions.map(s => ({
				id: s.id,
				createdAt: this.idService.parse(s.id).date.toISOString(),
				user: users.get(s.userId)!,
			}));
		});
	}
}
