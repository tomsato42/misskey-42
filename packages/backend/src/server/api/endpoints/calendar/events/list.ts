/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { CalendarEventService } from '@/core/calendar/CalendarEventService.js';
import { CalendarEventEntityService } from '@/core/entities/CalendarEventEntityService.js';
import { getJstMonthRange } from '@/core/calendar/calendar-time.js';
import { CalendarEventValidationError } from '@/core/calendar/calendar-errors.js';
import { ApiError } from '@/server/api/error.js';
import { calendarModeratorViewParam } from '@/server/api/calendar-api.js';

export const meta = {
	tags: ['calendar'],

	requireCredential: true,

	kind: 'read:account',

	description: 'List calendar events starting in the given month (Asia/Tokyo), ordered by start time. Canceled events are included.',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'CalendarEvent',
		},
	},

	errors: {
		invalidMonth: {
			message: 'Invalid month. Use the YYYY-MM format.',
			code: 'INVALID_MONTH',
			id: '988bcea4-f638-4271-a1bc-6478f1a84328',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		month: { type: 'string', maxLength: 32, description: 'YYYY-MM (Asia/Tokyo).' },
		filter: {
			type: 'string',
			enum: ['all', 'subscribed', 'mine'],
			default: 'all',
			description: 'all: every event, subscribed: events you subscribe to (including your own), mine: events you created.',
		},
		moderatorView: calendarModeratorViewParam,
	},
	required: ['month'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private calendarEventService: CalendarEventService,
		private calendarEventEntityService: CalendarEventEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			let range: { from: Date; to: Date };
			try {
				range = getJstMonthRange(ps.month);
			} catch (err) {
				if (err instanceof CalendarEventValidationError) throw new ApiError(meta.errors.invalidMonth);
				throw err;
			}

			const events = await this.calendarEventService.listInRange(range.from, range.to, ps.filter, me, { moderatorView: ps.moderatorView });
			return await this.calendarEventEntityService.packMany(events, me, { moderatorView: ps.moderatorView });
		});
	}
}
