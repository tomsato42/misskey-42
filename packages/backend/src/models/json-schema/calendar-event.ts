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

/**
 * カレンダー配信 (iCalendar) の URL。2 つの URL は同じ鍵を使う
 */
export const packedCalendarFeedUrlsSchema = {
	type: 'object',
	properties: {
		subscribedUrl: {
			type: 'string',
			optional: false, nullable: false,
			format: 'url',
			description: 'Events you subscribe to (including your own).',
		},
		allUrl: {
			type: 'string',
			optional: false, nullable: false,
			format: 'url',
			description: 'All events.',
		},
	},
} as const;

/**
 * 購読しているイベントの通知を種類ごとに受け取るか
 */
export const packedCalendarNotificationSettingsSchema = {
	type: 'object',
	properties: {
		week: {
			type: 'boolean',
			optional: false, nullable: false,
			description: '7 days before the event, at 9:00 (Asia/Tokyo).',
		},
		day: {
			type: 'boolean',
			optional: false, nullable: false,
			description: 'The day before the event, at 9:00 (Asia/Tokyo).',
		},
		today: {
			type: 'boolean',
			optional: false, nullable: false,
			description: 'The day of the event, at 9:00 (Asia/Tokyo), or 1 hour before the start if it starts at or before 9:00.',
		},
		changes: {
			type: 'boolean',
			optional: false, nullable: false,
			description: 'When the date or time of the event changes, or the event is canceled.',
		},
	},
} as const;

/**
 * ある時点のイベントの日時 (通知で、変更前後の日時を表すのに使う)
 */
export const packedCalendarEventScheduleSchema = {
	type: 'object',
	properties: {
		date: calendarEventLiteProperties.date,
		startTime: calendarEventLiteProperties.startTime,
		endTime: calendarEventLiteProperties.endTime,
		isAllDay: calendarEventLiteProperties.isAllDay,
		startsAt: calendarEventLiteProperties.startsAt,
		endsAt: calendarEventLiteProperties.endsAt,
	},
} as const;
