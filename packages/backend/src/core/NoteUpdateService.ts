/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42times: ノートの本文・CW の編集。連合しないので ActivityPub の Update は送らない。
// メンション・公開範囲・添付は作成時のままにし、編集で増えたメンションにも通知しない。
// 編集する前の本文と CW は note_history に残す

import { Inject, Injectable } from '@nestjs/common';
import * as mfm from 'mfm-js';
import type { NoteHistoriesRepository, NotesRepository } from '@/models/_.js';
import type { MiNote } from '@/models/Note.js';
import type { MiUser } from '@/models/User.js';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { HashtagService } from '@/core/HashtagService.js';
import { SearchService } from '@/core/SearchService.js';
import { IdService } from '@/core/IdService.js';
import { extractHashtags } from '@/misc/extract-hashtags.js';
import { normalizeForSearch } from '@/misc/normalize-for-search.js';
import { isQuote, isRenote } from '@/misc/is-renote.js';

export type NoteEdit = {
	text: string | null;
	cw: string | null;
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
		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.noteHistoriesRepository)
		private noteHistoriesRepository: NoteHistoriesRepository,

		private idService: IdService,
		private globalEventService: GlobalEventService,
		private hashtagService: HashtagService,
		private searchService: SearchService,
	) {}

	/** 本文・CW を書き換える。変わらなければ何もせずそのまま返す */
	@bindThis
	public async update(user: { id: MiUser['id']; host: MiUser['host']; }, note: MiNote, edit: NoteEdit): Promise<MiNote> {
		if (note.text === edit.text && note.cw === edit.cw) return note;

		const tokens = [
			...(edit.text ? mfm.parse(edit.text) : []),
			...(edit.cw ? mfm.parse(edit.cw) : []),
		];
		const rawTags = extractHashtags(tokens)
			.filter(tag => Array.from(tag).length <= 128)
			.splice(0, 32);
		const tags = rawTags.map(tag => normalizeForSearch(tag));
		const updatedAt = new Date();

		// 編集する前の版を履歴に残す (id の日時が置き換えた日時になる)
		await this.noteHistoriesRepository.insert({
			id: this.idService.gen(updatedAt.getTime()),
			noteId: note.id,
			text: note.text,
			cw: note.cw,
		});

		await this.notesRepository.update({ id: note.id }, {
			text: edit.text,
			cw: edit.cw,
			tags,
			updatedAt,
		});

		const updated: MiNote = { ...note, text: edit.text, cw: edit.cw, tags, updatedAt };

		// 作成時と同じく、公開・ホームのノートで新しく付けたハッシュタグだけ数える
		if (note.visibility === 'public' || note.visibility === 'home') {
			const addedTags = rawTags.filter(tag => !note.tags.includes(normalizeForSearch(tag)));
			if (addedTags.length > 0) this.hashtagService.updateHashtags(user, addedTags);
		}

		this.globalEventService.publishNoteStream(note, 'updated', {
			text: edit.text,
			cw: edit.cw,
			updatedAt,
		});

		// 本文も CW も無くなったら索引から外す (indexNote はどちらも無いと何もしない)
		if (updated.text == null && updated.cw == null) {
			this.searchService.unindexNote(updated);
		} else {
			this.searchService.indexNote(updated);
		}

		return updated;
	}
}
