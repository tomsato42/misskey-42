/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42times: ノートの本文・CW・公開範囲の編集。連合しないので ActivityPub の Update は送らない。
// メンション・添付は作成時のままにし、編集で増えたメンションにも通知しない。
// 編集する前の本文と CW は note_history に残す (公開範囲は残さない)。
// 公開範囲を公開に広げたらローカルのタイムラインに入れ、公開から狭めたら外す (ほかのタイムラインには公開範囲に関係なく入っている)

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import * as mfm from 'mfm-js';
import type { MiMeta, NoteHistoriesRepository, NotesRepository } from '@/models/_.js';
import type { MiNote } from '@/models/Note.js';
import type { MiUser } from '@/models/User.js';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { HashtagService } from '@/core/HashtagService.js';
import { SearchService } from '@/core/SearchService.js';
import { IdService } from '@/core/IdService.js';
import { FanoutTimelineService } from '@/core/FanoutTimelineService.js';
import { RoleService } from '@/core/RoleService.js';
import { UtilityService } from '@/core/UtilityService.js';
import { publicOnlyTimelines, resolveEditedVisibility } from '@/core/note-edit-visibility.js';
import type { EditableNoteVisibility } from '@/core/note-edit-visibility.js';
import { extractHashtags } from '@/misc/extract-hashtags.js';
import { normalizeForSearch } from '@/misc/normalize-for-search.js';
import { isQuote, isRenote } from '@/misc/is-renote.js';

export type NoteEdit = {
	text: string | null;
	cw: string | null;
	/** 無ければ公開範囲は変えない。canChangeNoteVisibility なノートにだけ渡す */
	visibility?: EditableNoteVisibility;
};

/** 編集できないノートか。リノートだけのもの (引用でないもの) は本文が無いので編集できない */
export function isUneditableNote(note: MiNote): boolean {
	return isRenote(note) && !isQuote(note);
}

/**
 * 編集した後のノートが空にならないか。
 * 引用は引用のまま (本文・CW・返信・添付のどれかがある) でないといけない。
 * それ以外は本文か添付が要るが、もともと本文が無いもの (イベントや課題の結果だけのノートなど) は本文が無くてもよい
 */
export function isEditedNoteEmpty(note: MiNote, edit: NoteEdit): boolean {
	const edited = { ...note, text: edit.text, cw: edit.cw };
	if (isRenote(edited)) return !isQuote(edited);
	return edit.text == null && note.text != null && note.fileIds.length === 0 && !note.hasPoll;
}

