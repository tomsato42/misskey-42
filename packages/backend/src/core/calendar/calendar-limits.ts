/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// カレンダー機能の件数の上限

/**
 * 1人がイベントを作れる数の上限 (1時間あたり)。
 * calendar/events/create のレート制限と、notes/create でノートと一緒に作るときの確認の両方で使う
 */
export const CALENDAR_EVENT_CREATE_LIMIT = {
	duration: 1000 * 60 * 60,
	max: 30,
} as const;
