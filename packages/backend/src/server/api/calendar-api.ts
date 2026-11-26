/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// カレンダーの API (endpoints/calendar/ と notes/create) で共有する paramDef の部品とエラーの変換

import {
	CalendarError,
	CalendarEventCanceledError,
	CalendarEventCannotUnsubscribeOwnError,
	CalendarEventNoteAlreadyLinkedError,
	CalendarEventNoteNotLinkedError,
	CalendarEventNotFoundError,
	CalendarEventPermissionError,
	CalendarEventRateLimitError,
	CalendarEventValidationError,
	CalendarNoteNotLinkableError,
	CalendarNoteParamsConflictError,
	CalendarUserListNotFoundError,
} from '@/core/calendar/calendar-errors.js';
import { CALENDAR_EVENT_VISIBLE_USERS_MAX, calendarEventVisibilities } from '@/core/calendar/calendar-visibility.js';
import type { CalendarEventInput } from '@/core/calendar/calendar-event-input.js';
import type { CalendarEventVisibility, CalendarEventVisibilityInput } from '@/core/calendar/calendar-visibility.js';
import { ApiError } from './error.js';

// 文字数などの細かい検証は core/calendar/calendar-event-input.ts で行い、理由 (reason) 付きのエラーにする。
// ここの maxLength は極端に大きな入力を弾くためだけのもの
const calendarEventFieldProperties = {
	title: { type: 'string', maxLength: 1024, description: 'Required. Up to 100 characters after trimming.' },
	date: { type: 'string', maxLength: 32, description: 'YYYY-MM-DD (Asia/Tokyo).' },
	startTime: { type: 'string', nullable: true, maxLength: 32, description: 'HH:mm (Asia/Tokyo). Required unless isAllDay is true.' },
	endTime: { type: 'string', nullable: true, maxLength: 32, description: 'HH:mm (Asia/Tokyo). Must be after startTime on the same day. Ignored if isAllDay is true.' },
	location: { type: 'string', nullable: true, maxLength: 1024, description: 'Up to 128 characters.' },
	description: { type: 'string', nullable: true, maxLength: 16384, description: 'MFM. Up to 3000 characters.' },
	hashtag: { type: 'string', nullable: true, maxLength: 1024, description: 'A single hashtag. The leading # is optional.' },
} as const;

const calendarEventVisibilityFieldProperties = {
	visibleUserIds: {
		type: 'array', nullable: true, uniqueItems: true, maxItems: CALENDAR_EVENT_VISIBLE_USERS_MAX,
		items: { type: 'string', format: 'misskey:id' },
		description: 'Required when visibility is specified. Local users other than the creator. The users are invited to the event.',
	},
	userListId: {
		type: 'string', format: 'misskey:id', nullable: true,
		description: 'Required when visibility is list. One of the creator\'s lists. The members are invited to the event.',
	},
} as const;

const calendarEventVisibilityDescription = 'public: everyone, followers: your followers, mutual: your mutual followers, specified: visibleUserIds, list: members of userListId.';

/** イベントを作るときのパラメータ (calendar/events/create と notes/create の calendarEvent) */
export const calendarEventCreateProperties = {
	...calendarEventFieldProperties,
	isAllDay: { type: 'boolean', default: false },
	visibility: { type: 'string', enum: calendarEventVisibilities, default: 'public', description: calendarEventVisibilityDescription },
	...calendarEventVisibilityFieldProperties,
} as const;

/** イベントを編集するときのパラメータ。省略した項目は変えない */
export const calendarEventUpdateProperties = {
	...calendarEventFieldProperties,
	isAllDay: { type: 'boolean' },
	visibility: { type: 'string', enum: calendarEventVisibilities, description: `${calendarEventVisibilityDescription} Narrowing it unsubscribes the users who can no longer see the event.` },
	...calendarEventVisibilityFieldProperties,
} as const;

type CalendarEventCreateParams = {
	title: string;
	date: string;
	startTime?: string | null;
	endTime?: string | null;
	isAllDay?: boolean;
	location?: string | null;
	description?: string | null;
	hashtag?: string | null;
};

/**
 * 管理人ビューのパラメータ。モデレーター以上が true にすると、公開範囲の外のイベントも見られる (ほかの人には効かない)。
 * 編集・中止・削除・招待などの管理の操作は、これが無くてもモデレーター以上なら公開範囲に関係なくできる
 */
export const calendarModeratorViewParam = {
	type: 'boolean',
	default: false,
	description: 'Moderators only: also show events outside your visibility (the moderator view). Ignored for other users.',
} as const;

/** API のパラメータから公開範囲の入力を取り出す。省略 (undefined) は「変えない」なので、そのまま渡す */
export function toCalendarEventVisibilityInput(ps: {
	visibility?: CalendarEventVisibility;
	visibleUserIds?: string[] | null;
	userListId?: string | null;
}): CalendarEventVisibilityInput {
	return {
		visibility: ps.visibility,
		visibleUserIds: ps.visibleUserIds,
		userListId: ps.userListId,
	};
}

/** API のパラメータを CalendarEventInput にする。description は省略 (undefined) を区別するため、そのまま渡す */
export function toCalendarEventInput(ps: CalendarEventCreateParams): CalendarEventInput {
	return {
		title: ps.title,
		date: ps.date,
		startTime: ps.startTime,
		endTime: ps.endTime,
		isAllDay: ps.isAllDay,
		location: ps.location,
		description: ps.description,
		hashtag: ps.hashtag,
	};
}

type ApiErrorDefinition = ConstructorParameters<typeof ApiError>[0] & {};

