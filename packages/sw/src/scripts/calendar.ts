/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * 42times: カレンダーの通知の文言 (SW 用)。
 * frontend の utility/calendar-event-messages.ts と同じ表記にする (SW は frontend のコードを読み込めないので、ここに置く)
 */
import type { I18n } from '@@/js/i18n.js';
import type { Locale } from 'i18n';

type Schedule = {
	date: string;
	isAllDay: boolean;
	startTime: string | null;
	endTime: string | null;
};

/** 'YYYY-MM-DD' (日本時間) を「10月20日(火)」にする。形式違いはそのまま返す */
function formatDay(i18n: I18n<Locale>, value: string): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (m == null) return value;
	const year = Number(m[1]);
	const month = Number(m[2]);
	const day = Number(m[3]);
	const t = i18n.ts._calendar._weekdayShort;
	const weekdays = [t.sunday, t.monday, t.tuesday, t.wednesday, t.thursday, t.friday, t.saturday];
	const weekday = weekdays[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
	return i18n.tsx._calendar.monthDay({ month, day, weekday });
}

function formatTime(i18n: I18n<Locale>, schedule: Schedule): string {
	if (schedule.isAllDay || schedule.startTime == null) return i18n.ts._calendar.allDay;
	if (schedule.endTime == null) return i18n.tsx._calendar.timeFrom({ start: schedule.startTime });
	return i18n.tsx._calendar.timeRange({ start: schedule.startTime, end: schedule.endTime });
}

/** 「10月20日(火) 12:00〜15:00」 */
export function formatCalendarSchedule(i18n: I18n<Locale>, schedule: Schedule): string {
	return `${formatDay(i18n, schedule.date)} ${formatTime(i18n, schedule)}`;
}