@Injectable()
export class NoteUpdateService {
	constructor(
		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.redisForTimelines)
		private redisForTimelines: Redis.Redis,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.noteHistoriesRepository)
		private noteHistoriesRepository: NoteHistoriesRepository,

		private idService: IdService,
		private globalEventService: GlobalEventService,
		private hashtagService: HashtagService,
		private searchService: SearchService,
		private fanoutTimelineService: FanoutTimelineService,
		private roleService: RoleService,
		private utilityService: UtilityService,
	) {}

	/** 本文・CW・公開範囲を書き換える。変わらなければ何もせずそのまま返す */
	@bindThis
	public async update(user: { id: MiUser['id']; host: MiUser['host']; }, note: MiNote, edit: NoteEdit): Promise<MiNote> {
		// 公開範囲を変えないとき (送られた公開範囲が今と同じとき) は、作成時の制限を掛け直さない
		const visibility = edit.visibility == null || edit.visibility === note.visibility
			? note.visibility
			: await this.resolveVisibility(note, edit.visibility, edit);
		const textChanged = note.text !== edit.text || note.cw !== edit.cw;
		if (!textChanged && note.visibility === visibility) return note;

		const tokens = [
			...(edit.text ? mfm.parse(edit.text) : []),
			...(edit.cw ? mfm.parse(edit.cw) : []),
		];
		const rawTags = extractHashtags(tokens)
			.filter(tag => Array.from(tag).length <= 128)
			.splice(0, 32);
		const tags = rawTags.map(tag => normalizeForSearch(tag));
		// 編集した日時 (「編集済み」と履歴) は本文か CW を変えたときだけ付ける
		const now = new Date();
		const updatedAt = textChanged ? now : note.updatedAt;

		// 編集する前の版を履歴に残す (id の日時が置き換えた日時になる)。公開範囲だけ変えたときは残さない
		if (textChanged) {
			await this.noteHistoriesRepository.insert({
				id: this.idService.gen(now.getTime()),
				noteId: note.id,
				text: note.text,
				cw: note.cw,
			});
		}

		await this.notesRepository.update({ id: note.id }, {
			text: edit.text,
			cw: edit.cw,
			visibility,
			tags,
			updatedAt,
		});

		const updated: MiNote = { ...note, text: edit.text, cw: edit.cw, visibility, tags, updatedAt };

		// 作成時と同じく、公開・ホームのノートで新しく付けたハッシュタグだけ数える
		// (フォロワーから公開・ホームに広げたときは、付いているハッシュタグをすべて新しく付けたものとして数える)
		if (visibility === 'public' || visibility === 'home') {
			const wasCounted = note.visibility === 'public' || note.visibility === 'home';
			const addedTags = rawTags.filter(tag => !wasCounted || !note.tags.includes(normalizeForSearch(tag)));
			if (addedTags.length > 0) this.hashtagService.updateHashtags(user, addedTags);
		}

		if (note.visibility !== visibility) this.updatePublicTimelines(note, updated);

		// ストリームは新しい公開範囲で絞る (狭めたら見られなくなった人には送らない)
		this.globalEventService.publishNoteStream(updated, 'updated', {
			text: edit.text,
			cw: edit.cw,
			visibility,
			updatedAt,
		});

		// 本文も CW も無くなったか、索引に入れない公開範囲 (フォロワー) にしたら索引から外す
		// (indexNote は本文も CW も無いと何もせず、unindexNote は公開・ホームのノートしか外さないので、外すときは元のノートを渡す)
		if ((updated.text == null && updated.cw == null) || !['public', 'home'].includes(visibility)) {
			this.searchService.unindexNote(note);
		} else {
			this.searchService.indexNote(updated);
		}

		return updated;
	}

	/** 作成時と同じく、返信先・引用元より広くせず、公開にできないときはホームにする */
	@bindThis
	private async resolveVisibility(note: MiNote, requested: EditableNoteVisibility, edit: NoteEdit): Promise<EditableNoteVisibility> {
		const [reply, renote] = await Promise.all([note.replyId, note.renoteId].map(id => id == null
			? Promise.resolve(null)
			: this.notesRepository.findOne({ where: { id }, select: { id: true, visibility: true } })));

		let canPublic = true;
		if (requested === 'public') {
			canPublic = !this.utilityService.isKeyWordIncluded(edit.cw ?? edit.text ?? '', this.meta.sensitiveWords)
				&& (await this.roleService.getUserPolicies(note.userId)).canPublicNote !== false;
		}

		return resolveEditedVisibility(requested, {
			replyVisibility: reply?.visibility ?? null,
			renoteVisibility: renote?.visibility ?? null,
			canPublic,
		});
	}

	/** 公開に広げたらローカルのタイムラインに入れ、公開から狭めたら外す */
	@bindThis
	private updatePublicTimelines(before: MiNote, after: MiNote): void {
		if (!this.meta.enableFanoutTimeline) return;
		const timelines = publicOnlyTimelines(after);
		if (timelines.length === 0) return;

		if (after.visibility === 'public') {
			// 古いノートは、一覧に残っているいちばん古いノートより新しいときだけ入る (それより古ければ DB から読む)
			const r = this.redisForTimelines.pipeline();
			for (const { name, maxlen } of timelines) {
				this.fanoutTimelineService.push(name, after.id, maxlen, r);
			}
			r.exec();
		} else if (before.visibility === 'public') {
			for (const { name } of timelines) {
				this.fanoutTimelineService.remove(name, after.id);
			}
		}
	}
}
