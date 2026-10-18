/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as Misskey from 'misskey-js';
import * as os from '@/os.js';

/**
 * イベントの作成・編集のダイアログを開く。保存したら保存後のイベント、閉じたら null を返す
 * @param options.event 編集するイベント。省略すると新しく作る
 * @param options.initialDate 新しく作るときの日付 ('YYYY-MM-DD')。省略すると今日 (日本時間)
 */
export async function openCalendarEventEditDialog(options: {
	event?: Misskey.entities.CalendarEvent;
	initialDate?: string;
} = {}): Promise<Misskey.entities.CalendarEvent | null> {
	let saved: Misskey.entities.CalendarEvent | null = null;

	return new Promise((resolve) => {
		let dispose = () => {};
		os.popupAsyncWithDialog(import('@/components/MkCalendarEventEditDialog.vue').then(x => x.default), {
			event: options.event ?? null,
			initialDate: options.initialDate ?? null,
		}, {
			done: (event) => {
				saved = event;
			},
			closed: () => {
				resolve(saved);
				dispose();
			},
		}).then((res) => {
			dispose = res.dispose;
		});
	});
}
