/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { UserProfilesRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { normalizeCalendarNotificationSettings } from '@/core/calendar/calendar-notification.js';
import { DI } from '@/di-symbols.js';

export const meta = {
	tags: ['account', 'calendar'],

	requireCredential: true,

	kind: 'read:account',

	description: 'Get which calendar notifications you receive (reminders and changes of the events you subscribe to, and invitations).',

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'CalendarNotificationSettings',
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,
	) {
		super(meta, paramDef, async (ps, me) => {
			const profile = await this.userProfilesRepository.findOneOrFail({
				where: { userId: me.id },
				select: { userId: true, calendarNotificationSettings: true },
			});
			return normalizeCalendarNotificationSettings(profile.calendarNotificationSettings);
		});
	}
}
