/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// カレンダーの表示文言 (日付・時刻の表記とエラー)。calendar.ts と calendar-event-form.ts は i18n に依存させず
// (ユニットテストしやすくするため)、文言はこちらに置く

import * as Misskey from 'misskey-js';
import { i18n } from '@/i18n.js';
import { dayOfWeek, parseCalendarDate, parseYearMonth } from '@/utility/calendar.js';
import {
	CALENDAR_EVENT_DESCRIPTION_MAX_LENGTH,
	CALENDAR_EVENT_HASHTAG_MAX_LENGTH,
	CALENDAR_EVENT_LOCATION_MAX_LENGTH,
	CALENDAR_EVENT_TITLE_MAX_LENGTH,
	getCalendarEventValidationReason,
} from '@/utility/calendar-event-form.js';
import type { CalendarEventValidationReason } from '@/utility/calendar-event-form.js';

/** 曜日の短い表記 (0 = 日曜 〜 6 = 土曜) */
export function getWeekdayShortLabel(dow: number): string {
	const t = i18n.ts._calendar._weekdayShort;
	return [t.sunday, t.monday, t.tuesday, t.wednesday, t.thursday, t.friday, t.saturday][dow];
}

/** 'YYYY-MM' を「2026年10月」にする */
export function formatCalendarYearMonth(value: string): string {
	const ym = parseYearMonth(value);
	if (ym == null) return value;
	return i18n.tsx._calendar.yearMonth({ year: ym.year, month: ym.month });
}

/** 'YYYY-MM-DD' を「10月20日(火)」にする */
export function formatCalendarDay(value: string): string {
	const d = parseCalendarDate(value);
	if (d == null) return value;
	return i18n.tsx._calendar.monthDay({ month: d.month, day: d.day, weekday: getWeekdayShortLabel(dayOfWeek(value)) });
}

/** イベントの時刻の表記 (「終日」「12:00〜15:00」「12:00〜」) */
export function formatCalendarEventTime(event: { isAllDay: boolean; startTime: string | null; endTime: string | null }): string {
	if (event.isAllDay || event.startTime == null) return i18n.ts._calendar.allDay;
	if (event.endTime == null) return i18n.tsx._calendar.timeFrom({ start: event.startTime });
	return i18n.tsx._calendar.timeRange({ start: event.startTime, end: event.endTime });
}

/** 入力の検証エラーの理由を、欄の下に出す文言にする */
export function getCalendarEventValidationMessage(reason: CalendarEventValidationReason): string {
	const t = i18n.ts._calendar._errors;
	switch (reason) {
		case 'titleRequired': return t.titleRequired;
		case 'titleTooLong': return i18n.tsx._calendar._errors.titleTooLong({ max: CALENDAR_EVENT_TITLE_MAX_LENGTH });
		case 'locationTooLong': return i18n.tsx._calendar._errors.locationTooLong({ max: CALENDAR_EVENT_LOCATION_MAX_LENGTH });
		case 'descriptionTooLong': return i18n.tsx._calendar._errors.descriptionTooLong({ max: CALENDAR_EVENT_DESCRIPTION_MAX_LENGTH });
		case 'invalidHashtag': return t.invalidHashtag;
		case 'hashtagTooLong': return i18n.tsx._calendar._errors.hashtagTooLong({ max: CALENDAR_EVENT_HASHTAG_MAX_LENGTH });
		case 'invalidDate': return t.invalidDate;
		case 'invalidStartTime': return t.invalidStartTime;
		case 'invalidEndTime': return t.invalidEndTime;
		case 'startTimeRequired': return t.startTimeRequired;
		case 'endNotAfterStart': return t.endNotAfterStart;
		case 'endNotSameDay': return t.endNotSameDay;
		case 'invalidMonth': return t.invalidMonth;
	}
}

/**
 * カレンダーの API のエラーを、ダイアログに出す文言にする。
 * 欄に対応する検証エラーはフォームの欄の下に出すので、ここは欄に出せないときの表示に使う
 */
export function getCalendarApiErrorMessage(err: unknown): { title?: string; text: string } {
	const reason = getCalendarEventValidationReason(err);
	if (reason != null) return { text: getCalendarEventValidationMessage(reason) };

	const e = (err ?? {}) as Partial<Misskey.api.APIError>;
	switch (e.code) {
		case 'NO_SUCH_CALENDAR_EVENT': return { text: i18n.ts.notFound };
		case 'CALENDAR_EVENT_CANCELED': return { text: i18n.ts._calendar.alreadyCanceled };
		case 'CANNOT_UNSUBSCRIBE_OWN_CALENDAR_EVENT': return { text: i18n.ts._calendar.cannotUnsubscribeOwn };
		case 'ACCESS_DENIED': return { title: i18n.ts.permissionDeniedError, text: i18n.ts.permissionDeniedErrorDescription };
		case 'RATE_LIMIT_EXCEEDED': return { title: i18n.ts.cannotPerformTemporary, text: i18n.ts.cannotPerformTemporaryDescription };
		default: return { title: i18n.ts.error, text: e.message != null ? `${e.message}\n${e.id ?? ''}` : i18n.ts.somethingHappened };
	}
}
