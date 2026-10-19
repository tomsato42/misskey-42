/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { IntraLevelNotesRepository, IntraProjectNotesRepository, UserProfilesRepository } from '@/models/_.js';
import type { Packed } from '@/misc/json-schema.js';
import type { MiUser } from '@/models/User.js';
import type { MiNote } from '@/models/Note.js';
import type { MiIntraProjectResult } from '@/models/IntraProjectResult.js';
import type { IntraProjectResultMember } from '@/core/intra/intra-project-result.js';
import { bindThis } from '@/decorators.js';
import { UserEntityService } from './UserEntityService.js';

type Me = { id: MiUser['id'] } | null | undefined;

/**
 * 42 intra の課題の結果 (自分の結果と、ノートに付けた結果) とノートに付けたレベルを API の返り値の形にする
 */
@Injectable()
export class IntraProjectNoteEntityService {
	constructor(
		@Inject(DI.intraProjectNotesRepository)
		private intraProjectNotesRepository: IntraProjectNotesRepository,

		@Inject(DI.intraLevelNotesRepository)
		private intraLevelNotesRepository: IntraLevelNotesRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private userEntityService: UserEntityService,
	) {
	}

	/**
	 * 自分の課題の結果をまとめて API の返り値の形にする。
	 * メンバーと outstanding の数は、まだ取得していなければ空と null
	 */
	@bindThis
	public async packResults(results: MiIntraProjectResult[], me: Me): Promise<Packed<'IntraProjectResult'>[]> {
		const membersOf = (r: MiIntraProjectResult) => r.detailsTeamId != null ? r.members : [];
		const resolve = await this.resolveMembers(results.flatMap(membersOf), me);
		return results.map(r => ({
			id: r.id,
			projectSlug: r.projectSlug,
			projectName: r.projectName,
			finalMark: r.finalMark,
			validated: r.validated,
			outstandingCount: r.detailsTeamId != null ? r.outstandingCount : null,
			members: resolve(membersOf(r)),
			markedAt: r.markedAt?.toISOString() ?? null,
		}));
	}

	/**
	 * ノートに付けた課題の結果をまとめて引く。結果が付いていないノートは含まない
	 */
	@bindThis
	public async packManyByNoteIds(noteIds: MiNote['id'][], me: Me): Promise<Map<MiNote['id'], Packed<'IntraProjectNote'>>> {
		const result = new Map<MiNote['id'], Packed<'IntraProjectNote'>>();
		const ids = [...new Set(noteIds)];
		if (ids.length === 0) return result;

		const rows = await this.intraProjectNotesRepository.findBy({ noteId: In(ids) });
		if (rows.length === 0) return result;

		const resolve = await this.resolveMembers(rows.flatMap(r => r.members), me);
		for (const row of rows) {
			result.set(row.noteId, {
				projectSlug: row.projectSlug,
				projectName: row.projectName,
				finalMark: row.finalMark,
				validated: row.validated,
				outstandingCount: row.outstandingCount,
				members: resolve(row.members),
			});
		}
		return result;
	}

	/**
	 * ノートに付けたレベルをまとめて引く。レベルが付いていないノートは含まない
	 */
	@bindThis
	public async packLevelsByNoteIds(noteIds: MiNote['id'][]): Promise<Map<MiNote['id'], { level: number }>> {
		const ids = [...new Set(noteIds)];
		if (ids.length === 0) return new Map();

		const rows = await this.intraLevelNotesRepository.findBy({ noteId: In(ids) });
		return new Map(rows.map(r => [r.noteId, { level: r.level }]));
	}

	/**
	 * チームのメンバーに、このサーバーのアカウントがあればそのユーザーを付ける関数を返す (ユーザーはまとめて引く)
	 */
	@bindThis
	private async resolveMembers(members: IntraProjectResultMember[], me: Me): Promise<(members: IntraProjectResultMember[]) => { login: string; user: Packed<'UserLite'> | null }[]> {
		const intraIds = [...new Set(members.map(m => m.intraId))];
		const profiles = intraIds.length > 0
			? await this.userProfilesRepository.find({ where: { intraId: In(intraIds) }, select: { userId: true, intraId: true } })
			: [];
		const users = profiles.length > 0
			? await this.userEntityService.packMany(profiles.map(p => p.userId), me)
			: [];
		const usersById = new Map(users.map(u => [u.id, u]));
		const usersByIntraId = new Map<number, Packed<'UserLite'>>();
		for (const profile of profiles) {
			const user = usersById.get(profile.userId);
			if (profile.intraId != null && user != null) usersByIntraId.set(profile.intraId, user);
		}
		return list => list.map(m => ({ login: m.login, user: usersByIntraId.get(m.intraId) ?? null }));
	}
}