export type CalendarApiErrorMap = {
	notFound?: ApiErrorDefinition;
	permission?: ApiErrorDefinition;
	canceled?: ApiErrorDefinition;
	cannotUnsubscribeOwn?: ApiErrorDefinition;
	noteAlreadyLinked?: ApiErrorDefinition;
	noteNotLinked?: ApiErrorDefinition;
	noteNotLinkable?: ApiErrorDefinition;
	validation?: ApiErrorDefinition;
	paramsConflict?: ApiErrorDefinition;
	rateLimit?: ApiErrorDefinition;
	userListNotFound?: ApiErrorDefinition;
};

/**
 * カレンダーのサービスが投げたエラーを、エンドポイントの meta.errors にある API エラーに変える。
 * 対応が無いもの (想定外のエラー) はそのまま返すので、catch で `throw toCalendarApiError(err, {...})` と書く。
 * 検証エラーと紐づけられないノートのエラーは、理由を info.reason に入れる
 */
export function toCalendarApiError(err: unknown, map: CalendarApiErrorMap): unknown {
	if (!(err instanceof CalendarError)) return err;

	if (err instanceof CalendarEventNotFoundError && map.notFound) return new ApiError(map.notFound);
	if (err instanceof CalendarEventPermissionError && map.permission) return new ApiError(map.permission);
	if (err instanceof CalendarEventCanceledError && map.canceled) return new ApiError(map.canceled);
	if (err instanceof CalendarEventCannotUnsubscribeOwnError && map.cannotUnsubscribeOwn) return new ApiError(map.cannotUnsubscribeOwn);
	if (err instanceof CalendarEventNoteAlreadyLinkedError && map.noteAlreadyLinked) return new ApiError(map.noteAlreadyLinked);
	if (err instanceof CalendarEventNoteNotLinkedError && map.noteNotLinked) return new ApiError(map.noteNotLinked);
	if (err instanceof CalendarNoteNotLinkableError && map.noteNotLinkable) return new ApiError(map.noteNotLinkable, { reason: err.reason });
	if (err instanceof CalendarEventValidationError && map.validation) return new ApiError(map.validation, { reason: err.reason });
	if (err instanceof CalendarNoteParamsConflictError && map.paramsConflict) return new ApiError(map.paramsConflict);
	// ApiCallService のレート制限と同じく、info.resetMs から Retry-After ヘッダーが付く
	if (err instanceof CalendarEventRateLimitError && map.rateLimit) return new ApiError(map.rateLimit, { resetMs: err.resetMs, reset: Math.ceil(err.resetMs / 1000) });
	if (err instanceof CalendarUserListNotFoundError && map.userListNotFound) return new ApiError(map.userListNotFound);

	return err;
}

//#region notes/create

/** notes/create に足すパラメータ */
export const calendarNoteCreateProperties = {
	calendarEventId: {
		type: 'string', format: 'misskey:id', nullable: true,
		description: '42times: Link the note to an existing calendar event. Cannot be used with calendarEvent.',
	},
	calendarEvent: {
		type: 'object', nullable: true,
		description: '42times: Create a calendar event announced by the note. If description is omitted, the note text is used (unless the note has a CW). Cannot be used with calendarEventId.',
		properties: calendarEventCreateProperties,
		required: ['title', 'date'],
	},
} as const;

/** notes/create に足すエラー */
export const calendarNoteCreateErrors = {
	noSuchCalendarEvent: {
		message: 'No such calendar event.',
		code: 'NO_SUCH_CALENDAR_EVENT',
		id: '1c9aa98b-9663-4249-b6f5-59d575bd7db0',
	},
	calendarEventCanceled: {
		message: 'The calendar event has been canceled.',
		code: 'CALENDAR_EVENT_CANCELED',
		id: '6f2f511f-a971-4bbb-be0c-7e41eda7a349',
	},
	invalidCalendarEvent: {
		message: 'Invalid calendar event. See info.reason for details.',
		code: 'INVALID_CALENDAR_EVENT',
		id: '2bc06ea8-a7f7-40e2-b310-cd4d28e48ead',
	},
	cannotLinkNoteToCalendarEvent: {
		message: 'This note cannot be linked to a calendar event. See info.reason for details.',
		code: 'CANNOT_LINK_NOTE_TO_CALENDAR_EVENT',
		id: '099253c5-72a0-40b9-bb4e-80fa536263c5',
	},
	calendarEventParamsConflict: {
		message: 'calendarEventId and calendarEvent cannot be specified at the same time.',
		code: 'CALENDAR_EVENT_PARAMS_CONFLICT',
		id: '6c749f7a-c6c8-43d2-8fd6-d2a1ef336bf7',
	},
	// calendar/events/create と同じ上限 (1時間30件)。クライアントが同じように扱えるよう、ApiCallService のレート制限のエラーと同じ識別子を使う
	calendarEventRateLimitExceeded: {
		message: 'Rate limit exceeded. Please try again later.',
		code: 'RATE_LIMIT_EXCEEDED',
		id: 'd5826d14-3982-4d2e-8011-b9e9f02499ef',
		httpStatusCode: 429,
	},
} as const;

export const calendarNoteCreateErrorMap: CalendarApiErrorMap = {
	notFound: calendarNoteCreateErrors.noSuchCalendarEvent,
	canceled: calendarNoteCreateErrors.calendarEventCanceled,
	validation: calendarNoteCreateErrors.invalidCalendarEvent,
	noteNotLinkable: calendarNoteCreateErrors.cannotLinkNoteToCalendarEvent,
	paramsConflict: calendarNoteCreateErrors.calendarEventParamsConflict,
	rateLimit: calendarNoteCreateErrors.calendarEventRateLimitExceeded,
};

//#endregion
