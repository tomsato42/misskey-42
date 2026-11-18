/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CalendarEventService } from '@/core/calendar/CalendarEventService.js';
import { CalendarEventEntityService } from '@/core/entities/CalendarEventEntityService.js';

export const meta = {
	tags: ['calendar'],

	requireCredential: true,

	kind: 'read:account',

	description: 'List upcoming calendar events ordered by start time (for widgets). Canceled events are excluded. All-day events are upcoming until the end of the day, others until they end (or start, if they have no end time).',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'CalendarEvent',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 30, default: 5 },
		filter: {
			type: 'string',
			enum: ['all', 'subscribed', 'mine'],
			default: 'all',
			description: 'all: every event, subscribed: events you subscribe to (including your own), mine: events you created.',
		},
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private calendarEventService: CalendarEventService,
		private calendarEventEntityService: CalendarEventEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const events = await this.calendarEventService.listUpcoming(me, ps.limit, ps.filter);
			return await this.calendarEventEntityService.packMany(events, me);
		});
	}
}
