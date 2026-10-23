/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import {
	buildICalendar,
	escapeICalText,
	foldICalLine,
	formatICalDateTime,
	formatICalJstDate,
	getICalSequence,
} from '@/core/calendar/calendar-ical.js';
import type { ICalendarEventLike } from '@/core/calendar/calendar-ical.js';

const OPTS = {
	name: '42times(購読中)',
	host: '42times.example.com',
	url: 'https://42times.example.com',
	now: new Date('2026-10-18T10:00:00.000Z'),
};

function event(overrides: Partial<ICalendarEventLike> = {}): ICalendarEventLike {
	return {
		id: 'aaaaaaaaaa',
		title: 'もくもく会',
		// 2026-10-20 12:00〜13:00 JST
		startsAt: new Date('2026-10-20T03:00:00.000Z'),
		endsAt: new Date('2026-10-20T04:00:00.000Z'),
		isAllDay: false,
		location: 'c3',
		description: null,
		canceledAt: null,
		updatedAt: null,
		createdAt: new Date('2026-10-01T00:00:00.000Z'),
		...overrides,
	};
}

/** 折り返しを戻して、行の配列にする */
function unfold(ics: string): string[] {
	return ics.replace(/\r\n /g, '').split('\r\n');
}

describe('escapeICalText', () => {
	test('\\ ; , と改行をエスケープする', () => {
		expect(escapeICalText('a\\b;c,d')).toBe('a\\\\b\\;c\\,d');
		expect(escapeICalText('1行目\n2行目\r\n3行目\r4行目')).toBe('1行目\\n2行目\\n3行目\\n4行目');
	});

	test('タブ以外の制御文字は取り除く', () => {
		expect(escapeICalText('a\u0000b\u0007c\td\u007F')).toBe('abc\td');
	});

	test('コロンなどはそのまま', () => {
		expect(escapeICalText('URL: https://example.com/?a=1')).toBe('URL: https://example.com/?a=1');
	});
});

describe('foldICalLine', () => {
	test('75 オクテット以下ならそのまま', () => {
		const line = 'a'.repeat(75);
		expect(foldICalLine(line)).toBe(line);
	});

	test('75 オクテットを超えると CRLF と空白で折り返す。続きの行は空白を含めて 75 オクテット', () => {
		const folded = foldICalLine('a'.repeat(200));
		const lines = folded.split('\r\n');
		expect(lines[0]).toBe('a'.repeat(75));
		expect(lines[1]).toBe(' ' + 'a'.repeat(74));
		expect(lines[2]).toBe(' ' + 'a'.repeat(51));
		for (const l of lines) expect(Buffer.byteLength(l, 'utf8')).toBeLessThanOrEqual(75);
		expect(folded.replace(/\r\n /g, '')).toBe('a'.repeat(200));
	});

	test('UTF-8 のマルチバイト文字の途中で切らない', () => {
		// 「あ」は 3 オクテット。'SUMMARY:' (8) + 3 * 23 = 77 なので 22 文字目までが 1 行目に入る
		const line = 'SUMMARY:' + 'あ'.repeat(40);
		const lines = foldICalLine(line).split('\r\n');
		expect(lines[0]).toBe('SUMMARY:' + 'あ'.repeat(22));
		for (const l of lines) {
			expect(Buffer.byteLength(l, 'utf8')).toBeLessThanOrEqual(75);
			// 壊れた文字 (U+FFFD) が出ない
			expect(Buffer.from(l, 'utf8').toString('utf8')).toBe(l);
		}
		expect(lines.map((l, i) => i === 0 ? l : l.slice(1)).join('')).toBe(line);
	});

	test('絵文字 (サロゲートペア、4 オクテット) を分けない', () => {
		const line = 'X'.repeat(73) + '🎉🎉';
		const lines = foldICalLine(line).split('\r\n');
		expect(lines[0]).toBe('X'.repeat(73));
		expect(lines[1]).toBe(' 🎉🎉');
	});
});

describe('日時の書式', () => {
	test('UTC の日時と日本時間の日付', () => {
		expect(formatICalDateTime(new Date('2026-10-20T03:04:05.678Z'))).toBe('20261020T030405Z');
		// 2026-10-20 0:00 JST は UTC では前日の 15:00
		expect(formatICalJstDate(new Date('2026-10-19T15:00:00.000Z'))).toBe('20261020');
	});

	test('SEQUENCE は作成から最後の編集までの秒数', () => {
		const createdAt = new Date('2026-10-01T00:00:00.000Z');
		expect(getICalSequence({ createdAt, updatedAt: null })).toBe(0);
		expect(getICalSequence({ createdAt, updatedAt: new Date('2026-10-01T00:01:30.900Z') })).toBe(90);
	});
});

