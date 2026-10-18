/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { normalizeCalendarEventInput, normalizeCalendarHashtag } from '@/core/calendar/calendar-event-input.js';
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

const BASE = { title: 'もくもく会', date: '2026-10-20', startTime: '12:00' };

describe('normalizeCalendarHashtag', () => {
	test('先頭の # を除く', () => {
		expect(normalizeCalendarHashtag('#mokumoku')).toBe('mokumoku');
		expect(normalizeCalendarHashtag('mokumoku')).toBe('mokumoku');
	});

	test('全角の ＃ も除く', () => {
		expect(normalizeCalendarHashtag('＃もくもく会')).toBe('もくもく会');
	});

	test('ノートのハッシュタグと同じく NFKC と小文字で正規化する', () => {
		expect(normalizeCalendarHashtag('#MokuMoku')).toBe('mokumoku');
		expect(normalizeCalendarHashtag('#ｍｏｋｕ')).toBe('moku');
	});

	test('空や # だけなら null', () => {
		expect(normalizeCalendarHashtag(null)).toBeNull();
		expect(normalizeCalendarHashtag(undefined)).toBeNull();
		expect(normalizeCalendarHashtag('  ')).toBeNull();
		expect(normalizeCalendarHashtag('#')).toBeNull();
	});

	test.each(['#a b', '#tag.', '#123', '#a#b', '#a:b'])('ハッシュタグ全体として読めないものは invalidHashtag (%s)', (value) => {
		expectReason(() => normalizeCalendarHashtag(value), 'invalidHashtag');
	});

	test('長すぎるものは hashtagTooLong', () => {
		expect(normalizeCalendarHashtag('a'.repeat(128))).toBe('a'.repeat(128));
		expectReason(() => normalizeCalendarHashtag('a'.repeat(129)), 'hashtagTooLong');
	});
});

describe('normalizeCalendarEventInput', () => {
	test('前後の空白を除き、空の任意項目は null にする', () => {
		expect(normalizeCalendarEventInput({ ...BASE, title: '  もくもく会 ', location: ' ', description: '', hashtag: '' })).toEqual({
			title: 'もくもく会',
			location: null,
			description: null,
			hashtag: null,
			startsAt: new Date('2026-10-20T03:00:00.000Z'),
			endsAt: null,
			isAllDay: false,
		});
	});

	test('すべての項目を保存する形にする', () => {
		expect(normalizeCalendarEventInput({
			...BASE,
			endTime: '15:00',
			location: 'c3',
			description: '誰でも来てね',
			hashtag: '#MokuMoku',
		})).toEqual({
			title: 'もくもく会',
			location: 'c3',
			description: '誰でも来てね',
			hashtag: 'mokumoku',
			startsAt: new Date('2026-10-20T03:00:00.000Z'),
			endsAt: new Date('2026-10-20T06:00:00.000Z'),
			isAllDay: false,
		});
	});

	test('タイトルは必須', () => {
		expectReason(() => normalizeCalendarEventInput({ ...BASE, title: '   ' }), 'titleRequired');
	});

	test('タイトルは 100 文字まで (絵文字などはコードポイントで数える)', () => {
		expect(normalizeCalendarEventInput({ ...BASE, title: '🎉'.repeat(100) }).title).toBe('🎉'.repeat(100));
		expectReason(() => normalizeCalendarEventInput({ ...BASE, title: 'a'.repeat(101) }), 'titleTooLong');
	});

	test('場所は 128 文字まで', () => {
		expect(normalizeCalendarEventInput({ ...BASE, location: 'a'.repeat(128) }).location).toBe('a'.repeat(128));
		expectReason(() => normalizeCalendarEventInput({ ...BASE, location: 'a'.repeat(129) }), 'locationTooLong');
	});

	test('説明は 3000 文字まで', () => {
		expect(normalizeCalendarEventInput({ ...BASE, description: 'a'.repeat(3000) }).description).toBe('a'.repeat(3000));
		expectReason(() => normalizeCalendarEventInput({ ...BASE, description: 'a'.repeat(3001) }), 'descriptionTooLong');
	});

	test('日時の検証エラーもそのまま返す', () => {
		expectReason(() => normalizeCalendarEventInput({ ...BASE, endTime: '11:00' }), 'endNotAfterStart');
	});
});
