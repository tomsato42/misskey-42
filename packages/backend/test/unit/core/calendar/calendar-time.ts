/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import {
	formatJstDate,
	formatJstTime,
	getJstMonthRange,
	isSameJstDay,
	jstToDate,
	parseJstDate,
	parseJstTime,
	parseJstYearMonth,
	resolveCalendarEventSchedule,
	startOfJstDay,
	toCalendarEventScheduleInput,
	toJstParts,
	validateCalendarEventEnd,
} from '@/core/calendar/calendar-time.js';
import { CalendarEventValidationError } from '@/core/calendar/calendar-errors.js';
import type { CalendarEventValidationReason } from '@/core/calendar/calendar-errors.js';

function expectReason(fn: () => unknown, reason: CalendarEventValidationReason) {
	try {
		fn();
	} catch (err) {
		expect(err).toBeInstanceOf(CalendarEventValidationError);
		expect((err as CalendarEventValidationError).reason).toBe(reason);
		return;
	}
	throw new Error(`expected CalendarEventValidationError (${reason})`);
}

describe('parseJstDate', () => {
	test('YYYY-MM-DD を読む', () => {
		expect(parseJstDate('2026-10-20')).toEqual({ year: 2026, month: 10, day: 20 });
	});

	test('うるう年の 2月29日を受け付ける', () => {
		expect(parseJstDate('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
	});

	test.each(['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-10-00', '2026-1-5', '0999-01-01', '2026/10/20', ''])('存在しない日付や形式違いは null (%s)', (value) => {
		expect(parseJstDate(value)).toBeNull();
	});
});

describe('parseJstTime', () => {
	test('HH:mm を読む', () => {
		expect(parseJstTime('00:00')).toEqual({ hour: 0, minute: 0 });
		expect(parseJstTime('23:59')).toEqual({ hour: 23, minute: 59 });
	});

	test.each(['24:00', '12:60', '9:00', '09:0', '09:00:00', ''])('範囲外や形式違いは null (%s)', (value) => {
		expect(parseJstTime(value)).toBeNull();
	});
});

describe('parseJstYearMonth', () => {
	test('YYYY-MM を読む', () => {
		expect(parseJstYearMonth('2026-10')).toEqual({ year: 2026, month: 10 });
	});

	test.each(['2026-13', '2026-00', '2026-1', '2026-10-01'])('形式違いは null (%s)', (value) => {
		expect(parseJstYearMonth(value)).toBeNull();
	});
});

describe('日本時間と Date の変換', () => {
	test('日本時間の日時を UTC の Date にする', () => {
		expect(jstToDate({ year: 2026, month: 10, day: 20 }, { hour: 12, minute: 30 }).toISOString()).toBe('2026-10-20T03:30:00.000Z');
	});

	test('時刻を省略すると日本時間の 0:00 (UTC では前日の 15:00)', () => {
		expect(jstToDate({ year: 2026, month: 10, day: 1 }).toISOString()).toBe('2026-09-30T15:00:00.000Z');
	});

	test('Date を日本時間の年月日・時分に分ける (UTC では前日でも日本時間の日付になる)', () => {
		const date = new Date('2026-12-31T15:05:00.000Z');
		expect(toJstParts(date)).toEqual({ year: 2027, month: 1, day: 1, hour: 0, minute: 5 });
		expect(formatJstDate(date)).toBe('2027-01-01');
		expect(formatJstTime(date)).toBe('00:05');
	});

	test('startOfJstDay は日本時間のその日の 0:00', () => {
		expect(startOfJstDay(new Date('2026-10-20T14:59:59.000Z')).toISOString()).toBe('2026-10-19T15:00:00.000Z');
		expect(startOfJstDay(new Date('2026-10-20T15:00:00.000Z')).toISOString()).toBe('2026-10-20T15:00:00.000Z');
	});

	test('isSameJstDay は日本時間の日付で比べる', () => {
		expect(isSameJstDay(new Date('2026-10-19T15:00:00.000Z'), new Date('2026-10-20T14:59:00.000Z'))).toBe(true);
		expect(isSameJstDay(new Date('2026-10-20T14:59:00.000Z'), new Date('2026-10-20T15:00:00.000Z'))).toBe(false);
	});
});

describe('getJstMonthRange', () => {
	test('日本時間の月初 0:00 から翌月初 0:00 まで', () => {
		const { from, to } = getJstMonthRange('2026-10');
		expect(from.toISOString()).toBe('2026-09-30T15:00:00.000Z');
		expect(to.toISOString()).toBe('2026-10-31T15:00:00.000Z');
	});

	test('12月は翌年の 1月初まで', () => {
		const { from, to } = getJstMonthRange('2026-12');
		expect(from.toISOString()).toBe('2026-11-30T15:00:00.000Z');
		expect(to.toISOString()).toBe('2026-12-31T15:00:00.000Z');
	});

	test('形式違いは invalidMonth', () => {
		expectReason(() => getJstMonthRange('2026-13'), 'invalidMonth');
	});
});

describe('resolveCalendarEventSchedule', () => {
	test('開始時刻と終了時刻から日時を求める', () => {
		const schedule = resolveCalendarEventSchedule({ date: '2026-10-20', startTime: '12:00', endTime: '15:00', isAllDay: false });
		expect(schedule.startsAt.toISOString()).toBe('2026-10-20T03:00:00.000Z');
		expect(schedule.endsAt?.toISOString()).toBe('2026-10-20T06:00:00.000Z');
		expect(schedule.isAllDay).toBe(false);
	});

	test('終了時刻は省略できる', () => {
		const schedule = resolveCalendarEventSchedule({ date: '2026-10-20', startTime: '12:00', endTime: '' });
		expect(schedule.endsAt).toBeNull();
		expect(schedule.isAllDay).toBe(false);
	});

	test('終日なら日本時間の 0:00 に始まり、時刻の入力は無視する', () => {
		const schedule = resolveCalendarEventSchedule({ date: '2026-10-20', startTime: '12:00', endTime: '15:00', isAllDay: true });
		expect(schedule).toEqual({ startsAt: new Date('2026-10-19T15:00:00.000Z'), endsAt: null, isAllDay: true });
	});

	test('日本時間の 0:00〜8:59 の開始でも日付は日本時間のまま (UTC では前日)', () => {
		const schedule = resolveCalendarEventSchedule({ date: '2026-10-20', startTime: '07:00', endTime: '08:30' });
		expect(schedule.startsAt.toISOString()).toBe('2026-10-19T22:00:00.000Z');
		expect(formatJstDate(schedule.startsAt)).toBe('2026-10-20');
	});

	test('23:59 までは同じ日の中', () => {
		const schedule = resolveCalendarEventSchedule({ date: '2026-10-20', startTime: '22:00', endTime: '23:59' });
		expect(schedule.endsAt?.toISOString()).toBe('2026-10-20T14:59:00.000Z');
	});

	test('終日でなければ開始時刻が必要', () => {
		expectReason(() => resolveCalendarEventSchedule({ date: '2026-10-20' }), 'startTimeRequired');
		expectReason(() => resolveCalendarEventSchedule({ date: '2026-10-20', startTime: null, isAllDay: false }), 'startTimeRequired');
	});

	test('終了が開始と同じか前なら endNotAfterStart', () => {
		expectReason(() => resolveCalendarEventSchedule({ date: '2026-10-20', startTime: '12:00', endTime: '12:00' }), 'endNotAfterStart');
		expectReason(() => resolveCalendarEventSchedule({ date: '2026-10-20', startTime: '12:00', endTime: '11:00' }), 'endNotAfterStart');
	});

	test('日付や時刻の形式違い', () => {
		expectReason(() => resolveCalendarEventSchedule({ date: '2026-02-30', startTime: '12:00' }), 'invalidDate');
		expectReason(() => resolveCalendarEventSchedule({ date: '2026-10-20', startTime: '25:00' }), 'invalidStartTime');
		expectReason(() => resolveCalendarEventSchedule({ date: '2026-10-20', startTime: '12:00', endTime: '24:00' }), 'invalidEndTime');
	});
});

describe('validateCalendarEventEnd', () => {
	test('日本時間で翌日にかかる終了は endNotSameDay', () => {
		expectReason(() => validateCalendarEventEnd(new Date('2026-10-20T13:00:00.000Z'), new Date('2026-10-20T15:00:00.000Z')), 'endNotSameDay');
	});

	test('UTC では日付が変わっても日本時間で同じ日なら受け付ける', () => {
		expect(() => validateCalendarEventEnd(new Date('2026-10-19T23:00:00.000Z'), new Date('2026-10-20T01:00:00.000Z'))).not.toThrow();
	});
});

describe('toCalendarEventScheduleInput', () => {
	test('保存されている日時を日付と時刻の文字列に戻す', () => {
		const input = { date: '2026-10-20', startTime: '07:00', endTime: '08:30', isAllDay: false };
		expect(toCalendarEventScheduleInput(resolveCalendarEventSchedule(input))).toEqual(input);
	});

	test('終日なら時刻は null', () => {
		expect(toCalendarEventScheduleInput(resolveCalendarEventSchedule({ date: '2026-10-20', isAllDay: true }))).toEqual({
			date: '2026-10-20', startTime: null, endTime: null, isAllDay: true,
		});
	});
});
