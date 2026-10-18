/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// イベントの入力フォーム (MkCalendarEventForm) の値と、API のパラメータ・エラーとの変換

import * as Misskey from 'misskey-js';
import { parseCalendarDate } from '@/utility/calendar.js';

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
};

export type CalendarEventFormField = 'title' | 'date' | 'startTime' | 'endTime' | 'location' | 'hashtag' | 'description';

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
] as const;
export type CalendarEventValidationReason = typeof calendarEventValidationReasons[number];

/** 欄ごとの検証エラー */
export type CalendarEventFormErrors = Partial<Record<CalendarEventFormField, CalendarEventValidationReason>>;

// backend の core/calendar/calendar-event-input.ts と同じ上限 (コードポイントの数)
export const CALENDAR_EVENT_TITLE_MAX_LENGTH = 100;
export const CALENDAR_EVENT_LOCATION_MAX_LENGTH = 128;
export const CALENDAR_EVENT_DESCRIPTION_MAX_LENGTH = 3000;
export const CALENDAR_EVENT_HASHTAG_MAX_LENGTH = 128;

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

export function createEmptyCalendarEventForm(date: string): CalendarEventFormValue {
	return {
		title: '',
		date,
		startTime: '',
		endTime: '',
		isAllDay: false,
		location: '',
		hashtag: '',
		description: '',
	};
}

export function calendarEventToForm(event: Misskey.entities.CalendarEvent): CalendarEventFormValue {
	return {
		title: event.title,
		date: event.date,
		startTime: event.startTime ?? '',
		endTime: event.endTime ?? '',
		isAllDay: event.isAllDay,
		location: event.location ?? '',
		hashtag: event.hashtag ?? '',
		description: event.description ?? '',
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
};

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
	};
	if (options.withDescription !== false) params.description = emptyToNull(form.description);
	return params;
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

	return changed;
}
