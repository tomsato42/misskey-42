/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// イベントの公開範囲。判定は作成者との関係 (フォロー・リストのメンバー) で決まる。
// 作成者とモデレーター以上は公開範囲に関係なく見られる (モデレーターかどうかは呼ぶ側で確かめる)

import type { MiUser } from '@/models/User.js';
import type { MiUserList } from '@/models/UserList.js';
import { CalendarEventValidationError } from './calendar-errors.js';

/**
 * public: 全員、followers: 作成者のフォロワー、mutual: 作成者と相互フォロー、
 * specified: 指定したユーザー、list: 作成者のリストのメンバー
 */
export const calendarEventVisibilities = ['public', 'followers', 'mutual', 'specified', 'list'] as const;
export type CalendarEventVisibility = typeof calendarEventVisibilities[number];

/** 指定ユーザーの上限 (作成者を除く) */
export const CALENDAR_EVENT_VISIBLE_USERS_MAX = 100;

export type CalendarEventVisibilityInput = {
	visibility?: CalendarEventVisibility;
	visibleUserIds?: MiUser['id'][] | null;
	userListId?: MiUserList['id'] | null;
};

export type NormalizedCalendarEventVisibility = {
	visibility: CalendarEventVisibility;
	/** specified のときだけ入る。作成者は含めない */
	visibleUserIds: MiUser['id'][];
	/** list のときだけ入る */
	userListId: MiUserList['id'] | null;
};

/**
 * 公開範囲の入力を保存する形にする。使わない項目は空にし、指定ユーザーは重複と作成者を除く。
 * ユーザーやリストが実在するか (リストが作成者のものか) は DB を見るので CalendarVisibilityService で確かめる
 * @throws CalendarEventValidationError (visibleUsersRequired / tooManyVisibleUsers / userListRequired)
 */
export function normalizeCalendarEventVisibility(input: CalendarEventVisibilityInput, creatorId: MiUser['id']): NormalizedCalendarEventVisibility {
	const visibility = input.visibility ?? 'public';

	if (visibility === 'specified') {
		const visibleUserIds = [...new Set(input.visibleUserIds ?? [])].filter(id => id !== creatorId);
		if (visibleUserIds.length === 0) throw new CalendarEventValidationError('visibleUsersRequired');
		if (visibleUserIds.length > CALENDAR_EVENT_VISIBLE_USERS_MAX) throw new CalendarEventValidationError('tooManyVisibleUsers');
		return { visibility, visibleUserIds, userListId: null };
	}

	if (visibility === 'list') {
		if (input.userListId == null) throw new CalendarEventValidationError('userListRequired');
		return { visibility, visibleUserIds: [], userListId: input.userListId };
	}

	return { visibility, visibleUserIds: [], userListId: null };
}

export type CalendarEventVisibilityTarget = {
	userId: MiUser['id'];
	visibility: CalendarEventVisibility;
	visibleUserIds: MiUser['id'][];
};

/** 閲覧者と作成者の関係。判定に要るものだけを入れればよい */
export type CalendarEventViewerRelation = {
	/** 閲覧者が作成者をフォローしている */
	isFollowingCreator?: boolean;
	/** 作成者が閲覧者をフォローしている */
	isFollowedByCreator?: boolean;
	/** 閲覧者がイベントのリストのメンバー */
	isListMember?: boolean;
};

/**
 * 閲覧者がイベントを見られるか (モデレーター以上かどうかは含まない)。viewer が null (未ログイン) なら全員向けだけ
 */
export function isCalendarEventVisibleTo(
	event: CalendarEventVisibilityTarget,
	viewer: { id: MiUser['id'] } | null,
	relation: CalendarEventViewerRelation,
): boolean {
	if (event.visibility === 'public') return true;
	if (viewer == null) return false;
	if (event.userId === viewer.id) return true;

	switch (event.visibility) {
		case 'followers': return relation.isFollowingCreator === true;
		case 'mutual': return relation.isFollowingCreator === true && relation.isFollowedByCreator === true;
		case 'specified': return event.visibleUserIds.includes(viewer.id);
		case 'list': return relation.isListMember === true;
	}
}

/**
 * isCalendarEventVisibleTo と同じ判定の SQL の条件 (モデレーター以上かどうかは含まない)。
 * eventAlias はイベントの表の別名、userIdExpr は閲覧者の ID を表す式 (パラメーター `:meId` や列 `"subscription"."userId"`)
 */
export function calendarEventVisibleSql(eventAlias: string, userIdExpr: string): string {
	const e = `"${eventAlias}"`;
	const followsCreator = `EXISTS (SELECT 1 FROM "following" WHERE "following"."followerId" = ${userIdExpr} AND "following"."followeeId" = ${e}."userId")`;
	const followedByCreator = `EXISTS (SELECT 1 FROM "following" WHERE "following"."followerId" = ${e}."userId" AND "following"."followeeId" = ${userIdExpr})`;
	const listMember = `EXISTS (SELECT 1 FROM "user_list_membership" WHERE "user_list_membership"."userListId" = ${e}."userListId" AND "user_list_membership"."userId" = ${userIdExpr})`;
	const conditions = [
		`${e}."visibility" = 'public'`,
		`${e}."userId" = ${userIdExpr}`,
		`(${e}."visibility" = 'followers' AND ${followsCreator})`,
		`(${e}."visibility" = 'mutual' AND ${followsCreator} AND ${followedByCreator})`,
		`(${e}."visibility" = 'specified' AND ${userIdExpr} = ANY(${e}."visibleUserIds"))`,
		`(${e}."visibility" = 'list' AND ${listMember})`,
	];
	return `(${conditions.join(' OR ')})`;
}

/**
 * 公開範囲 (種類・指定ユーザー・リスト) が変わったか。指定ユーザーの並びの違いは変わったとみなさない
 */
export function isCalendarEventVisibilityChanged(previous: NormalizedCalendarEventVisibility, next: NormalizedCalendarEventVisibility): boolean {
	if (previous.visibility !== next.visibility) return true;
	if (previous.userListId !== next.userListId) return true;
	if (previous.visibleUserIds.length !== next.visibleUserIds.length) return true;
	const prev = new Set(previous.visibleUserIds);
	return next.visibleUserIds.some(id => !prev.has(id));
}
