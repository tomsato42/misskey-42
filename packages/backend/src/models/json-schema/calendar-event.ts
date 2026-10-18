/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 日付と時刻は日本時間 (Asia/Tokyo)。startsAt / endsAt は同じ日時を ISO 8601 (UTC) で表したもの

const calendarEventLiteProperties = {
	id: {
		type: 'string',
		optional: false, nullable: false,
		format: 'id',
		example: 'xxxxxxxxxx',
	},
	title: {
		type: 'string',
		optional: false, nullable: false,
	},
	date: {
		type: 'string',
		optional: false, nullable: false,
		description: 'YYYY-MM-DD (Asia/Tokyo)',
		example: '2026-10-20',
	},
	startTime: {
		type: 'string',
		optional: false, nullable: true,
		description: 'HH:mm (Asia/Tokyo). null if the event is all-day.',
		example: '12:00',
	},
	endTime: {
		type: 'string',
		optional: false, nullable: true,
		description: 'HH:mm (Asia/Tokyo). null if the event is all-day or has no end time.',
		example: '13:00',
	},
	isAllDay: {
		type: 'boolean',
		optional: false, nullable: false,
	},
	startsAt: {
		type: 'string',
		optional: false, nullable: false,
		format: 'date-time',
	},
	endsAt: {
		type: 'string',
		optional: false, nullable: true,
		format: 'date-time',
	},
	location: {
		type: 'string',
		optional: false, nullable: true,
	},
	isCanceled: {
		type: 'boolean',
		optional: false, nullable: false,
	},
	subscribersCount: {
		type: 'integer',
		optional: false, nullable: false,
	},
	isSubscribed: {
		type: 'boolean',
		optional: true, nullable: false,
		description: 'Only present when the viewer is signed in.',
	},
} as const;

/**
 * ノートに付けるイベントの軽量版
 */
export const packedCalendarEventLiteSchema = {
	type: 'object',
	properties: calendarEventLiteProperties,
} as const;

export const packedCalendarEventSchema = {
	type: 'object',
	properties: {
		...calendarEventLiteProperties,
		createdAt: {
			type: 'string',
			optional: false, nullable: false,
			format: 'date-time',
		},
		updatedAt: {
			type: 'string',
			optional: false, nullable: true,
			format: 'date-time',
		},
		userId: {
			type: 'string',
			optional: false, nullable: false,
			format: 'id',
		},
		user: {
			type: 'object',
			ref: 'UserLite',
			optional: false, nullable: false,
		},
		description: {
			type: 'string',
			optional: false, nullable: true,
		},
		hashtag: {
			type: 'string',
			optional: false, nullable: true,
			description: 'Without the leading #.',
		},
		canceledAt: {
			type: 'string',
			optional: false, nullable: true,
			format: 'date-time',
		},
		announcementNoteId: {
			type: 'string',
			optional: false, nullable: true,
			format: 'id',
		},
		canManage: {
			type: 'boolean',
			optional: true, nullable: false,
			description: 'Whether the viewer can edit, cancel or delete the event. Only present when the viewer is signed in.',
		},
	},
} as const;
