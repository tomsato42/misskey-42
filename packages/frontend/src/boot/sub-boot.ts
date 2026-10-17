/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createApp, defineAsyncComponent } from 'vue';
import { common } from './common.js';
import { emojiPicker } from '@/utility/emoji-picker.js';
import UiMinimum from '@/ui/minimum.vue';
import { isIntraSigninOnly } from '@/utility/intra-visitor.js';

export async function subBoot() {
	const { isClientUpdated } = await common(async () => {
		// 42 intra 連携が有効なとき (学内SNSモード) は、未ログインなら /intra-complete 以外ではログイン画面だけを出す
		if (isIntraSigninOnly()) {
			return createApp(await import('@/ui/intra-signin.vue').then(x => x.default));
		}
		return createApp(UiMinimum);
	});

	emojiPicker.init();
}
