/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// カレンダー配信 (iCalendar, RFC 5545) の文字列を作る純粋関数。
// 時刻のあるイベントの日時は UTC (末尾 Z) で書き、終日のイベントは日本時間の日付 (VALUE=DATE) で書く

import type { MiCalendarEvent } from '@/models/CalendarEvent.js';
import { formatJstDate } from './calendar-time.js';

const CRLF = '\r\n';

/** 1 行の長さの上限 (オクテット、改行を除く)。RFC 5545 3.1 */
const MAX_LINE_OCTETS = 75;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ICalendarEventLike = Pick<MiCalendarEvent,
	'id' | 'title' | 'startsAt' | 'endsAt' | 'isAllDay' | 'location' | 'description' | 'canceledAt' | 'updatedAt'
> & {
	/** 作成日時 (id から求めたもの) */
	createdAt: Date;
};

export type ICalendarOptions = {
	/** X-WR-CALNAME に入れるカレンダーの名前 */
	name: string;
	/** UID の @ の後ろに付けるホスト名 */
	host: string;
	/** サーバーの URL (末尾の / 無し)。イベントページの URL に使う */
	url: string;
	/** DTSTAMP (この配信を作った日時) */
	now: Date;
};

/**
 * TEXT の値をエスケープする (RFC 5545 3.3.11)。
 * \ ; , と改行をエスケープし、使えない制御文字 (タブ以外) は取り除く
 */
export function escapeICalText(value: string): string {
	return value
		.replace(/\r\n|\r|\n/g, '\n')
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
		.replace(/\n/g, '\\n');
}

/**
 * 1 行を 75 オクテットごとに折り返す (RFC 5545 3.1)。続きの行は空白 1 つで始める (空白も 75 オクテットに数える)。
 * UTF-8 のマルチバイト文字やサロゲートペアの途中では切らない。行の区切りは CRLF
 */
export function foldICalLine(line: string): string {
	const lines: string[] = [];
	let current = '';
	let currentOctets = 0;
	let limit = MAX_LINE_OCTETS;

	// for...of はコードポイントごとに回る (サロゲートペアを分けない)
	for (const char of line) {
		const octets = Buffer.byteLength(char, 'utf8');
		if (currentOctets + octets > limit) {
			lines.push(current);
			current = '';
			currentOctets = 0;
			// 続きの行は先頭の空白の分だけ短くなる
			limit = MAX_LINE_OCTETS - 1;
		}
		current += char;
		currentOctets += octets;
	}
	lines.push(current);

	return lines.join(CRLF + ' ');
}

function pad2(n: number): string {
	return n.toString().padStart(2, '0');
}

/** UTC の日時 (例: 20261020T030000Z) */
export function formatICalDateTime(date: Date): string {
	return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`;
}

/** 日本時間の日付 (例: 20261020) */
export function formatICalJstDate(date: Date): string {
	return formatJstDate(date).replaceAll('-', '');
}

/** イベントページの URL (フロントエンドのページ) */
export function getCalendarEventPageUrl(url: string, eventId: MiCalendarEvent['id']): string {
	return `${url}/calendar/events/${eventId}`;
}

/**
 * 更新のたびに増える値。作成から最後の編集 (中止を含む) までの秒数にする
 */
export function getICalSequence(event: Pick<ICalendarEventLike, 'createdAt' | 'updatedAt'>): number {
	if (event.updatedAt == null) return 0;
	return Math.max(0, Math.floor((event.updatedAt.getTime() - event.createdAt.getTime()) / 1000));
}

function buildEventLines(event: ICalendarEventLike, opts: ICalendarOptions): string[] {
	const pageUrl = getCalendarEventPageUrl(opts.url, event.id);
	const description = event.description != null && event.description !== ''
		? `${event.description}\n\n${pageUrl}`
		: pageUrl;

	const lines = [
		'BEGIN:VEVENT',
		`UID:${event.id}@${opts.host}`,
		`DTSTAMP:${formatICalDateTime(opts.now)}`,
	];

	if (event.isAllDay) {
		// 終日のイベントは開始日の 0:00 (日本時間) で保存している。DTEND は翌日 (含まない)
		lines.push(`DTSTART;VALUE=DATE:${formatICalJstDate(event.startsAt)}`);
		lines.push(`DTEND;VALUE=DATE:${formatICalJstDate(new Date(event.startsAt.getTime() + DAY_MS))}`);
	} else {
		lines.push(`DTSTART:${formatICalDateTime(event.startsAt)}`);
		// 終了時刻の無いイベントは DTEND を省く (RFC 5545 では開始と同じ時刻に終わる扱い)。
		// 1時間などの長さを決めつけると、終わる時刻を決めていないことが伝わらないため
		if (event.endsAt != null) {
			lines.push(`DTEND:${formatICalDateTime(event.endsAt)}`);
		}
	}

	lines.push(`SUMMARY:${escapeICalText(event.title)}`);
	if (event.location != null && event.location !== '') {
		lines.push(`LOCATION:${escapeICalText(event.location)}`);
	}
	lines.push(`DESCRIPTION:${escapeICalText(description)}`);
	lines.push(`URL:${pageUrl}`);
	lines.push(`CREATED:${formatICalDateTime(event.createdAt)}`);
	lines.push(`LAST-MODIFIED:${formatICalDateTime(event.updatedAt ?? event.createdAt)}`);
	lines.push(`SEQUENCE:${getICalSequence(event)}`);
	lines.push(`STATUS:${event.canceledAt != null ? 'CANCELLED' : 'CONFIRMED'}`);
	lines.push('END:VEVENT');
	return lines;
}

/**
 * イベントの配列から VCALENDAR の文字列を作る。行は 75 オクテットで折り返し、改行は CRLF
 */
export function buildICalendar(events: ICalendarEventLike[], opts: ICalendarOptions): string {
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//misskey-42//42times Calendar//JA',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		`X-WR-CALNAME:${escapeICalText(opts.name)}`,
		'X-WR-TIMEZONE:Asia/Tokyo',
		'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
		'X-PUBLISHED-TTL:PT1H',
		...events.flatMap(event => buildEventLines(event, opts)),
		'END:VCALENDAR',
	];
	return lines.map(foldICalLine).join(CRLF) + CRLF;
}
