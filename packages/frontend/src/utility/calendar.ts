/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// カレンダーの日付は日本時間 (Asia/Tokyo) で扱う。API の date ('YYYY-MM-DD') と startTime ('HH:mm') は日本時間なので、そのまま表示に使う。
// 「今日」も日本時間で決める。日本には夏時間が無いので UTC+9 の固定の時差で計算し、ブラウザのタイムゾーンには依存しない

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const calendarFilters = ['all', 'subscribed', 'mine'] as const;
export type CalendarFilter = typeof calendarFilters[number];

export type YearMonth = {
	year: number;
	/** 1〜12 */
	month: number;
};

export type CalendarDate = YearMonth & {
	day: number;
};

function pad2(n: number): string {
	return n.toString().padStart(2, '0');
}

function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 'YYYY-MM' を年月として読む。形式違いは null */
export function parseYearMonth(value: string | null | undefined): YearMonth | null {
	if (value == null) return null;
	const m = /^([1-9]\d{3})-(\d{2})$/.exec(value);
	if (m == null) return null;
	const year = Number(m[1]);
	const month = Number(m[2]);
	if (month < 1 || month > 12) return null;
	return { year, month };
}

export function formatYearMonth(ym: YearMonth): string {
	return `${ym.year}-${pad2(ym.month)}`;
}

/** 'YYYY-MM-DD' を日付として読む。存在しない日付 (2月30日など) や形式違いは null */
export function parseCalendarDate(value: string | null | undefined): CalendarDate | null {
	if (value == null) return null;
	const m = /^([1-9]\d{3})-(\d{2})-(\d{2})$/.exec(value);
	if (m == null) return null;
	const year = Number(m[1]);
	const month = Number(m[2]);
	const day = Number(m[3]);
	if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
	return { year, month, day };
}

export function formatCalendarDate(d: CalendarDate): string {
	return `${d.year}-${pad2(d.month)}-${pad2(d.day)}`;
}

/** Date を日本時間の 'YYYY-MM-DD' にする */
export function toJstDateString(date: Date): string {
	const shifted = new Date(date.getTime() + JST_OFFSET_MS);
	return formatCalendarDate({
		year: shifted.getUTCFullYear(),
		month: shifted.getUTCMonth() + 1,
		day: shifted.getUTCDate(),
	});
}

/** 日本時間の今月 ('YYYY-MM') */
export function currentJstYearMonth(now: Date = new Date()): string {
	return toJstDateString(now).slice(0, 7);
}

/** 'YYYY-MM' を delta か月ずらす */
export function shiftYearMonth(value: string, delta: number): string {
	const ym = parseYearMonth(value);
	if (ym == null) throw new Error(`invalid year-month: ${value}`);
	const index = ym.year * 12 + (ym.month - 1) + delta;
	return formatYearMonth({ year: Math.floor(index / 12), month: (index % 12) + 1 });
}

function toUtcDate(value: string): Date {
	const d = parseCalendarDate(value);
	if (d == null) throw new Error(`invalid date: ${value}`);
	return new Date(Date.UTC(d.year, d.month - 1, d.day));
}

function fromUtcDate(date: Date): string {
	return formatCalendarDate({
		year: date.getUTCFullYear(),
		month: date.getUTCMonth() + 1,
		day: date.getUTCDate(),
	});
}

/** その日付の曜日 (0 = 日曜 〜 6 = 土曜) */
export function dayOfWeek(value: string): number {
	return toUtcDate(value).getUTCDay();
}

/** 'YYYY-MM-DD' に日数を足す */
export function addDays(value: string, days: number): string {
	const date = toUtcDate(value);
	date.setUTCDate(date.getUTCDate() + days);
	return fromUtcDate(date);
}

/** 日付の差 (a - b の日数) */
export function diffDays(a: string, b: string): number {
	return Math.round((toUtcDate(a).getTime() - toUtcDate(b).getTime()) / (24 * 60 * 60 * 1000));
}

export type CalendarGridDay = {
	date: string;
	day: number;
	/** 表示している月の日か (前後の月の日なら false) */
	inMonth: boolean;
	/** 0 = 日曜 〜 6 = 土曜 */
	dayOfWeek: number;
};

/**
 * 月グリッドに並べる日 (日曜はじまり)。最初と最後の週は前後の月の日で埋めるので、件数は 7 の倍数 (28〜42) になる
 */
export function buildMonthGrid(value: string): CalendarGridDay[] {
	const ym = parseYearMonth(value);
	if (ym == null) throw new Error(`invalid year-month: ${value}`);

	const first = formatCalendarDate({ ...ym, day: 1 });
	const last = formatCalendarDate({ ...ym, day: daysInMonth(ym.year, ym.month) });
	const start = addDays(first, -dayOfWeek(first));
	const end = addDays(last, 6 - dayOfWeek(last));
	const count = diffDays(end, start) + 1;

	const days: CalendarGridDay[] = [];
	for (let i = 0; i < count; i++) {
		const date = addDays(start, i);
		const d = parseCalendarDate(date)!;
		days.push({
			date,
			day: d.day,
			inMonth: d.year === ym.year && d.month === ym.month,
			dayOfWeek: i % 7,
		});
	}
	return days;
}

type SortableCalendarEvent = {
	id: string;
	date: string;
	startTime: string | null;
	isAllDay: boolean;
};

/** イベントの並び順。日付順で、同じ日は終日を先にして開始時刻順 */
export function compareCalendarEvents(a: SortableCalendarEvent, b: SortableCalendarEvent): number {
	if (a.date !== b.date) return a.date < b.date ? -1 : 1;
	if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1;
	const at = a.startTime ?? '';
	const bt = b.startTime ?? '';
	if (at !== bt) return at < bt ? -1 : 1;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** イベントを日付ごとに分け、それぞれを compareCalendarEvents の順に並べる */
export function groupCalendarEventsByDate<T extends SortableCalendarEvent>(events: readonly T[]): Map<string, T[]> {
	const map = new Map<string, T[]>();
	for (const event of [...events].sort(compareCalendarEvents)) {
		const list = map.get(event.date);
		if (list) {
			list.push(event);
		} else {
			map.set(event.date, [event]);
		}
	}
	return map;
}
