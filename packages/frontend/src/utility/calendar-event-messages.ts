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
	CALENDAR_EVENT_VISIBLE_USERS_MAX,
	getCalendarEventValidationReason,
} from '@/utility/calendar-event-form.js';
import type { CalendarEventValidationReason } from '@/utility/calendar-event-form.js';
import type { CalendarEventVisibility } from '@/utility/calendar-visibility.js';

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

/** イベントの日時の表記 (「10月20日(火) 12:00〜15:00」「10月20日(火) 終日」) */
export function formatCalendarSchedule(schedule: { date: string; isAllDay: boolean; startTime: string | null; endTime: string | null }): string {
	return `${formatCalendarDay(schedule.date)} ${formatCalendarEventTime(schedule)}`;
}

/** イベントの日時と場所 (「10月20日(火) 12:00〜 ・ c3」)。場所が無ければ日時だけ */
export function formatCalendarScheduleAndLocation(event: { date: string; isAllDay: boolean; startTime: string | null; endTime: string | null; location: string | null }): string {
	const schedule = formatCalendarSchedule(event);
	return event.location != null && event.location !== '' ? `${schedule} ・ ${event.location}` : schedule;
}

/** イベントのリマインドの通知の見出し */
export function getCalendarReminderHeading(kind: 'week' | 'day' | 'today'): string {
	return i18n.ts._calendar._notification[kind];
}

/** イベントの日時の変更・中止の通知の見出し */
export function getCalendarUpdateHeading(kind: 'rescheduled' | 'canceled'): string {
	return i18n.ts._calendar._notification[kind];
}

// 本番ビルドでは i18n.ts の文言のオブジェクトがリテラルに置き換わり (frontend-builder の locale-inliner)、括弧で囲まれない。
// 圧縮でアロー関数の式の本体になると `() => {...}[key]` がブロックとして読まれて構文エラーになるので、
// 文言のオブジェクトに添字を付けず、文字列の項目を switch で選ぶ

/** 公開範囲の名前 (「フォロワー」) */
export function getCalendarVisibilityLabel(visibility: CalendarEventVisibility): string {
	const t = i18n.ts._calendar._visibility;
	switch (visibility) {
		case 'public': return t.public;
		case 'followers': return t.followers;
		case 'mutual': return t.mutual;
		case 'specified': return t.specified;
		case 'list': return t.list;
	}
}

/** ノートの公開範囲の名前 (「パブリック」) */
export function getNoteVisibilityLabel(visibility: string): string {
	switch (visibility) {
		case 'public': return i18n.ts._visibility.public;
		case 'home': return i18n.ts._visibility.home;
		case 'followers': return i18n.ts._visibility.followers;
		default: return i18n.ts._visibility.specified;
	}
}

/** 公開範囲の説明 (「自分のフォロワーに公開」) */
export function getCalendarVisibilityDescription(visibility: CalendarEventVisibility): string {
	const t = i18n.ts._calendar._visibility;
	switch (visibility) {
		case 'public': return t.publicDescription;
		case 'followers': return t.followersDescription;
		case 'mutual': return t.mutualDescription;
		case 'specified': return t.specifiedDescription;
		case 'list': return t.listDescription;
	}
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
		case 'visibleUsersRequired': return t.visibleUsersRequired;
		case 'tooManyVisibleUsers': return i18n.tsx._calendar._errors.tooManyVisibleUsers({ max: CALENDAR_EVENT_VISIBLE_USERS_MAX });
		case 'userListRequired': return t.userListRequired;
		case 'invalidUserList': return t.invalidUserList;
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
		case 'CANNOT_LINK_NOTE_TO_CALENDAR_EVENT': {
			const reason: unknown = e.info?.reason;
			if (reason === 'specifiedVisibility') return { text: i18n.ts._calendar._errors.cannotLinkSpecified };
			if (reason === 'pureRenote') return { text: i18n.ts._calendar._errors.cannotLinkPureRenote };
			return { title: i18n.ts.error, text: e.message ?? i18n.ts.somethingHappened };
		}
		case 'ACCESS_DENIED': return { title: i18n.ts.permissionDeniedError, text: i18n.ts.permissionDeniedErrorDescription };
		case 'NO_SUCH_LIST': return { text: i18n.ts._calendar._errors.invalidUserList };
		case 'RATE_LIMIT_EXCEEDED': return { title: i18n.ts.cannotPerformTemporary, text: i18n.ts.cannotPerformTemporaryDescription };
		default: return { title: i18n.ts.error, text: e.message != null ? `${e.message}\n${e.id ?? ''}` : i18n.ts.somethingHappened };
	}
}
