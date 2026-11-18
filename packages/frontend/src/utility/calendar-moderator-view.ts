/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42times: カレンダーの管理人ビュー。モデレーター以上は普段ほかの人と同じ公開範囲で見て、
// 管理人ビューにしたときだけ公開範囲の外のイベントも出す (API の moderatorView)
import { computed } from 'vue';
import { iAmModerator } from '@/i.js';
import { prefer } from '@/preferences.js';

/** 管理人ビューか。モデレーター以上でなければ常に false */
export const calendarModeratorView = computed(() => iAmModerator && prefer.r['calendar.moderatorView'].value);

export function setCalendarModeratorView(value: boolean): void {
	prefer.commit('calendar.moderatorView', value);
}
