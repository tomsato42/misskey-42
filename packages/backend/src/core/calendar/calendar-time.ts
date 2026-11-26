/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// カレンダーの日時は日本時間 (Asia/Tokyo) で扱う。日本には夏時間が無いので、UTC+9 の固定の時差で計算する。
// サーバーのタイムゾーン (process.env.TZ) には依存しない

import { CalendarEventValidationError } from './calendar-errors.js';

export const CALENDAR_TIME_ZONE = 'Asia/Tokyo';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type JstDate = {
	year: number;
	/** 1〜12 */
	month: number;
	day: number;
};

export type JstTime = {
	hour: number;
	minute: number;
};

export type JstYearMonth = {
	year: number;
	/** 1〜12 */
	month: number;
};

function pad2(n: number): string {
	return n.toString().padStart(2, '0');
}

/**
 * 'YYYY-MM-DD' を日付として読む。存在しない日付 (2月30日など) や形式違いは null
 */
export function parseJstDate(value: string): JstDate | null {
	const m = /^([1-9]\d{3})-(\d{2})-(\d{2})$/.exec(value);
	if (m == null) return null;
	const year = Number(m[1]);
	const month = Number(m[2]);
	const day = Number(m[3]);
	if (month < 1 || month > 12 || day < 1) return null;
	const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
	if (day > daysInMonth) return null;
	return { year, month, day };
}

/**
 * 'HH:mm' (00:00〜23:59) を時刻として読む。形式違いは null
 */
export function parseJstTime(value: string): JstTime | null {
	const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
	if (m == null) return null;
	return { hour: Number(m[1]), minute: Number(m[2]) };
}

/**
 * 'YYYY-MM' を年月として読む。形式違いは null
 */
export function parseJstYearMonth(value: string): JstYearMonth | null {
	const m = /^([1-9]\d{3})-(\d{2})$/.exec(value);
	if (m == null) return null;
	const year = Number(m[1]);
	const month = Number(m[2]);
	if (month < 1 || month > 12) return null;
	return { year, month };
}

/**
 * 日本時間の年月日と時分を Date にする。時刻を省略するとその日の 0:00
 */
export function jstToDate(date: JstDate, time: JstTime = { hour: 0, minute: 0 }): Date {
	return new Date(Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute) - JST_OFFSET_MS);
}

/**
 * Date を日本時間の年月日・時分に分ける
 */
export function toJstParts(date: Date): JstDate & JstTime {
	const shifted = new Date(date.getTime() + JST_OFFSET_MS);
	return {
		year: shifted.getUTCFullYear(),
		month: shifted.getUTCMonth() + 1,
		day: shifted.getUTCDate(),
		hour: shifted.getUTCHours(),
		minute: shifted.getUTCMinutes(),
	};
}

/** Date を日本時間の 'YYYY-MM-DD' にする */
export function formatJstDate(date: Date): string {
	const p = toJstParts(date);
	return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** Date を日本時間の 'HH:mm' にする */
export function formatJstTime(date: Date): string {
	const p = toJstParts(date);
	return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** その日時を含む日本時間の日の 0:00 */
export function startOfJstDay(date: Date): Date {
	return jstToDate(toJstParts(date));
}

/** 2つの日時が日本時間で同じ日付か */
export function isSameJstDay(a: Date, b: Date): boolean {
	return formatJstDate(a) === formatJstDate(b);
}

/**
 * 'YYYY-MM' の月の表示に使う範囲 (日本時間の月初 0:00 〜 翌月初 0:00)。to は範囲に含まない
 * @throws CalendarEventValidationError (invalidMonth)
 */
export function getJstMonthRange(yearMonth: string): { from: Date; to: Date } {
	const ym = parseJstYearMonth(yearMonth);
	if (ym == null) throw new CalendarEventValidationError('invalidMonth');
	const from = jstToDate({ year: ym.year, month: ym.month, day: 1 });
	const next = ym.month === 12 ? { year: ym.year + 1, month: 1 } : { year: ym.year, month: ym.month + 1 };
	const to = jstToDate({ year: next.year, month: next.month, day: 1 });
	return { from, to };
}

export type CalendarEventScheduleInput = {
	/** 'YYYY-MM-DD' (日本時間) */
	date: string;
	/** 'HH:mm' (日本時間)。終日のときは使わない */
	startTime?: string | null;
	/** 'HH:mm' (日本時間)。省略可。終日のときは使わない */
	endTime?: string | null;
	isAllDay?: boolean;
};

export type CalendarEventSchedule = {
	startsAt: Date;
	endsAt: Date | null;
	isAllDay: boolean;
};

/**
 * 終了日時が開始より後で、日本時間の同じ日付の中にあるか確かめる
 * @throws CalendarEventValidationError (endNotAfterStart / endNotSameDay)
 */
export function validateCalendarEventEnd(startsAt: Date, endsAt: Date): void {
	if (endsAt.getTime() <= startsAt.getTime()) throw new CalendarEventValidationError('endNotAfterStart');
	if (!isSameJstDay(startsAt, endsAt)) throw new CalendarEventValidationError('endNotSameDay');
}

/**
 * 日付と時刻の入力から startsAt / endsAt を求める。
 * 終日なら startsAt はその日の 0:00 で、endsAt は null (時刻の入力は無視する)
 * @throws CalendarEventValidationError
 */
export function resolveCalendarEventSchedule(input: CalendarEventScheduleInput): CalendarEventSchedule {
	const date = parseJstDate(input.date);
	if (date == null) throw new CalendarEventValidationError('invalidDate');

	if (input.isAllDay === true) {
		return { startsAt: jstToDate(date), endsAt: null, isAllDay: true };
	}

	if (input.startTime == null || input.startTime === '') throw new CalendarEventValidationError('startTimeRequired');
	const startTime = parseJstTime(input.startTime);
	if (startTime == null) throw new CalendarEventValidationError('invalidStartTime');
	const startsAt = jstToDate(date, startTime);

	let endsAt: Date | null = null;
	if (input.endTime != null && input.endTime !== '') {
		const endTime = parseJstTime(input.endTime);
		if (endTime == null) throw new CalendarEventValidationError('invalidEndTime');
		endsAt = jstToDate(date, endTime);
		validateCalendarEventEnd(startsAt, endsAt);
	}

	return { startsAt, endsAt, isAllDay: false };
}

/**
 * 保存されている日時を入力の形 (日付・時刻の文字列) に戻す。部分的な更新で、変えない項目を埋めるのに使う
 */
export function toCalendarEventScheduleInput(schedule: CalendarEventSchedule): Required<CalendarEventScheduleInput> {
	return {
		date: formatJstDate(schedule.startsAt),
		startTime: schedule.isAllDay ? null : formatJstTime(schedule.startsAt),
		endTime: schedule.isAllDay || schedule.endsAt == null ? null : formatJstTime(schedule.endsAt),
		isAllDay: schedule.isAllDay,
	};
}
