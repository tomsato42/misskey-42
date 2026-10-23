/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// イベントの公開範囲 (i18n に依存させず、ユニットテストできるようにする)。文言は calendar-event-messages.ts

import * as Misskey from 'misskey-js';

export type CalendarEventVisibility = Misskey.entities.CalendarEvent['visibility'];

/** 選ぶときの並び (backend の core/calendar/calendar-visibility.ts の calendarEventVisibilities と同じ) */
export const calendarEventVisibilities = ['public', 'followers', 'mutual', 'specified', 'list'] as const satisfies readonly CalendarEventVisibility[];

const icons: Record<CalendarEventVisibility, string> = {
	// 投稿の公開範囲 (MkVisibilityPicker) とそろえる
	public: 'ti ti-world',
	followers: 'ti ti-lock',
	mutual: 'ti ti-users',
	specified: 'ti ti-mail',
	list: 'ti ti-list',
};

export function getCalendarVisibilityIcon(visibility: CalendarEventVisibility): string {
	return icons[visibility];
}

/**
 * ノートの公開範囲に合わせたイベントの公開範囲 (投稿フォームで告知するときの初期値)。
 * パブリック・ホームは全員、フォロワーはフォロワー。ダイレクトでは告知できないので全員にしておく
 */
export function noteVisibilityToCalendarVisibility(noteVisibility: string): CalendarEventVisibility {
	return noteVisibility === 'followers' ? 'followers' : 'public';
}

function breadth(visibility: CalendarEventVisibility): number {
	if (visibility === 'public') return 2;
	if (visibility === 'followers') return 1;
	return 0;
}

/**
 * イベントの公開範囲がノートより狭いか (ノートは見えるがイベントは見えない人がいる)。
 * 相互フォロー・指定ユーザー・リストはフォロワーより狭いものとして扱う
 */
export function isCalendarVisibilityNarrowerThanNote(eventVisibility: CalendarEventVisibility, noteVisibility: string): boolean {
	return breadth(eventVisibility) < breadth(noteVisibilityToCalendarVisibility(noteVisibility));
}
