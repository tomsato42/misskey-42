/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42times: 投稿したらアプリを閉じる。PC はタブ (ウィンドウ) を閉じ、
// ブラウザに拒否されたら真っ白のページへ移す。PC 以外は閉じられないことが多いので、すぐ真っ白のページへ移す。

import { DEFAULT_DEVICE_KIND } from '@/utility/device-kind.js';

export const BLANK_PAGE_PATH = '/static-assets/blank.html';

/** 投稿の後の API 呼び出し (下書きの削除・実績) が出るのを待つ時間 */
const WAIT_BEFORE_CLOSE_MS = 500;
/** window.close() が効いたかを見るまでの時間 */
const WAIT_FOR_CLOSE_MS = 200;

export function closeAppAfterPost(): void {
	window.setTimeout(() => {
		if (DEFAULT_DEVICE_KIND === 'desktop') {
			window.close();
			window.setTimeout(() => {
				window.location.replace(BLANK_PAGE_PATH);
			}, WAIT_FOR_CLOSE_MS);
		} else {
			window.location.replace(BLANK_PAGE_PATH);
		}
	}, WAIT_BEFORE_CLOSE_MS);
}
