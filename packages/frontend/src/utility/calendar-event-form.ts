/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// イベントの入力フォーム (MkCalendarEventForm) の値と、API のパラメータ・エラーとの変換

import * as Misskey from 'misskey-js';
import { parseCalendarDate } from '@/utility/calendar.js';
import type { CalendarEventVisibility } from '@/utility/calendar-visibility.js';

/** フォームの値。入力欄に合わせて、空の欄は空文字にする */
export type CalendarEventFormValue = {
	title: string;
	/** 'YYYY-MM-DD' (日本時間) */
	date: string;
	/** 'HH:mm' (日本時間)。終日のときは使わない */
	startTime: string;
	/** 'HH:mm' (日本時間)。省略可。終日のときは使わない */
	endTime: string;
	isAllDay: boolean;
	location: string;
	/** 先頭の # は付けない */
	hashtag: string;
	description: string;
	visibility: CalendarEventVisibility;
	/** 公開範囲が指定ユーザーのときに見られる人 (作成者を除く) */
	visibleUsers: Misskey.entities.UserLite[];
	/** 公開範囲がリストのときのリスト */
	userListId: string | null;
};

export type CalendarEventFormField = 'title' | 'date' | 'startTime' | 'endTime' | 'location' | 'hashtag' | 'description' | 'visibility';

// backend の core/calendar/calendar-errors.ts の calendarEventValidationReasons と同じ
export const calendarEventValidationReasons = [
	'titleRequired',
	'titleTooLong',
	'locationTooLong',
	'descriptionTooLong',
	'invalidHashtag',
	'hashtagTooLong',
	'invalidDate',
	'invalidStartTime',
	'invalidEndTime',
	'startTimeRequired',
	'endNotAfterStart',
	'endNotSameDay',
	'invalidMonth',
	'visibleUsersRequired',
	'tooManyVisibleUsers',
	'userListRequired',
	'invalidUserList',
] as const;
export type CalendarEventValidationReason = typeof calendarEventValidationReasons[number];

/** 欄ごとの検証エラー */
export type CalendarEventFormErrors = Partial<Record<CalendarEventFormField, CalendarEventValidationReason>>;

// backend の core/calendar/calendar-event-input.ts と同じ上限 (コードポイントの数)
export const CALENDAR_EVENT_TITLE_MAX_LENGTH = 100;
export const CALENDAR_EVENT_LOCATION_MAX_LENGTH = 128;
export const CALENDAR_EVENT_DESCRIPTION_MAX_LENGTH = 3000;
export const CALENDAR_EVENT_HASHTAG_MAX_LENGTH = 128;
// backend の core/calendar/calendar-visibility.ts と同じ上限
export const CALENDAR_EVENT_VISIBLE_USERS_MAX = 100;

const reasonFields: Record<CalendarEventValidationReason, CalendarEventFormField | null> = {
	titleRequired: 'title',
	titleTooLong: 'title',
	locationTooLong: 'location',
	descriptionTooLong: 'description',
	invalidHashtag: 'hashtag',
	hashtagTooLong: 'hashtag',
	invalidDate: 'date',
	invalidStartTime: 'startTime',
	startTimeRequired: 'startTime',
	invalidEndTime: 'endTime',
	endNotAfterStart: 'endTime',
	endNotSameDay: 'endTime',
	invalidMonth: null,
	visibleUsersRequired: 'visibility',
	tooManyVisibleUsers: 'visibility',
	userListRequired: 'visibility',
	invalidUserList: 'visibility',
};

/** 検証エラーの理由を、エラーを出す欄にする。欄に対応しないものは null */
export function calendarEventReasonToField(reason: CalendarEventValidationReason): CalendarEventFormField | null {
	return reasonFields[reason];
}

function isValidationReason(value: unknown): value is CalendarEventValidationReason {
	return typeof value === 'string' && (calendarEventValidationReasons as readonly string[]).includes(value);
}

/**
 * API のエラーが入力の検証エラー (INVALID_CALENDAR_EVENT) なら、その理由を返す。それ以外は null。
 * calendar/events/create・update と notes/create の calendarEvent で使える
 */
export function getCalendarEventValidationReason(err: unknown): CalendarEventValidationReason | null {
	if (err == null || typeof err !== 'object') return null;
	const e = err as Partial<Misskey.api.APIError>;
	if (e.code !== 'INVALID_CALENDAR_EVENT') return null;
	const reason: unknown = e.info?.reason;
	return isValidationReason(reason) ? reason : null;
}

