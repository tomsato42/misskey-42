/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import * as Misskey from 'misskey-js';
import {
	addDays,
	buildMonthGrid,
	currentJstYearMonth,
	dayOfWeek,
	diffDays,
	groupCalendarEventsByDate,
	parseCalendarDate,
	parseYearMonth,
	shiftYearMonth,
	toJstDateString,
} from '@/utility/calendar.js';
import {
	calendarEventFormToParams,
	calendarEventFormToUpdateParams,
	calendarEventReasonToField,
	calendarEventToForm,
	clearChangedCalendarEventFormErrors,
	createEmptyCalendarEventForm,
	getCalendarEventValidationReason,
	validateCalendarEventForm,
} from '@/utility/calendar-event-form.js';
import type { CalendarEventFormValue } from '@/utility/calendar-event-form.js';
import {
	buildCalendarEventIcs,
	escapeIcsText,
	foldIcsLine,
	formatIcsDateTime,
	getCalendarEventIcsFileName,
} from '@/utility/calendar-ics.js';
import type { IcsCalendarEvent } from '@/utility/calendar-ics.js';

describe('calendar の日付', () => {
	test('年月と日付を読む', () => {
		expect(parseYearMonth('2026-10')).toEqual({ year: 2026, month: 10 });
		expect(parseYearMonth('2026-13')).toBeNull();
		expect(parseYearMonth('2026-1')).toBeNull();
		expect(parseYearMonth(undefined)).toBeNull();
		expect(parseCalendarDate('2026-02-29')).toBeNull();
		expect(parseCalendarDate('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
	});

	test('日本時間の日付にする (UTC では前日の 15:00 から日付が変わる)', () => {
		expect(toJstDateString(new Date('2026-10-19T14:59:59Z'))).toBe('2026-10-19');
		expect(toJstDateString(new Date('2026-10-19T15:00:00Z'))).toBe('2026-10-20');
		expect(currentJstYearMonth(new Date('2026-10-31T15:00:00Z'))).toBe('2026-11');
	});

	test('月をずらす', () => {
		expect(shiftYearMonth('2026-10', 1)).toBe('2026-11');
		expect(shiftYearMonth('2026-12', 1)).toBe('2027-01');
		expect(shiftYearMonth('2026-01', -1)).toBe('2025-12');
		expect(shiftYearMonth('2026-10', -22)).toBe('2024-12');
	});

	test('曜日・日数の加算・差', () => {
		expect(dayOfWeek('2026-10-18')).toBe(0);
		expect(dayOfWeek('2026-10-20')).toBe(2);
		expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
		expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
		expect(diffDays('2026-10-20', '2026-10-18')).toBe(2);
		expect(diffDays('2026-10-18', '2026-10-20')).toBe(-2);
	});

	test('月グリッドは日曜はじまりで、前後の月の日で週を埋める', () => {
		// 2026年10月1日は木曜、31日は土曜
		const days = buildMonthGrid('2026-10');
		expect(days.length).toBe(35);
		expect(days[0]).toEqual({ date: '2026-09-27', day: 27, inMonth: false, dayOfWeek: 0 });
		expect(days[4]).toEqual({ date: '2026-10-01', day: 1, inMonth: true, dayOfWeek: 4 });
		expect(days[34]).toEqual({ date: '2026-10-31', day: 31, inMonth: true, dayOfWeek: 6 });
		expect(days.filter(d => d.inMonth).length).toBe(31);
	});

	test('6 週になる月と 4 週になる月', () => {
		// 2026年8月1日は土曜なので 6 週
		expect(buildMonthGrid('2026-08').length).toBe(42);
		// 2026年2月1日は日曜で 28 日なので 4 週
		const feb = buildMonthGrid('2026-02');
		expect(feb.length).toBe(28);
		expect(feb[0].date).toBe('2026-02-01');
		expect(feb[27].date).toBe('2026-02-28');
	});

	test('イベントを日付ごとに分け、終日を先にして開始時刻順に並べる', () => {
		const events = [
			{ id: 'c', date: '2026-10-20', startTime: '19:00', isAllDay: false },
			{ id: 'a', date: '2026-10-20', startTime: null, isAllDay: true },
			{ id: 'd', date: '2026-10-21', startTime: '07:30', isAllDay: false },
			{ id: 'b', date: '2026-10-20', startTime: '12:00', isAllDay: false },
		];
		const grouped = groupCalendarEventsByDate(events);
		expect(grouped.get('2026-10-20')!.map(e => e.id)).toEqual(['a', 'b', 'c']);
		expect(grouped.get('2026-10-21')!.map(e => e.id)).toEqual(['d']);
		expect(grouped.get('2026-10-22')).toBeUndefined();
	});
});

describe('calendar-ics', () => {
	const base: IcsCalendarEvent = {
		id: 'abc123',
		title: 'もくもく会',
		date: '2026-10-20',
		isAllDay: false,
		startsAt: '2026-10-20T03:00:00.000Z',
		endsAt: '2026-10-20T06:00:00.000Z',
		location: 'c3',
		description: null,
		isCanceled: false,
	};
	const options = { host: '42times.example.com', url: 'https://42times.example.com/calendar/events/abc123', now: new Date('2026-10-18T01:02:03.456Z') };

	test('TEXT の値をエスケープする', () => {
		expect(escapeIcsText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
	});

	test('日時を UTC の DATE-TIME にする', () => {
		expect(formatIcsDateTime('2026-10-20T03:00:00.000Z')).toBe('20261020T030000Z');
	});

	test('時刻のあるイベント', () => {
		const ics = buildCalendarEventIcs(base, options);
		expect(ics.endsWith('\r\n')).toBe(true);
		expect(ics.split('\r\n')).toEqual([
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'PRODID:-//42times.example.com//Calendar//JA',
			'CALSCALE:GREGORIAN',
			'METHOD:PUBLISH',
			'BEGIN:VEVENT',
			'UID:abc123@42times.example.com',
			'DTSTAMP:20261018T010203Z',
			'DTSTART:20261020T030000Z',
			'DTEND:20261020T060000Z',
			'SUMMARY:もくもく会',
			'LOCATION:c3',
			'URL:https://42times.example.com/calendar/events/abc123',
			'END:VEVENT',
			'END:VCALENDAR',
			'',
		]);
		// CRLF 以外の改行を含まない
		expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
	});

	test('終日のイベントは DATE で、DTEND は翌日', () => {
		const ics = buildCalendarEventIcs({ ...base, isAllDay: true, date: '2026-10-31', startsAt: '2026-10-30T15:00:00.000Z', endsAt: null }, options);
		expect(ics).toContain('\r\nDTSTART;VALUE=DATE:20261031\r\n');
		expect(ics).toContain('\r\nDTEND;VALUE=DATE:20261101\r\n');
	});

	test('終了時刻が無ければ DTEND を入れない。中止なら STATUS:CANCELLED', () => {
		const ics = buildCalendarEventIcs({ ...base, endsAt: null, location: null, isCanceled: true }, options);
		expect(ics).not.toContain('DTEND');
		expect(ics).not.toContain('LOCATION');
		expect(ics).toContain('\r\nSTATUS:CANCELLED\r\n');
	});

	test('説明の改行と記号をエスケープする', () => {
		const ics = buildCalendarEventIcs({ ...base, description: '持ち物: PC, 充電器\n途中参加OK;' }, options);
		expect(ics).toContain('\r\nDESCRIPTION:持ち物: PC\\, 充電器\\n途中参加OK\\;\r\n');
	});

	test('75 オクテットを超える行は、文字の途中で切らずに折り返す', () => {
		const line = 'DESCRIPTION:' + 'あ'.repeat(40);
		const folded = foldIcsLine(line);
		const parts = folded.split('\r\n');
		expect(parts.length).toBeGreaterThan(1);
		const encoder = new TextEncoder();
		for (const [i, part] of parts.entries()) {
			expect(encoder.encode(part).length).toBeLessThanOrEqual(75);
			if (i > 0) expect(part.startsWith(' ')).toBe(true);
		}
		// 折り返しを戻すと元の行になる
		expect(folded.replace(/\r\n /g, '')).toBe(line);
	});

	test('短い行は折り返さない', () => {
		expect(foldIcsLine('SUMMARY:abc')).toBe('SUMMARY:abc');
	});

	test('ファイル名に使えない文字を除く', () => {
		expect(getCalendarEventIcsFileName({ id: 'x', title: 'a/b:c*?"<>|d' })).toBe('abcd.ics');
		expect(getCalendarEventIcsFileName({ id: 'x', title: '///' })).toBe('x.ics');
	});
});

describe('calendar-event-form', () => {
	const valid: CalendarEventFormValue = {
		title: 'もくもく会',
		date: '2026-10-20',
		startTime: '12:00',
		endTime: '15:00',
		isAllDay: false,
		location: 'c3',
		hashtag: '#mokumoku',
		description: '',
	};

	const event = {
		id: 'abc123',
		title: 'もくもく会',
		date: '2026-10-20',
		startTime: '12:00',
		endTime: '15:00',
		isAllDay: false,
		location: 'c3',
		hashtag: 'mokumoku',
		description: null,
	} as Misskey.entities.CalendarEvent;

	test('正しい入力にはエラーが無い', () => {
		expect(validateCalendarEventForm(valid)).toEqual({});
		expect(validateCalendarEventForm({ ...valid, isAllDay: true, startTime: '', endTime: '' })).toEqual({});
		expect(validateCalendarEventForm({ ...valid, endTime: '' })).toEqual({});
	});

	test('必須・時刻の前後・長さを調べる', () => {
		expect(validateCalendarEventForm({ ...valid, title: '  ' })).toEqual({ title: 'titleRequired' });
		expect(validateCalendarEventForm({ ...valid, title: 'あ'.repeat(101) })).toEqual({ title: 'titleTooLong' });
		expect(validateCalendarEventForm({ ...valid, date: '' })).toEqual({ date: 'invalidDate' });
		expect(validateCalendarEventForm({ ...valid, startTime: '' })).toEqual({ startTime: 'startTimeRequired' });
		expect(validateCalendarEventForm({ ...valid, endTime: '12:00' })).toEqual({ endTime: 'endNotAfterStart' });
		expect(validateCalendarEventForm({ ...valid, location: 'a'.repeat(129) })).toEqual({ location: 'locationTooLong' });
		expect(validateCalendarEventForm({ ...valid, description: 'a'.repeat(3001) })).toEqual({ description: 'descriptionTooLong' });
		expect(validateCalendarEventForm({ ...valid, description: 'a'.repeat(3001) }, { withDescription: false })).toEqual({});
	});

	test('API のパラメータにする', () => {
		expect(calendarEventFormToParams(valid)).toEqual({
			title: 'もくもく会',
			date: '2026-10-20',
			startTime: '12:00',
			endTime: '15:00',
			isAllDay: false,
			location: 'c3',
			hashtag: 'mokumoku',
			description: null,
		});
		const allDay = calendarEventFormToParams({ ...valid, isAllDay: true, location: ' ', hashtag: '' }, { withDescription: false });
		expect(allDay).toEqual({
			title: 'もくもく会',
			date: '2026-10-20',
			startTime: null,
			endTime: null,
			isAllDay: true,
			location: null,
			hashtag: null,
		});
		expect('description' in allDay).toBe(false);
	});

	test('編集では変わった項目だけを送る', () => {
		expect(calendarEventFormToUpdateParams(event, calendarEventToForm(event))).toEqual({});
		expect(calendarEventFormToUpdateParams(event, { ...calendarEventToForm(event), title: '新しい名前' })).toEqual({ title: '新しい名前' });
		expect(calendarEventFormToUpdateParams(event, { ...calendarEventToForm(event), endTime: '16:00' })).toEqual({
			date: '2026-10-20',
			startTime: '12:00',
			endTime: '16:00',
			isAllDay: false,
		});
		expect(calendarEventFormToUpdateParams(event, { ...calendarEventToForm(event), hashtag: '' })).toEqual({ hashtag: null });
	});

	test('検証エラーの理由と欄の対応', () => {
		expect(calendarEventReasonToField('endNotSameDay')).toBe('endTime');
		expect(calendarEventReasonToField('invalidHashtag')).toBe('hashtag');
		expect(calendarEventReasonToField('invalidMonth')).toBeNull();
	});

	test('API のエラーから理由を取り出す', () => {
		expect(getCalendarEventValidationReason({ code: 'INVALID_CALENDAR_EVENT', info: { reason: 'titleTooLong' } })).toBe('titleTooLong');
		expect(getCalendarEventValidationReason({ code: 'INVALID_CALENDAR_EVENT', info: { reason: 'unknown' } })).toBeNull();
		expect(getCalendarEventValidationReason({ code: 'ACCESS_DENIED', info: {} })).toBeNull();
		expect(getCalendarEventValidationReason(null)).toBeNull();
	});

	test('入力し直した欄のエラーを消す', () => {
		const prev = createEmptyCalendarEventForm('2026-10-20');
		const errors = { title: 'titleRequired', startTime: 'startTimeRequired' } as const;
		expect(clearChangedCalendarEventFormErrors(errors, prev, { ...prev, title: 'a' })).toEqual({ startTime: 'startTimeRequired' });
		expect(clearChangedCalendarEventFormErrors(errors, prev, { ...prev, isAllDay: true })).toEqual({ title: 'titleRequired' });
		expect(clearChangedCalendarEventFormErrors({ endTime: 'endNotAfterStart' }, { ...prev, startTime: '12:00' }, { ...prev, startTime: '11:00' })).toEqual({});
	});
});
