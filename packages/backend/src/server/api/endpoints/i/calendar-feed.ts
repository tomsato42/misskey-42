/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CalendarFeedService } from '@/core/calendar/CalendarFeedService.js';

export const meta = {
	tags: ['account', 'calendar'],

	requireCredential: true,

	// 配信の URL はログインせずにイベントを見られる鍵なので、公式のクライアントだけが取れるようにする
	secure: true,

	kind: 'read:account',

	limit: {
		duration: 1000 * 60 * 60,
		max: 60,
	},

	description: 'Get the calendar feed (iCalendar) URLs of your account. A feed token is created if you do not have one yet. Anyone who knows the URLs can see the events without signing in.',

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'CalendarFeedUrls',
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
		private calendarFeedService: CalendarFeedService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const token = await this.calendarFeedService.getOrCreateToken(me.id);
			return this.calendarFeedService.buildUrls(token);
		});
	}
}
