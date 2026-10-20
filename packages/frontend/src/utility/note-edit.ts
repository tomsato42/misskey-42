/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42times: ノートの編集ダイアログを開く。保存できたら表示中のノートにも反映する

import { defineAsyncComponent } from 'vue';
import type * as Misskey from 'misskey-js';
import * as os from '@/os.js';
import { noteEvents } from '@/composables/use-note-capture.js';

export function openNoteEditDialog(note: Misskey.entities.Note): void {
	const { dispose } = os.popup(defineAsyncComponent(() => import('@/components/MkNoteEditDialog.vue')), {
		note,
	}, {
		done: (updated) => {
			if (updated.updatedAt == null) return;
			noteEvents.emit(`updated:${updated.id}`, {
				text: updated.text,
				cw: updated.cw ?? null,
				updatedAt: updated.updatedAt,
			});
		},
		closed: () => dispose(),
	});
}
