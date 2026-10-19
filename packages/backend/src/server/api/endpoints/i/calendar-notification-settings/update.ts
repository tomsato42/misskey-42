/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { UserProfilesRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CacheService } from '@/core/CacheService.js';
import { normalizeCalendarNotificationSettings } from '@/core/calendar/calendar-notification.js';
import { DI } from '@/di-symbols.js';

export const meta = {
	tags: ['account', 'calendar'],

	requireCredential: true,

	kind: 'write:account',

	limit: {
		duration: 1000 * 60 * 60,
		max: 60,
	},

	description: 'Change which calendar notifications you receive (reminders and changes of the events you subscribe to, and invitations). Omitted items are left unchanged.',

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'CalendarNotificationSettings',
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		week: { type: 'boolean' },
		day: { type: 'boolean' },
		today: { type: 'boolean' },
		changes: { type: 'boolean' },
		invited: { type: 'boolean' },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private cacheService: CacheService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const profile = await this.userProfilesRepository.findOneOrFail({
				where: { userId: me.id },
				select: { userId: true, calendarNotificationSettings: true },
			});
			const settings = normalizeCalendarNotificationSettings({
				...normalizeCalendarNotificationSettings(profile.calendarNotificationSettings),
				...Object.fromEntries(Object.entries(ps).filter(([, v]) => v !== undefined)),
			});

			await this.userProfilesRepository.update({ userId: me.id }, { calendarNotificationSettings: settings });
			// 通知を送る処理は DB から直接読むが、キャッシュにも古い値を残さない
			await this.cacheService.userProfileCache.delete(me.id);

			return settings;
		});
	}
}