/**
 * @param visibility 公開範囲の初期値 (投稿フォームではノートの公開範囲に合わせる)
 */
export function createEmptyCalendarEventForm(date: string, visibility: CalendarEventVisibility = 'public'): CalendarEventFormValue {
	return {
		title: '',
		date,
		startTime: '',
		endTime: '',
		isAllDay: false,
		location: '',
		hashtag: '',
		description: '',
		visibility,
		visibleUsers: [],
		userListId: null,
	};
}

/**
 * @param visibleUsers 指定ユーザー (イベントには ID しか無いので、使う側で引いて渡す)
 */
export function calendarEventToForm(event: Misskey.entities.CalendarEvent, visibleUsers: Misskey.entities.UserLite[] = []): CalendarEventFormValue {
	return {
		title: event.title,
		date: event.date,
		startTime: event.startTime ?? '',
		endTime: event.endTime ?? '',
		isAllDay: event.isAllDay,
		location: event.location ?? '',
		hashtag: event.hashtag ?? '',
		description: event.description ?? '',
		visibility: event.visibility,
		visibleUsers,
		userListId: event.userListId ?? null,
	};
}

function codePointLength(value: string): number {
	return [...value].length;
}

function emptyToNull(value: string): string | null {
	const trimmed = value.trim();
	return trimmed === '' ? null : trimmed;
}

