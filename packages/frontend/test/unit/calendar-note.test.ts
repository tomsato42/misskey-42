/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import {
	buildCalendarNoteParams,
	getCalendarNoteFormUnavailableReason,
	getCalendarNoteUnlinkableReason,
} from '@/utility/calendar-note.js';
import { buildGoogleCalendarSubscribeUrl, toWebcalUrl } from '@/utility/calendar-feed.js';
import { addCalendarToMenu } from '@/utility/calendar-menu.js';
import type { CalendarEventParams } from '@/utility/calendar-event-form.js';

const announce: CalendarEventParams = {
	title: 'もくもく会',
	date: '2026-10-20',
	startTime: '12:00',
	endTime: null,
	isAllDay: false,
	location: null,
	hashtag: null,
	visibility: 'public',
};

describe('投稿フォームのイベントを扱えない理由', () => {
	test('ダイレクトは specified', () => {
		expect(getCalendarNoteFormUnavailableReason({ visibility: 'specified', scheduledAt: null })).toBe('specified');
	});

	test('予約投稿は scheduled', () => {
		expect(getCalendarNoteFormUnavailableReason({ visibility: 'public', scheduledAt: 1 })).toBe('scheduled');
	});

	test('ダイレクトの予約投稿は specified を優先する', () => {
		expect(getCalendarNoteFormUnavailableReason({ visibility: 'specified', scheduledAt: 1 })).toBe('specified');
	});

	test('公開・ホーム・フォロワーは扱える', () => {
		for (const visibility of ['public', 'home', 'followers']) {
			expect(getCalendarNoteFormUnavailableReason({ visibility, scheduledAt: null })).toBeNull();
		}
	});
});

describe('イベントに紐づけられないノート', () => {
	test('ダイレクト', () => {
		expect(getCalendarNoteUnlinkableReason({ visibility: 'specified', text: 'a' })).toBe('specifiedVisibility');
	});

	test('本文などの無いリノート', () => {
		expect(getCalendarNoteUnlinkableReason({ visibility: 'public', renoteId: 'x', text: null, cw: null, poll: null })).toBe('pureRenote');
		expect(getCalendarNoteUnlinkableReason({ visibility: 'public', renoteId: 'x', fileIds: [] })).toBe('pureRenote');
	});

	test('引用 (本文・CW・ファイル・アンケート・返信のどれかがある) は紐づけられる', () => {
		expect(getCalendarNoteUnlinkableReason({ visibility: 'public', renoteId: 'x', text: 'a' })).toBeNull();
		expect(getCalendarNoteUnlinkableReason({ visibility: 'public', renoteId: 'x', cw: '' })).toBeNull();
		expect(getCalendarNoteUnlinkableReason({ visibility: 'public', renoteId: 'x', fileIds: ['f'] })).toBeNull();
		expect(getCalendarNoteUnlinkableReason({ visibility: 'public', renoteId: 'x', poll: { choices: ['a', 'b'] } })).toBeNull();
		expect(getCalendarNoteUnlinkableReason({ visibility: 'public', renoteId: 'x', replyId: 'y' })).toBeNull();
	});

	test('普通のノート', () => {
		expect(getCalendarNoteUnlinkableReason({ visibility: 'home', text: 'a' })).toBeNull();
	});
});

describe('notes/create に足すイベントのパラメータ', () => {
	test('告知を優先し、紐づけと同時には送らない', () => {
		expect(buildCalendarNoteParams({ announce, linkedEventId: 'e' })).toEqual({ calendarEvent: announce });
	});

	test('紐づけ', () => {
		expect(buildCalendarNoteParams({ announce: null, linkedEventId: 'e' })).toEqual({ calendarEventId: 'e' });
	});

	test('どちらも無ければ空', () => {
		expect(buildCalendarNoteParams({ announce: null, linkedEventId: null })).toEqual({});
	});
});

describe('カレンダー配信の URL', () => {
	const url = 'https://42times.example/calendar/feed/subscribed/abc_DEF-123.ics';

	test('webcal:// にする', () => {
		expect(toWebcalUrl(url)).toBe('webcal://42times.example/calendar/feed/subscribed/abc_DEF-123.ics');
		expect(toWebcalUrl('http://localhost:3000/a.ics')).toBe('webcal://localhost:3000/a.ics');
	});

	test('Google カレンダーのリンクは webcal:// の URL をエンコードして cid に入れる', () => {
		expect(buildGoogleCalendarSubscribeUrl(url)).toBe(`https://calendar.google.com/calendar/render?cid=${encodeURIComponent('webcal://42times.example/calendar/feed/subscribed/abc_DEF-123.ics')}`);
	});
});

describe('メニューにカレンダーを足す', () => {
	test('notifications の直後に入れる', () => {
		expect(addCalendarToMenu(['notifications', 'clips', 'drive'])).toEqual(['notifications', 'calendar', 'clips', 'drive']);
	});

	test('notifications が無ければ先頭に入れる', () => {
		expect(addCalendarToMenu(['clips', '-', 'ui'])).toEqual(['calendar', 'clips', '-', 'ui']);
	});

	test('すでにあれば同じ配列を返す', () => {
		const menu = ['drive', 'calendar'];
		expect(addCalendarToMenu(menu)).toBe(menu);
	});

	test('元の配列は書き換えない', () => {
		const menu = ['notifications'];
		addCalendarToMenu(menu);
		expect(menu).toEqual(['notifications']);
	});
});
