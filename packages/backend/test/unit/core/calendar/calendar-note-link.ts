/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { assertCalendarLinkableNote, getCalendarNoteUnlinkableReason } from '@/core/calendar/calendar-note-link.js';
import { CalendarNoteNotLinkableError } from '@/core/calendar/calendar-errors.js';
import type { CalendarLinkableNoteLike } from '@/core/calendar/calendar-note-link.js';

const NOTE: CalendarLinkableNoteLike = {
	visibility: 'public',
	renoteId: null,
	replyId: null,
	text: 'もくもく会やります',
	cw: null,
	fileIds: [],
	hasPoll: false,
};

describe('getCalendarNoteUnlinkableReason', () => {
	test('普通のノートは紐づけられる', () => {
		expect(getCalendarNoteUnlinkableReason(NOTE)).toBeNull();
		expect(getCalendarNoteUnlinkableReason({ ...NOTE, visibility: 'home' })).toBeNull();
		expect(getCalendarNoteUnlinkableReason({ ...NOTE, visibility: 'followers' })).toBeNull();
	});

	test('ダイレクトのノートは紐づけられない', () => {
		expect(getCalendarNoteUnlinkableReason({ ...NOTE, visibility: 'specified' })).toBe('specifiedVisibility');
	});

	test('純粋なリノートは紐づけられない', () => {
		expect(getCalendarNoteUnlinkableReason({ ...NOTE, renoteId: 'r', text: null })).toBe('pureRenote');
		// 投稿前のパラメータでは省略された項目が undefined になる
		expect(getCalendarNoteUnlinkableReason({ ...NOTE, renoteId: 'r', text: undefined, cw: undefined, replyId: undefined, fileIds: undefined })).toBe('pureRenote');
	});

	test('引用リノートは紐づけられる', () => {
		expect(getCalendarNoteUnlinkableReason({ ...NOTE, renoteId: 'r' })).toBeNull();
		expect(getCalendarNoteUnlinkableReason({ ...NOTE, renoteId: 'r', text: null, cw: 'cw' })).toBeNull();
		expect(getCalendarNoteUnlinkableReason({ ...NOTE, renoteId: 'r', text: null, fileIds: ['f'] })).toBeNull();
		expect(getCalendarNoteUnlinkableReason({ ...NOTE, renoteId: 'r', text: null, hasPoll: true })).toBeNull();
		expect(getCalendarNoteUnlinkableReason({ ...NOTE, renoteId: 'r', text: null, replyId: 'p' })).toBeNull();
	});
});

describe('assertCalendarLinkableNote', () => {
	test('紐づけられないときは理由付きのエラーを投げる', () => {
		expect(() => assertCalendarLinkableNote(NOTE)).not.toThrow();
		try {
			assertCalendarLinkableNote({ ...NOTE, visibility: 'specified' });
			expect.unreachable();
		} catch (err) {
			expect(err).toBeInstanceOf(CalendarNoteNotLinkableError);
			expect((err as CalendarNoteNotLinkableError).reason).toBe('specifiedVisibility');
		}
	});
});
