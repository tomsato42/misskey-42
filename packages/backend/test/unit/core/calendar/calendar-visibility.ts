/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import {
	calendarEventVisibleSql,
	isCalendarEventVisibilityChanged,
	isCalendarEventVisibleTo,
	normalizeCalendarEventVisibility,
	CALENDAR_EVENT_VISIBLE_USERS_MAX,
} from '@/core/calendar/calendar-visibility.js';
import type { CalendarEventVisibilityTarget } from '@/core/calendar/calendar-visibility.js';

const CREATOR = 'alice';

describe('normalizeCalendarEventVisibility', () => {
	test('省略すると全員。使わない項目は空にする', () => {
		expect(normalizeCalendarEventVisibility({}, CREATOR)).toEqual({ visibility: 'public', visibleUserIds: [], userListId: null });
		expect(normalizeCalendarEventVisibility({ visibility: 'followers', visibleUserIds: ['bob'], userListId: 'list1' }, CREATOR))
			.toEqual({ visibility: 'followers', visibleUserIds: [], userListId: null });
	});

	test('指定ユーザーは重複と作成者を除き、残らなければエラー', () => {
		expect(normalizeCalendarEventVisibility({ visibility: 'specified', visibleUserIds: ['bob', CREATOR, 'bob', 'carol'], userListId: 'list1' }, CREATOR))
			.toEqual({ visibility: 'specified', visibleUserIds: ['bob', 'carol'], userListId: null });
		expect(() => normalizeCalendarEventVisibility({ visibility: 'specified', visibleUserIds: [CREATOR] }, CREATOR))
			.toThrow(expect.objectContaining({ reason: 'visibleUsersRequired' }));
		expect(() => normalizeCalendarEventVisibility({ visibility: 'specified' }, CREATOR))
			.toThrow(expect.objectContaining({ reason: 'visibleUsersRequired' }));
	});

	test('指定ユーザーの上限を超えるとエラー', () => {
		const ids = Array.from({ length: CALENDAR_EVENT_VISIBLE_USERS_MAX + 1 }, (_, i) => `u${i}`);
		expect(() => normalizeCalendarEventVisibility({ visibility: 'specified', visibleUserIds: ids }, CREATOR))
			.toThrow(expect.objectContaining({ reason: 'tooManyVisibleUsers' }));
		expect(normalizeCalendarEventVisibility({ visibility: 'specified', visibleUserIds: ids.slice(1) }, CREATOR).visibleUserIds)
			.toHaveLength(CALENDAR_EVENT_VISIBLE_USERS_MAX);
	});

	test('リストはリストが無ければエラー', () => {
		expect(normalizeCalendarEventVisibility({ visibility: 'list', userListId: 'list1', visibleUserIds: ['bob'] }, CREATOR))
			.toEqual({ visibility: 'list', visibleUserIds: [], userListId: 'list1' });
		expect(() => normalizeCalendarEventVisibility({ visibility: 'list', userListId: null }, CREATOR))
			.toThrow(expect.objectContaining({ reason: 'userListRequired' }));
	});
});

describe('isCalendarEventVisibleTo', () => {
	function event(visibility: CalendarEventVisibilityTarget['visibility'], visibleUserIds: string[] = []): CalendarEventVisibilityTarget {
		return { userId: CREATOR, visibility, visibleUserIds };
	}

	const BOB = { id: 'bob' };

	test('全員向けは未ログインでも見られる。それ以外は未ログインでは見られない', () => {
		expect(isCalendarEventVisibleTo(event('public'), null, {})).toBe(true);
		for (const visibility of ['followers', 'mutual', 'specified', 'list'] as const) {
			expect(isCalendarEventVisibleTo(event(visibility), null, {})).toBe(false);
		}
	});

	test('作成者はいつでも見られる', () => {
		for (const visibility of ['followers', 'mutual', 'specified', 'list'] as const) {
			expect(isCalendarEventVisibleTo(event(visibility), { id: CREATOR }, {})).toBe(true);
		}
	});

	test('フォロワーは作成者をフォローしている人', () => {
		expect(isCalendarEventVisibleTo(event('followers'), BOB, { isFollowingCreator: true })).toBe(true);
		expect(isCalendarEventVisibleTo(event('followers'), BOB, { isFollowedByCreator: true })).toBe(false);
	});

	test('相互フォローは両方向のフォローが要る', () => {
		expect(isCalendarEventVisibleTo(event('mutual'), BOB, { isFollowingCreator: true, isFollowedByCreator: true })).toBe(true);
		expect(isCalendarEventVisibleTo(event('mutual'), BOB, { isFollowingCreator: true })).toBe(false);
		expect(isCalendarEventVisibleTo(event('mutual'), BOB, { isFollowedByCreator: true })).toBe(false);
	});

	test('指定ユーザーとリスト', () => {
		expect(isCalendarEventVisibleTo(event('specified', ['bob']), BOB, {})).toBe(true);
		expect(isCalendarEventVisibleTo(event('specified', ['carol']), BOB, { isFollowingCreator: true })).toBe(false);
		expect(isCalendarEventVisibleTo(event('list'), BOB, { isListMember: true })).toBe(true);
		expect(isCalendarEventVisibleTo(event('list'), BOB, { isFollowingCreator: true })).toBe(false);
	});
});

describe('calendarEventVisibleSql', () => {
	test('別名と閲覧者の式を差し込む', () => {
		const sql = calendarEventVisibleSql('event', ':meId');
		expect(sql.startsWith('(') && sql.endsWith(')')).toBe(true);
		expect(sql).toContain(`"event"."visibility" = 'public'`);
		expect(sql).toContain(`"event"."userId" = :meId`);
		expect(sql).toContain(`:meId = ANY("event"."visibleUserIds")`);
		expect(sql).toContain(`"user_list_membership"."userListId" = "event"."userListId"`);
	});
});

describe('isCalendarEventVisibilityChanged', () => {
	const base = { visibility: 'specified' as const, visibleUserIds: ['bob', 'carol'], userListId: null };

	test('並びが違うだけなら変わっていない', () => {
		expect(isCalendarEventVisibilityChanged(base, { ...base, visibleUserIds: ['carol', 'bob'] })).toBe(false);
	});

	test('種類・指定ユーザー・リストのどれかが違えば変わった', () => {
		expect(isCalendarEventVisibilityChanged(base, { ...base, visibility: 'public', visibleUserIds: [] })).toBe(true);
		expect(isCalendarEventVisibilityChanged(base, { ...base, visibleUserIds: ['bob'] })).toBe(true);
		expect(isCalendarEventVisibilityChanged(base, { ...base, visibleUserIds: ['bob', 'dave'] })).toBe(true);
		const list = { visibility: 'list' as const, visibleUserIds: [], userListId: 'list1' };
		expect(isCalendarEventVisibilityChanged(list, { ...list, userListId: 'list2' })).toBe(true);
	});
});
