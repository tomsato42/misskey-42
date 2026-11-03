/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import {
	CALENDAR_REMINDER_LOOKAHEAD_MS,
	CALENDAR_REMINDER_WINDOW_MS,
	getCalendarReminderTime,
	getDueCalendarReminderKinds,
	isTooLateForCalendarReminder,
} from '@/core/calendar/calendar-reminder.js';
import { jstToDate } from '@/core/calendar/calendar-time.js';

/** 日本時間の 'YYYY-MM-DD HH:mm' を Date にする */
function jst(value: string): Date {
	const [date, time = '00:00'] = value.split(' ');
	const [year, month, day] = date.split('-').map(Number);
	const [hour, minute] = time.split(':').map(Number);
	return jstToDate({ year, month, day }, { hour, minute });
}

function timed(start: string) {
	return { startsAt: jst(start), isAllDay: false };
}

function allDay(date: string) {
	return { startsAt: jst(date), isAllDay: true };
}

describe('getCalendarReminderTime', () => {
	test('時刻のあるイベント: 7日前・前日・当日の 9:00', () => {
		const event = timed('2026-10-20 12:00');
		expect(getCalendarReminderTime(event, 'week')).toEqual(jst('2026-10-13 09:00'));
		expect(getCalendarReminderTime(event, 'day')).toEqual(jst('2026-10-19 09:00'));
		expect(getCalendarReminderTime(event, 'today')).toEqual(jst('2026-10-20 09:00'));
		// 9:00 JST は UTC では 0:00
		expect(getCalendarReminderTime(event, 'today').toISOString()).toBe('2026-10-20T00:00:00.000Z');
	});

	test('終日のイベントは開始日の 0:00 を基準にする', () => {
		const event = allDay('2026-10-20');
		expect(getCalendarReminderTime(event, 'week')).toEqual(jst('2026-10-13 09:00'));
		expect(getCalendarReminderTime(event, 'day')).toEqual(jst('2026-10-19 09:00'));
		expect(getCalendarReminderTime(event, 'today')).toEqual(jst('2026-10-20 09:00'));
	});

	test('当日は、開始が 9:00 より前なら開始の1時間前', () => {
		expect(getCalendarReminderTime(timed('2026-10-20 07:30'), 'today')).toEqual(jst('2026-10-20 06:30'));
		// 0:30 に始まるイベントは前日の 23:30
		expect(getCalendarReminderTime(timed('2026-10-20 00:30'), 'today')).toEqual(jst('2026-10-19 23:30'));
		// 早朝のイベントでも前日・1週間前は開始日を基準にする
		expect(getCalendarReminderTime(timed('2026-10-20 00:30'), 'day')).toEqual(jst('2026-10-19 09:00'));
		expect(getCalendarReminderTime(timed('2026-10-20 00:30'), 'week')).toEqual(jst('2026-10-13 09:00'));
	});

	test('9:00 ちょうどに始まるイベントも1時間前、9:01 なら 9:00', () => {
		expect(getCalendarReminderTime(timed('2026-10-20 09:00'), 'today')).toEqual(jst('2026-10-20 08:00'));
		expect(getCalendarReminderTime(timed('2026-10-20 09:01'), 'today')).toEqual(jst('2026-10-20 09:00'));
	});

	test('日本時間と UTC で日付が違うイベントは、日本時間の日付を基準にする', () => {
		// 2026-10-21 08:00 JST は UTC では 2026-10-20 23:00
		const event = timed('2026-10-21 08:00');
		expect(event.startsAt.toISOString()).toBe('2026-10-20T23:00:00.000Z');
		expect(getCalendarReminderTime(event, 'day')).toEqual(jst('2026-10-20 09:00'));
		expect(getCalendarReminderTime(event, 'today')).toEqual(jst('2026-10-21 07:00'));

		// 23:30 JST に始まるイベントは UTC ではまだ同じ日
		const late = timed('2026-10-20 23:30');
		expect(getCalendarReminderTime(late, 'day')).toEqual(jst('2026-10-19 09:00'));
		expect(getCalendarReminderTime(late, 'today')).toEqual(jst('2026-10-20 09:00'));
	});

	test('月・年をまたぐ', () => {
		expect(getCalendarReminderTime(timed('2026-11-03 18:00'), 'week')).toEqual(jst('2026-10-27 09:00'));
		expect(getCalendarReminderTime(allDay('2026-11-01'), 'day')).toEqual(jst('2026-10-31 09:00'));
		expect(getCalendarReminderTime(timed('2026-03-01 10:00'), 'day')).toEqual(jst('2026-02-28 09:00'));
		expect(getCalendarReminderTime(timed('2026-03-01 10:00'), 'week')).toEqual(jst('2026-02-22 09:00'));
		expect(getCalendarReminderTime(timed('2027-01-05 10:00'), 'week')).toEqual(jst('2026-12-29 09:00'));
		expect(getCalendarReminderTime(timed('2027-01-01 08:00'), 'today')).toEqual(jst('2027-01-01 07:00'));
		expect(getCalendarReminderTime(timed('2027-01-01 00:15'), 'today')).toEqual(jst('2026-12-31 23:15'));
	});

	test('1週間前のリマインドは、定期ジョブが見る範囲 (8日先まで) に入る', () => {
		// いちばん早く送るのは 23:59 に始まるイベント
		const event = timed('2026-10-20 23:59');
		const lead = event.startsAt.getTime() - getCalendarReminderTime(event, 'week').getTime();
		expect(lead).toBeLessThan(CALENDAR_REMINDER_LOOKAHEAD_MS);
	});
});

