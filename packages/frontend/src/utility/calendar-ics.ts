/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// イベント 1 件を iCalendar (RFC 5545) のファイルにする。イベントページの「カレンダーに追加」で、ブラウザ側で作ってダウンロードさせる。
// UID はカレンダー配信 (/calendar/feed/...) と同じ `<イベントの ID>@<ホスト名>` にして、両方を取り込んでも同じ予定として扱われるようにする

import { addDays, parseCalendarDate } from '@/utility/calendar.js';

export type IcsCalendarEvent = {
	id: string;
	title: string;
	/** 'YYYY-MM-DD' (日本時間) */
	date: string;
	isAllDay: boolean;
	/** ISO 8601 */
	startsAt: string;
	/** ISO 8601。終了時刻が無いときと終日のときは null */
	endsAt: string | null;
	location: string | null;
	description: string | null;
	isCanceled: boolean;
};

const CRLF = '\r\n';
const MAX_LINE_OCTETS = 75;

/** TEXT の値のエスケープ (RFC 5545 3.3.11)。改行は \n にする */
export function escapeIcsText(value: string): string {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
		.replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * 75 オクテットを超える行を折り返す (RFC 5545 3.1)。続きの行は空白 1 つで始める。
 * UTF-8 の文字 (サロゲートペアを含む) の途中では切らない
 */
export function foldIcsLine(line: string): string {
	const encoder = new TextEncoder();
	const parts: string[] = [];
	let current = '';
	let currentOctets = 0;
	// 2 行目以降は先頭の空白の分だけ短くする
	let limit = MAX_LINE_OCTETS;

	for (const char of line) {
		const octets = encoder.encode(char).length;
		if (currentOctets + octets > limit) {
			parts.push(current);
			current = '';
			currentOctets = 0;
			limit = MAX_LINE_OCTETS - 1;
		}
		current += char;
		currentOctets += octets;
	}
	parts.push(current);

	return parts.join(CRLF + ' ');
}

/** 日時を UTC の DATE-TIME (例: 20261020T030000Z) にする */
export function formatIcsDateTime(value: string | Date): string {
	const date = typeof value === 'string' ? new Date(value) : value;
	if (Number.isNaN(date.getTime())) throw new Error(`invalid date-time: ${String(value)}`);
	return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** 'YYYY-MM-DD' を DATE (例: 20261020) にする */
export function formatIcsDate(value: string): string {
	if (parseCalendarDate(value) == null) throw new Error(`invalid date: ${value}`);
	return value.replace(/-/g, '');
}

/**
 * イベント 1 件の .ics の中身。行の区切りは CRLF で、最後の行も CRLF で終える
 * @param options.host UID に使うホスト名
 * @param options.url イベントページの URL
 * @param options.now DTSTAMP に使う日時 (ファイルを作った日時)
 */
export function buildCalendarEventIcs(event: IcsCalendarEvent, options: { host: string; url: string; now: Date }): string {
	const lines: string[] = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		`PRODID:-//${escapeIcsText(options.host)}//Calendar//JA`,
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		'BEGIN:VEVENT',
		`UID:${event.id}@${options.host}`,
		`DTSTAMP:${formatIcsDateTime(options.now)}`,
	];

	if (event.isAllDay) {
		// 終日の DTEND は翌日 (その日を含まない)
		lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(event.date)}`);
		lines.push(`DTEND;VALUE=DATE:${formatIcsDate(addDays(event.date, 1))}`);
	} else {
		lines.push(`DTSTART:${formatIcsDateTime(event.startsAt)}`);
		if (event.endsAt != null) lines.push(`DTEND:${formatIcsDateTime(event.endsAt)}`);
	}

	lines.push(`SUMMARY:${escapeIcsText(event.title)}`);
	if (event.location != null && event.location !== '') lines.push(`LOCATION:${escapeIcsText(event.location)}`);
	if (event.description != null && event.description !== '') lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
	lines.push(`URL:${options.url}`);
	if (event.isCanceled) lines.push('STATUS:CANCELLED');

	lines.push('END:VEVENT', 'END:VCALENDAR');

	return lines.map(foldIcsLine).join(CRLF) + CRLF;
}

/** ダウンロードするファイルの名前。ファイル名に使えない文字を除き、空ならイベントの ID を使う */
export function getCalendarEventIcsFileName(event: { id: string; title: string }): string {
	// eslint-disable-next-line no-control-regex
	const base = event.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 100);
	return `${base === '' ? event.id : base}.ics`;
}
