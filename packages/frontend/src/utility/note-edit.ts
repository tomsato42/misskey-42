/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42times: ノートを編集したとき、表示中のノートにも反映する。
// 編集は投稿フォーム (MkPostForm の editNote) で行う

import type * as Misskey from 'misskey-js';
import { noteEvents } from '@/composables/use-note-capture.js';

export function emitNoteUpdated(updated: Misskey.entities.Note): void {
	if (updated.updatedAt == null) return;
	noteEvents.emit(`updated:${updated.id}`, {
		text: updated.text,
		cw: updated.cw ?? null,
		updatedAt: updated.updatedAt,
	});
}