describe('isTooLateForCalendarReminder', () => {
	test('時刻のあるイベントは始まったら遅い', () => {
		const event = timed('2026-10-20 12:00');
		expect(isTooLateForCalendarReminder(event, jst('2026-10-20 11:59'))).toBe(false);
		expect(isTooLateForCalendarReminder(event, jst('2026-10-20 12:00'))).toBe(true);
	});

	test('終日のイベントはその日が終わったら遅い', () => {
		const event = allDay('2026-10-20');
		expect(isTooLateForCalendarReminder(event, jst('2026-10-20 23:59'))).toBe(false);
		expect(isTooLateForCalendarReminder(event, jst('2026-10-21 00:00'))).toBe(true);
	});
});

describe('getDueCalendarReminderKinds', () => {
	const event = timed('2026-10-20 12:00');
	const at = jst('2026-10-19 09:00');

	test('送る時刻から30分の間だけ送る', () => {
		expect(getDueCalendarReminderKinds(event, new Date(at.getTime() - 1))).toEqual([]);
		expect(getDueCalendarReminderKinds(event, at)).toEqual(['day']);
		expect(getDueCalendarReminderKinds(event, new Date(at.getTime() + CALENDAR_REMINDER_WINDOW_MS))).toEqual(['day']);
		expect(getDueCalendarReminderKinds(event, new Date(at.getTime() + CALENDAR_REMINDER_WINDOW_MS + 1))).toEqual([]);
	});

	test('送る時刻を30分以上過ぎてから作ったイベントには、その種類を送らない', () => {
		// 前日の 11:00 に作られたイベントには、前日のリマインドを送らず、当日のリマインドだけ送る
		expect(getDueCalendarReminderKinds(event, jst('2026-10-19 11:00'))).toEqual([]);
		expect(getDueCalendarReminderKinds(event, jst('2026-10-20 09:05'))).toEqual(['today']);
	});

	test('終日のイベントにも当日 9:00 に送る', () => {
		expect(getDueCalendarReminderKinds(allDay('2026-10-20'), jst('2026-10-20 09:10'))).toEqual(['today']);
	});

	test('始まったイベントには送らない', () => {
		const early = timed('2026-10-20 09:20');
		// 当日のリマインドは 9:00。9:20 を過ぎたら、30分の中でも送らない
		expect(getDueCalendarReminderKinds(early, jst('2026-10-20 09:10'))).toEqual(['today']);
		expect(getDueCalendarReminderKinds(early, jst('2026-10-20 09:20'))).toEqual([]);
	});

	test('開始が早朝のイベントは開始の1時間前に送る', () => {
		const early = timed('2026-10-20 07:30');
		expect(getDueCalendarReminderKinds(early, jst('2026-10-20 06:30'))).toEqual(['today']);
		expect(getDueCalendarReminderKinds(early, jst('2026-10-20 06:29'))).toEqual([]);
	});

	test('1週間前のリマインド', () => {
		expect(getDueCalendarReminderKinds(event, jst('2026-10-13 09:00'))).toEqual(['week']);
	});
});
