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

	// 配信の URL はログインせずにイベントを見られる鍵なので、公式のクライアントだけが作り直せるようにする
	secure: true,

	kind: 'write:account',

	limit: {
		duration: 1000 * 60 * 60,
		max: 10,
	},

	description: 'Regenerate the calendar feed token. The old feed URLs stop working.',

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
			const token = await this.calendarFeedService.regenerateToken(me.id);
			return this.calendarFeedService.buildUrls(token);
		});
	}
}
