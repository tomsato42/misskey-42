/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42times: タイムラインのリプライの上に、スレッドの最初のノートと直前のノートを並べるための判定

import type * as Misskey from 'misskey-js';
import { misskeyApi } from '@/utility/misskey-api.js';

type ReplyContextNote = {
	replyId?: string | null;
	threadId?: string;
	reply?: { replyId?: string | null } | null;
};

export type ReplyContext = {
	// 直前のノートの上に出すスレッドの最初のノート。直前のノートが最初のノートなら null
	rootId: string | null;
	// 最初のノートと直前のノートの間にほかのノートがある (分からないときも true)
	showGap: boolean;
};

export function getReplyContext(note: ReplyContextNote): ReplyContext {
	if (note.replyId == null) return { rootId: null, showGap: false };

	const rootId = note.threadId != null && note.threadId !== note.replyId ? note.threadId : null;

	// 直前のノートが消されている・見られないときは、間に何があるか分からない
	if (note.reply == null) return { rootId, showGap: rootId != null };

	// 直前のノートがリプライでなければ、それがスレッドの最初のノート
	if (note.reply.replyId == null) return { rootId: null, showGap: false };

	return { rootId, showGap: note.reply.replyId !== rootId };
}

// タイムラインで同じスレッドのリプライが続いても、最初のノートは一度だけ取りに行く
const MAX_CACHED_ROOTS = 200;
const rootCache = new Map<string, Promise<Misskey.entities.Note | null>>();

export function fetchThreadRoot(noteId: string): Promise<Misskey.entities.Note | null> {
	const cached = rootCache.get(noteId);
	if (cached != null) return cached;

	// 消された・見られないノートは null にして、最初のノートを出さない
	const promise = misskeyApi('notes/show', { noteId }).catch(() => null);
	rootCache.set(noteId, promise);
	if (rootCache.size > MAX_CACHED_ROOTS) {
		const oldest = rootCache.keys().next().value;
		if (oldest != null) rootCache.delete(oldest);
	}
	return promise;
}
