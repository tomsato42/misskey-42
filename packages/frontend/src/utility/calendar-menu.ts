/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ナビゲーションのメニュー (preferences の menu) に、カレンダーを一度だけ足す移行処理の判定

export const CALENDAR_MENU_ITEM = 'calendar';

/**
 * menu に calendar を足した新しい配列を返す。notifications の直後、無ければ先頭に入れる。
 * すでに入っていれば元の配列をそのまま返す
 */
export function addCalendarToMenu(menu: readonly string[]): readonly string[] {
	if (menu.includes(CALENDAR_MENU_ITEM)) return menu;
	const index = menu.indexOf('notifications');
	const result = [...menu];
	result.splice(index === -1 ? 0 : index + 1, 0, CALENDAR_MENU_ITEM);
	return result;
}
