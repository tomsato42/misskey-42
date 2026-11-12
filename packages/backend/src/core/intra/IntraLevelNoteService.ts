/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { IntraLevelNotesRepository, IntraRolesRepository, RoleAssignmentsRepository } from '@/models/_.js';
import type { MiUser } from '@/models/User.js';
import type { MiNote } from '@/models/Note.js';
import { bindThis } from '@/decorators.js';
import { IntraProjectResultNotAttachableError } from './IntraProjectResultService.js';
import type { IntraProjectNoteLike } from './IntraProjectResultService.js';

/** 付けようとしたレベルに、まだ届いていない */
export class IntraLevelNotReachedError extends Error {
	constructor() {
		super('The intra level has not been reached');
	}
}

/**
 * ノートに 42 intra のレベルを付ける
 */
@Injectable()
export class IntraLevelNoteService {
	constructor(
		@Inject(DI.intraLevelNotesRepository)
		private intraLevelNotesRepository: IntraLevelNotesRepository,

		@Inject(DI.intraRolesRepository)
		private intraRolesRepository: IntraRolesRepository,

		@Inject(DI.roleAssignmentsRepository)
		private roleAssignmentsRepository: RoleAssignmentsRepository,
	) {
	}

	/**
	 * 今のレベル (付いているレベルのロールのうち最も高いもの)。付いていなければ null
	 */
	@bindThis
	public async getCurrentLevel(userId: MiUser['id']): Promise<number | null> {
		const now = Date.now();
		const roleIds = (await this.roleAssignmentsRepository.findBy({ userId }))
			.filter(a => a.expiresAt == null || a.expiresAt.getTime() > now)
			.map(a => a.roleId);
		if (roleIds.length === 0) return null;

		const levels = (await this.intraRolesRepository.findBy({ kind: 'level', roleId: In(roleIds) }))
			.map(r => Number(r.key))
			.filter(n => Number.isInteger(n));
		return levels.length > 0 ? Math.max(...levels) : null;
	}

	/**
	 * ノートに付けるレベルを確かめ、ノートを作った後に保存する関数を返す。付けなければ null。
	 * 今のレベル以下なら付けられる (レベルが上がった通知から、後でもう一度上がった後に投稿しても付けられるようにする)
	 */
	@bindThis
	public async prepareNote(me: { id: MiUser['id'] }, level: number | null | undefined, note: IntraProjectNoteLike): Promise<((note: MiNote) => Promise<void>) | null> {
		if (level == null) return null;

		const isPureRenote = note.renoteId != null && note.text == null && (note.fileIds ?? []).length === 0 && !note.hasPoll;
		if (isPureRenote) throw new IntraProjectResultNotAttachableError();

		const current = await this.getCurrentLevel(me.id);
		if (current == null || level > current) throw new IntraLevelNotReachedError();

		return async (created: MiNote) => {
			await this.intraLevelNotesRepository.insert({
				noteId: created.id,
				userId: me.id,
				level,
			});
		};
	}
}