describe('buildICalendar', () => {
	test('カレンダーの見出しと、時刻のあるイベント', () => {
		const ics = buildICalendar([event()], OPTS);
		expect(ics.endsWith('\r\n')).toBe(true);
		// CRLF 以外の改行が無い
		expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);

		const lines = unfold(ics);
		expect(lines.slice(0, 9)).toEqual([
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'PRODID:-//misskey-42//42times Calendar//JA',
			'CALSCALE:GREGORIAN',
			'METHOD:PUBLISH',
			'X-WR-CALNAME:42times(購読中)',
			'X-WR-TIMEZONE:Asia/Tokyo',
			'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
			'X-PUBLISHED-TTL:PT1H',
		]);
		expect(lines).toContain('UID:aaaaaaaaaa@42times.example.com');
		expect(lines).toContain('DTSTAMP:20261018T100000Z');
		expect(lines).toContain('DTSTART:20261020T030000Z');
		expect(lines).toContain('DTEND:20261020T040000Z');
		expect(lines).toContain('SUMMARY:もくもく会');
		expect(lines).toContain('LOCATION:c3');
		expect(lines).toContain('DESCRIPTION:https://42times.example.com/calendar/events/aaaaaaaaaa');
		expect(lines).toContain('URL:https://42times.example.com/calendar/events/aaaaaaaaaa');
		expect(lines).toContain('CREATED:20261001T000000Z');
		expect(lines).toContain('LAST-MODIFIED:20261001T000000Z');
		expect(lines).toContain('SEQUENCE:0');
		expect(lines).toContain('STATUS:CONFIRMED');
		expect(lines.slice(-2)).toEqual(['END:VCALENDAR', '']);
	});

	test('終日のイベントは日本時間の日付で、DTEND は翌日', () => {
		const lines = unfold(buildICalendar([event({ isAllDay: true, startsAt: new Date('2026-10-19T15:00:00.000Z'), endsAt: null })], OPTS));
		expect(lines).toContain('DTSTART;VALUE=DATE:20261020');
		expect(lines).toContain('DTEND;VALUE=DATE:20261021');
		expect(lines.some(l => l.startsWith('DTSTART:'))).toBe(false);
	});

	test('月末の終日のイベントの DTEND は翌月', () => {
		const lines = unfold(buildICalendar([event({ isAllDay: true, startsAt: new Date('2026-10-30T15:00:00.000Z'), endsAt: null })], OPTS));
		expect(lines).toContain('DTSTART;VALUE=DATE:20261031');
		expect(lines).toContain('DTEND;VALUE=DATE:20261101');
	});

	test('終了時刻の無いイベントは DTEND を省く', () => {
		const lines = unfold(buildICalendar([event({ endsAt: null })], OPTS));
		expect(lines.some(l => l.startsWith('DTEND'))).toBe(false);
	});

	test('中止・編集したイベント、場所の無いイベント', () => {
		const lines = unfold(buildICalendar([event({
			location: null,
			canceledAt: new Date('2026-10-02T00:00:00.000Z'),
			updatedAt: new Date('2026-10-02T00:00:00.000Z'),
		})], OPTS));
		expect(lines).toContain('STATUS:CANCELLED');
		expect(lines).toContain('LAST-MODIFIED:20261002T000000Z');
		expect(lines).toContain('SEQUENCE:86400');
		expect(lines.some(l => l.startsWith('LOCATION'))).toBe(false);
	});

	test('説明とイベントページの URL を DESCRIPTION に入れ、エスケープする', () => {
		const lines = unfold(buildICalendar([event({ title: 'A, B; C', description: '持ち物: PC\n場所は c3' })], OPTS));
		expect(lines).toContain('SUMMARY:A\\, B\\; C');
		expect(lines).toContain('DESCRIPTION:持ち物: PC\\n場所は c3\\n\\nhttps://42times.example.com/calendar/events/aaaaaaaaaa');
	});

	test('長い説明は折り返し、どの行も 75 オクテット以下', () => {
		const ics = buildICalendar([event({ description: 'ボードゲームをします。'.repeat(50) })], OPTS);
		for (const line of ics.split('\r\n')) {
			expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
		}
		expect(unfold(ics).find(l => l.startsWith('DESCRIPTION:'))).toBe(`DESCRIPTION:${'ボードゲームをします。'.repeat(50)}\\n\\nhttps://42times.example.com/calendar/events/aaaaaaaaaa`);
	});

	test('イベントが無くてもカレンダーは作る', () => {
		const lines = unfold(buildICalendar([], OPTS));
		expect(lines.filter(l => l === 'BEGIN:VEVENT')).toHaveLength(0);
		expect(lines).toContain('END:VCALENDAR');
	});

	test('複数のイベントを順に入れる', () => {
		const lines = unfold(buildICalendar([event({ id: 'e1' }), event({ id: 'e2' })], OPTS));
		expect(lines.filter(l => l.startsWith('UID:'))).toEqual(['UID:e1@42times.example.com', 'UID:e2@42times.example.com']);
		expect(lines.filter(l => l === 'BEGIN:VEVENT')).toHaveLength(2);
		expect(lines.filter(l => l === 'END:VEVENT')).toHaveLength(2);
	});
});
