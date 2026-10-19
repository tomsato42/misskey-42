/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 日付と時刻は日本時間 (Asia/Tokyo)。startsAt / endsAt は同じ日時を ISO 8601 (UTC) で表したもの

import { calendarEventVisibilities } from '@/core/calendar/calendar-visibility.js';

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
	visibility: {
		type: 'string',
		optional: false, nullable: false,
		enum: calendarEventVisibilities,
		description: 'public: everyone, followers: followers of the creator, mutual: mutual followers of the creator, specified: the specified users, list: members of the creator\'s list. The creator and moderators can always see the event.',
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
		visibleUserIds: {
			type: 'array',
			optional: true, nullable: false,
			items: {
				type: 'string',
				optional: false, nullable: false,
				format: 'id',
			},
			description: 'The users who can see the event when visibility is specified (excluding the creator). Only present when the viewer can manage the event.',
		},
		userListId: {
			type: 'string',
			optional: true, nullable: true,
			format: 'id',
			description: 'The list whose members can see the event when visibility is list. null if visibility is not list or the list has been deleted. Only present when the viewer can manage the event.',
		},
		subscribersPreview: {
			type: 'array',
			optional: true, nullable: false,
			items: {
				type: 'object',
				ref: 'UserLite',
				optional: false, nullable: false,
			},
			description: 'Up to 5 subscribers, the users you follow first. Only present in calendar/events/show.',
		},
		followingSubscribersCount: {
			type: 'integer',
			optional: true, nullable: false,
			description: 'The number of subscribers you follow (excluding the creator). Only present in calendar/events/show.',
		},
		invitedBy: {
			type: 'object',
			ref: 'UserLite',
			optional: true, nullable: true,
			description: 'The user who invited you to the event. null if you are not invited. Only present in calendar/events/show.',
		},
		canInvite: {
			type: 'boolean',
			optional: true, nullable: false,
			description: 'Whether you can invite users to the event (see calendar/events/invite). This does not take cancellation into account. Only present in calendar/events/show.',
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
 * カレンダーの通知を種類ごとに受け取るか (invited 以外は購読しているイベントの通知)
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
		invited: {
			type: 'boolean',
			optional: false, nullable: false,
			description: 'When someone invites you to an event.',
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
