/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import type { FollowingsRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CalendarEventService } from '@/core/calendar/CalendarEventService.js';
import { CalendarVisibilityService } from '@/core/calendar/CalendarVisibilityService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { IdService } from '@/core/IdService.js';
import { ApiError } from '@/server/api/error.js';
import { DI } from '@/di-symbols.js';

export const meta = {
	tags: ['calendar'],

	requireCredential: true,

	kind: 'read:account',

	description: 'List the subscribers of a calendar event, excluding the creator, newest first. Suspended and deleted users are excluded. The subscribers of a followers (or mutual) event are followers (and followees) of the creator, so only the creator and moderators can list them when the creator hides their followers (or following) list.',

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
				isFollowing: {
					type: 'boolean',
					optional: false, nullable: false,
					description: 'Whether you follow the user.',
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

		accessDenied: {
			message: 'The creator of the event hides the subscribers.',
			code: 'ACCESS_DENIED',
			id: '29512b09-ecf2-4195-bf36-122d3990f83a',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		eventId: { type: 'string', format: 'misskey:id' },
		filter: {
			type: 'string',
			enum: ['all', 'following'],
			default: 'all',
			description: 'all: every subscriber, following: subscribers you follow.',
		},
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
	},
	required: ['eventId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.followingsRepository)
		private followingsRepository: FollowingsRepository,

		private calendarEventService: CalendarEventService,
		private calendarVisibilityService: CalendarVisibilityService,
		private userEntityService: UserEntityService,
		private idService: IdService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const event = await this.calendarEventService.findById(ps.eventId);
			if (event == null || !await this.calendarEventService.canView(event, me)) throw new ApiError(meta.errors.noSuchEvent);
			if (!await this.calendarVisibilityService.canViewSubscribers(event, me)) throw new ApiError(meta.errors.accessDenied);

			const subscriptions = await this.calendarEventService.listSubscribers(event, me, {
				filter: ps.filter,
				limit: ps.limit,
				sinceId: ps.sinceId,
				untilId: ps.untilId,
			});
			if (subscriptions.length === 0) return [];

			const userIds = subscriptions.map(s => s.userId);
			const [users, followings] = await Promise.all([
				this.userEntityService.packMany(subscriptions.map(s => s.user ?? s.userId), me)
					.then(packed => new Map(packed.map(u => [u.id, u]))),
				ps.filter === 'following'
					? Promise.resolve(null)
					: this.followingsRepository.find({ where: { followerId: me.id, followeeId: In(userIds) }, select: { followeeId: true } })
						.then(rows => new Set(rows.map(r => r.followeeId))),
			]);

			return subscriptions.map(s => ({
				id: s.id,
				createdAt: this.idService.parse(s.id).date.toISOString(),
				user: users.get(s.userId)!,
				isFollowing: followings == null || followings.has(s.userId),
			}));
		});
	}
}
