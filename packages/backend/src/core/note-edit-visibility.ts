/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42times: ノートの編集で公開範囲を変えるときの判定。
// 変えられるのは公開・ホーム・フォロワーの間だけ (ダイレクトは宛先を選び直すことになるので変えない)。
// 作成時 (NoteCreateService) と同じく、返信先・引用元より広くはできず、公開にできない人やセンシティブなワードを含む本文はホームにする

import type { MiNote } from '@/models/Note.js';
import type { FanoutTimelineName } from '@/core/FanoutTimelineService.js';
import { isReply } from '@/misc/is-reply.js';

export const EDITABLE_NOTE_VISIBILITIES = ['public', 'home', 'followers'] as const;
export type EditableNoteVisibility = typeof EDITABLE_NOTE_VISIBILITIES[number];

/** 編集で公開範囲を変えられるノートか。ダイレクトとチャンネルのノート (常に公開) は変えられない */
export function canChangeNoteVisibility(note: Pick<MiNote, 'visibility' | 'channelId'>): boolean {
	return note.visibility !== 'specified' && note.channelId == null;
}

const RANK: Record<EditableNoteVisibility, number> = { public: 0, home: 1, followers: 2 };

function narrower(a: EditableNoteVisibility, b: EditableNoteVisibility): EditableNoteVisibility {
	return RANK[a] >= RANK[b] ? a : b;
}

/**
 * 編集した後の公開範囲。返信先・引用元 (ダイレクト以外) より広くはしない。
 * canPublic が false (公開にできないロール・センシティブなワード) なら公開をホームにする
 */
export function resolveEditedVisibility(
	requested: EditableNoteVisibility,
	opts: {
		replyVisibility: MiNote['visibility'] | null;
		renoteVisibility: MiNote['visibility'] | null;
		canPublic: boolean;
	},
): EditableNoteVisibility {
	let visibility = requested;
	if (visibility === 'public' && !opts.canPublic) visibility = 'home';
	for (const target of [opts.replyVisibility, opts.renoteVisibility]) {
		if (target === 'public' || target === 'home' || target === 'followers') visibility = narrower(visibility, target);
	}
	return visibility;
}

/**
 * 公開のノートだけが入るタイムライン (ローカル) と、その長さの上限。作成時の NoteCreateService.pushToTl と同じ条件・上限。
 * ホーム (フォロワー)・ユーザー・ロールのタイムラインには公開範囲に関係なく入っているので含めない
 */
export function publicOnlyTimelines(note: Pick<MiNote, 'userId' | 'userHost' | 'channelId' | 'replyId' | 'replyUserId' | 'replyUserHost' | 'fileIds'>): { name: FanoutTimelineName; maxlen: number }[] {
	if (note.userHost != null || note.channelId != null) return [];
	if (isReply(note)) {
		const timelines: { name: FanoutTimelineName; maxlen: number }[] = [{ name: 'localTimelineWithReplies', maxlen: 300 }];
		if (note.replyUserHost == null && note.replyUserId != null) timelines.push({ name: `localTimelineWithReplyTo:${note.replyUserId}`, maxlen: 300 / 10 });
		return timelines;
	}
	const timelines: { name: FanoutTimelineName; maxlen: number }[] = [{ name: 'localTimeline', maxlen: 1000 }];
	if (note.fileIds.length > 0) timelines.push({ name: 'localTimelineWithFiles', maxlen: 500 });
	return timelines;
}
