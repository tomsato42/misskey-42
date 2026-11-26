/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ナビゲーションのメニュー (preferences の menu) に「点数を共有」を一度だけ足す移行処理の判定

export const PROJECT_SHARE_MENU_ITEM = 'projectShare';

/**
 * ナビゲーションのメニュー (preferences の menu) に「点数を共有」を足した新しい配列を返す。
 * pair の直後、無ければ最初の区切りの前 (区切りも無ければ末尾) に入れる。すでに入っていれば元の配列をそのまま返す
 */
export function addProjectShareToMenu(menu: readonly string[]): readonly string[] {
	if (menu.includes(PROJECT_SHARE_MENU_ITEM)) return menu;
	const pairIndex = menu.indexOf('pair');
	const dividerIndex = menu.indexOf('-');
	const index = pairIndex !== -1 ? pairIndex + 1 : dividerIndex !== -1 ? dividerIndex : menu.length;
	const result = [...menu];
	result.splice(index, 0, PROJECT_SHARE_MENU_ITEM);
	return result;
}
