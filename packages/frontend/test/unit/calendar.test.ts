/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import * as Misskey from 'misskey-js';
import {
	addDays,
	buildCalendarDateGroups,
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
import { getCalendarVisibilityIcon, isCalendarVisibilityNarrowerThanNote, noteVisibilityToCalendarVisibility } from '@/utility/calendar-visibility.js';
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
		visibility: 'public',
		visibleUsers: [],
		userListId: null,
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
		visibility: 'public',
		visibleUserIds: [],
		userListId: null,
	} as unknown as Misskey.entities.CalendarEvent;

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
			visibility: 'public',
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
			visibility: 'public',
		});
		expect('description' in allDay).toBe(false);
	});

	test('公開範囲は、指定ユーザー・リストのときだけそれぞれの項目を送る', () => {
		const alice = { id: 'alice' } as Misskey.entities.UserLite;
		expect(calendarEventFormToParams({ ...valid, visibility: 'specified', visibleUsers: [alice], userListId: 'list1' })).toMatchObject({ visibility: 'specified', visibleUserIds: ['alice'] });
		expect(calendarEventFormToParams({ ...valid, visibility: 'specified', visibleUsers: [alice] })).not.toHaveProperty('userListId');
		expect(calendarEventFormToParams({ ...valid, visibility: 'list', visibleUsers: [alice], userListId: 'list1' })).toMatchObject({ visibility: 'list', userListId: 'list1' });
		expect(calendarEventFormToParams({ ...valid, visibility: 'list', userListId: 'list1' })).not.toHaveProperty('visibleUserIds');
		expect(calendarEventFormToParams({ ...valid, visibility: 'mutual', visibleUsers: [alice] })).not.toHaveProperty('visibleUserIds');
	});

	test('指定ユーザーが居ない・リストを選んでいないときはエラー', () => {
		expect(validateCalendarEventForm({ ...valid, visibility: 'specified' })).toEqual({ visibility: 'visibleUsersRequired' });
		expect(validateCalendarEventForm({ ...valid, visibility: 'specified', visibleUsers: [{ id: 'a' } as Misskey.entities.UserLite] })).toEqual({});
		expect(validateCalendarEventForm({ ...valid, visibility: 'list' })).toEqual({ visibility: 'userListRequired' });
		expect(validateCalendarEventForm({ ...valid, visibility: 'list', userListId: 'list1' })).toEqual({});
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

	test('編集で公開範囲を変えたときは、種類と指定ユーザー・リストをまとめて送る', () => {
		const specifiedEvent = { ...event, visibility: 'specified', visibleUserIds: ['alice', 'bob'] } as Misskey.entities.CalendarEvent;
		const users = [{ id: 'bob' }, { id: 'alice' }] as Misskey.entities.UserLite[];
		// 並びが違うだけなら変わっていない
		expect(calendarEventFormToUpdateParams(specifiedEvent, calendarEventToForm(specifiedEvent, users))).toEqual({});
		expect(calendarEventFormToUpdateParams(specifiedEvent, calendarEventToForm(specifiedEvent, users.slice(0, 1)))).toEqual({ visibility: 'specified', visibleUserIds: ['bob'] });
		expect(calendarEventFormToUpdateParams(specifiedEvent, { ...calendarEventToForm(specifiedEvent, users), visibility: 'public' })).toEqual({ visibility: 'public' });
		expect(calendarEventFormToUpdateParams(event, { ...calendarEventToForm(event), visibility: 'list', userListId: 'list1' })).toEqual({ visibility: 'list', userListId: 'list1' });
	});

	test('検証エラーの理由と欄の対応', () => {
		expect(calendarEventReasonToField('endNotSameDay')).toBe('endTime');
		expect(calendarEventReasonToField('invalidHashtag')).toBe('hashtag');
		expect(calendarEventReasonToField('invalidMonth')).toBeNull();
		expect(calendarEventReasonToField('visibleUsersRequired')).toBe('visibility');
		expect(calendarEventReasonToField('invalidUserList')).toBe('visibility');
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
		// 指定ユーザーを足すと公開範囲の欄のエラーも消える
		expect(clearChangedCalendarEventFormErrors({ visibility: 'visibleUsersRequired' }, { ...prev, visibility: 'specified' }, { ...prev, visibility: 'specified', visibleUsers: [{ id: 'a' } as Misskey.entities.UserLite] })).toEqual({});
	});

	test('新しいフォームの公開範囲は、指定しなければ全員', () => {
		expect(createEmptyCalendarEventForm('2026-10-20').visibility).toBe('public');
		expect(createEmptyCalendarEventForm('2026-10-20', 'followers')).toMatchObject({ visibility: 'followers', visibleUsers: [], userListId: null });
	});
});

describe('calendar-visibility', () => {
	test('ノートの公開範囲に合わせた初期値', () => {
		expect(noteVisibilityToCalendarVisibility('public')).toBe('public');
		expect(noteVisibilityToCalendarVisibility('home')).toBe('public');
		expect(noteVisibilityToCalendarVisibility('followers')).toBe('followers');
	});

	test('イベントの公開範囲がノートより狭いか', () => {
		expect(isCalendarVisibilityNarrowerThanNote('public', 'public')).toBe(false);
		expect(isCalendarVisibilityNarrowerThanNote('followers', 'public')).toBe(true);
		expect(isCalendarVisibilityNarrowerThanNote('followers', 'home')).toBe(true);
		expect(isCalendarVisibilityNarrowerThanNote('followers', 'followers')).toBe(false);
		expect(isCalendarVisibilityNarrowerThanNote('public', 'followers')).toBe(false);
		for (const visibility of ['mutual', 'specified', 'list'] as const) {
			expect(isCalendarVisibilityNarrowerThanNote(visibility, 'followers')).toBe(true);
		}
	});

	test('アイコンは投稿の公開範囲とそろえる', () => {
		expect(getCalendarVisibilityIcon('public')).toBe('ti ti-world');
		expect(getCalendarVisibilityIcon('followers')).toBe('ti ti-lock');
		expect(getCalendarVisibilityIcon('specified')).toBe('ti ti-mail');
	});
});

describe('buildCalendarDateGroups', () => {
	const byDate = new Map([
		['2026-10-21', ['c']],
		['2026-10-02', ['a']],
		['2026-10-19', ['b']],
	]);

	test('日付順に並べ、今日以降の最初の日の前に区切りを入れる', () => {
		expect(buildCalendarDateGroups(byDate, '2026-10-19')).toEqual([
			{ date: '2026-10-02', events: ['a'], isPast: true, isToday: false, todayDividerBefore: false },
			{ date: '2026-10-19', events: ['b'], isPast: false, isToday: true, todayDividerBefore: true },
			{ date: '2026-10-21', events: ['c'], isPast: false, isToday: false, todayDividerBefore: false },
		]);
	});

	test('今日にイベントが無ければ次の日の前、すべて過去・すべてこれからなら区切りは無い', () => {
		expect(buildCalendarDateGroups(byDate, '2026-10-20').map(g => g.todayDividerBefore)).toEqual([false, false, true]);
		expect(buildCalendarDateGroups(byDate, '2026-10-31').some(g => g.todayDividerBefore)).toBe(false);
		expect(buildCalendarDateGroups(byDate, '2026-10-01').some(g => g.todayDividerBefore)).toBe(false);
	});
});