function stripHash(value: string): string {
	return value.trim().replace(/^[#＃]/, '');
}

/**
 * 送信前に分かる入力の誤りを調べる (必須・長さ・時刻の前後)。ハッシュタグとして読めるかどうかなど、
 * ここで調べないものは API が INVALID_CALENDAR_EVENT で返す
 * @param options.withDescription 説明の欄を出しているか (出していないときは説明を調べない)
 */
export function validateCalendarEventForm(form: CalendarEventFormValue, options: { withDescription?: boolean } = {}): CalendarEventFormErrors {
	const errors: CalendarEventFormErrors = {};
	const title = form.title.trim();
	if (title === '') {
		errors.title = 'titleRequired';
	} else if (codePointLength(title) > CALENDAR_EVENT_TITLE_MAX_LENGTH) {
		errors.title = 'titleTooLong';
	}

	if (parseCalendarDate(form.date) == null) errors.date = 'invalidDate';

	if (!form.isAllDay) {
		const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
		if (form.startTime === '') {
			errors.startTime = 'startTimeRequired';
		} else if (!timePattern.test(form.startTime)) {
			errors.startTime = 'invalidStartTime';
		}
		if (form.endTime !== '') {
			if (!timePattern.test(form.endTime)) {
				errors.endTime = 'invalidEndTime';
			} else if (errors.startTime == null && form.endTime <= form.startTime) {
				errors.endTime = 'endNotAfterStart';
			}
		}
	}

	if (codePointLength(form.location.trim()) > CALENDAR_EVENT_LOCATION_MAX_LENGTH) errors.location = 'locationTooLong';
	if (codePointLength(stripHash(form.hashtag)) > CALENDAR_EVENT_HASHTAG_MAX_LENGTH) errors.hashtag = 'hashtagTooLong';
	if (options.withDescription !== false && codePointLength(form.description.trim()) > CALENDAR_EVENT_DESCRIPTION_MAX_LENGTH) {
		errors.description = 'descriptionTooLong';
	}

	if (form.visibility === 'specified') {
		if (form.visibleUsers.length === 0) {
			errors.visibility = 'visibleUsersRequired';
		} else if (form.visibleUsers.length > CALENDAR_EVENT_VISIBLE_USERS_MAX) {
			errors.visibility = 'tooManyVisibleUsers';
		}
	} else if (form.visibility === 'list' && form.userListId == null) {
		errors.visibility = 'userListRequired';
	}

	return errors;
}

/**
 * 入力し直した欄のエラーを消した、新しいエラーのオブジェクトを返す。
 * 終日を切り替えたときは時刻の欄のエラーも消す
 */
export function clearChangedCalendarEventFormErrors(errors: CalendarEventFormErrors, prev: CalendarEventFormValue, next: CalendarEventFormValue): CalendarEventFormErrors {
	const result: CalendarEventFormErrors = { ...errors };
	for (const key of Object.keys(errors) as CalendarEventFormField[]) {
		if (prev[key] !== next[key]) delete result[key];
	}
	if (prev.isAllDay !== next.isAllDay) {
		delete result.startTime;
		delete result.endTime;
	}
	// 開始時刻を直すと「終了時刻は開始時刻より後に」も解消しうる
	if (prev.startTime !== next.startTime && result.endTime === 'endNotAfterStart') delete result.endTime;
	// 公開範囲の欄は、指定ユーザーやリストを選び直したときも直したとみなす
	if (prev.visibleUsers !== next.visibleUsers || prev.userListId !== next.userListId) delete result.visibility;
	return result;
}

export type CalendarEventParams = {
	title: string;
	date: string;
	startTime: string | null;
	endTime: string | null;
	isAllDay: boolean;
	location: string | null;
	hashtag: string | null;
	description?: string | null;
	visibility: CalendarEventVisibility;
	/** 公開範囲が指定ユーザーのときだけ入れる */
	visibleUserIds?: string[];
	/** 公開範囲がリストのときだけ入れる */
	userListId?: string;
};

function visibilityParams(form: CalendarEventFormValue): Pick<CalendarEventParams, 'visibility' | 'visibleUserIds' | 'userListId'> {
	if (form.visibility === 'specified') return { visibility: 'specified', visibleUserIds: form.visibleUsers.map(u => u.id) };
	if (form.visibility === 'list' && form.userListId != null) return { visibility: 'list', userListId: form.userListId };
	return { visibility: form.visibility };
}

/**
 * フォームの値を calendar/events/create (と notes/create の calendarEvent) のパラメータにする。
 * withDescription が false なら description を入れない (notes/create では、省略するとノートの本文が説明になる)
 */
export function calendarEventFormToParams(form: CalendarEventFormValue, options: { withDescription?: boolean } = {}): CalendarEventParams {
	const params: CalendarEventParams = {
		title: form.title.trim(),
		date: form.date,
		startTime: form.isAllDay ? null : emptyToNull(form.startTime),
		endTime: form.isAllDay ? null : emptyToNull(form.endTime),
		isAllDay: form.isAllDay,
		location: emptyToNull(form.location),
		hashtag: emptyToNull(stripHash(form.hashtag)),
		...visibilityParams(form),
	};
	if (options.withDescription !== false) params.description = emptyToNull(form.description);
	return params;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false;
	const set = new Set(a);
	return b.every(id => set.has(id));
}

/** 公開範囲 (種類・指定ユーザー・リスト) を元のイベントから変えたか */
export function isCalendarEventVisibilityChanged(event: Misskey.entities.CalendarEvent, form: CalendarEventFormValue): boolean {
	if (form.visibility !== event.visibility) return true;
	if (form.visibility === 'specified') return !sameIds(form.visibleUsers.map(u => u.id), event.visibleUserIds ?? []);
	if (form.visibility === 'list') return form.userListId !== (event.userListId ?? null);
	return false;
}

/**
 * calendar/events/update に送る、元のイベントから変わった項目。何も変わっていなければ空のオブジェクト。
 * 日時は 1 つでも変わったら 4 項目 (date / startTime / endTime / isAllDay) をまとめて送る
 */
export function calendarEventFormToUpdateParams(event: Misskey.entities.CalendarEvent, form: CalendarEventFormValue): Partial<CalendarEventParams> {
	const next = calendarEventFormToParams(form);
	const changed: Partial<CalendarEventParams> = {};

	if (next.title !== event.title) changed.title = next.title;
	if (next.location !== event.location) changed.location = next.location;
	if (next.description !== event.description) changed.description = next.description;
	// 保存済みのハッシュタグは正規化 (小文字など) されているので、入力が元の値のままなら送らない
	if (next.hashtag !== event.hashtag) changed.hashtag = next.hashtag;

	const scheduleChanged =
		next.date !== event.date ||
		next.isAllDay !== event.isAllDay ||
		(!next.isAllDay && (next.startTime !== event.startTime || next.endTime !== event.endTime));
	if (scheduleChanged) {
		changed.date = next.date;
		changed.startTime = next.startTime;
		changed.endTime = next.endTime;
		changed.isAllDay = next.isAllDay;
	}

	// 公開範囲は 1 つでも変わったら、種類と指定ユーザー・リストをまとめて送る
	if (isCalendarEventVisibilityChanged(event, form)) {
		Object.assign(changed, visibilityParams(form));
	}

	return changed;
}
