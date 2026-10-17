/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { IntraRolesRepository, RoleAssignmentsRepository, UserProfilesRepository } from '@/models/_.js';
import type { MiUser } from '@/models/User.js';
import type { MiRole } from '@/models/Role.js';
import { RoleService } from '@/core/RoleService.js';
import { CacheService } from '@/core/CacheService.js';
import { IdService } from '@/core/IdService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { isDuplicateKeyValueError } from '@/misc/is-duplicate-key-value-error.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { IntraApiService } from './IntraApiService.js';
import { extractIntraProfile } from './intra-user.js';
import { diffIntraRoleAssignments, getIntraRoleTargets } from './intra-role.js';
import type { IntraRoleTarget } from './intra-role.js';
import type { IntraProfile, IntraUser } from './intra-user.js';

type IntraConfig = NonNullable<Config['intra']>;

const ROLE_DESCRIPTIONS: Record<IntraRoleTarget['kind'], string> = {
	level: '42 intra のレベルに応じて自動で付与されます',
	campus: '42 intra のキャンパスに応じて自動で付与されます',
};

/**
 * 42 intra のユーザー情報を、プロフィールとロールに反映する。
 * ユーザーの凍結・削除はしない
 */
@Injectable()
export class IntraSyncService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.intraRolesRepository)
		private intraRolesRepository: IntraRolesRepository,

		@Inject(DI.roleAssignmentsRepository)
		private roleAssignmentsRepository: RoleAssignmentsRepository,

		private intraApiService: IntraApiService,
		private roleService: RoleService,
		private cacheService: CacheService,
		private idService: IdService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('intra-sync');
	}

	@bindThis
	private getIntraConfig(): IntraConfig {
		if (this.config.intra == null) {
			throw new Error('42 intra integration is not configured');
		}
		return this.config.intra;
	}

	/**
	 * ユーザーのプロフィールとロールを intra の情報に合わせる。
	 * intra と連携していないユーザーには何もしない
	 * @param intraUser 取得済みの intra のユーザー情報 (ログイン直後など)。省略すると 42 API から取得する
	 */
	@bindThis
	public async syncUser(userId: MiUser['id'], intraUser?: IntraUser): Promise<void> {
		const intra = this.getIntraConfig();

		const profile = await this.userProfilesRepository.findOneBy({ userId });
		if (profile == null || profile.intraId == null) return;

		if (intraUser == null) {
			const fetched = await this.intraApiService.getUser(profile.intraId);
			if (fetched == null) {
				// intra 側でユーザーが見つからない場合も凍結はしない。保存済みの情報はそのまま残す
				this.logger.warn(`intra user ${profile.intraId} (user ${userId}) was not found`);
				await this.userProfilesRepository.update({ userId }, { intraSyncedAt: new Date() });
				return;
			}
			intraUser = fetched;
		}

		if (intraUser.id !== profile.intraId) {
			throw new Error(`intra user id mismatch: expected ${profile.intraId}, got ${intraUser.id}`);
		}

		const extracted = extractIntraProfile(intraUser, intra.cursusId);

		await this.userProfilesRepository.update({ userId }, {
			intraLogin: extracted.login,
			intraPoolYearMonth: extracted.poolYearMonth,
			intraBlackholedAt: extracted.blackholedAt,
			intraPaceDeadlineAt: extracted.paceDeadlineAt,
			intraSyncedAt: new Date(),
		});

		const updatedProfile = await this.userProfilesRepository.findOneByOrFail({ userId });
		await this.cacheService.userProfileCache.set(userId, updatedProfile);

		await this.syncRoles(userId, extracted);
	}

	/**
	 * intra_role で管理しているロールの付与・解除を、intra の情報に合わせる
	 */
	@bindThis
	private async syncRoles(userId: MiUser['id'], profile: Pick<IntraProfile, 'level' | 'campus'>): Promise<void> {
		const desiredRoleIds: MiRole['id'][] = [];
		for (const target of getIntraRoleTargets(profile)) {
			desiredRoleIds.push(await this.ensureRole(target));
		}

		const now = Date.now();
		// RoleService のキャッシュはプロセス間で遅れて更新されるため、DB から直接読む
		const [managed, assigns] = await Promise.all([
			this.intraRolesRepository.find({ select: { roleId: true } }),
			this.roleAssignmentsRepository.findBy({ userId }),
		]);
		const assignedRoleIds = assigns
			.filter(a => a.expiresAt == null || a.expiresAt.getTime() > now)
			.map(a => a.roleId);

		const { toAssign, toUnassign } = diffIntraRoleAssignments(managed.map(r => r.roleId), desiredRoleIds, assignedRoleIds);

		for (const roleId of toUnassign) {
			try {
				await this.roleService.unassign(userId, roleId);
			} catch (err) {
				// 同じユーザーの同期が同時に走った場合は、既に解除されていることがある
				if (!(err instanceof RoleService.NotAssignedError)) throw err;
			}
		}

		for (const roleId of toAssign) {
			try {
				await this.roleService.assign(userId, roleId);
			} catch (err) {
				if (!(err instanceof RoleService.AlreadyAssignedError)) throw err;
			}
		}
	}

	/**
	 * 条件に対応するロールの ID を返す。無ければロールを作成して intra_role に記録する
	 */
	@bindThis
	private async ensureRole(target: IntraRoleTarget): Promise<MiRole['id']> {
		const existing = await this.intraRolesRepository.findOneBy({ kind: target.kind, key: target.key });
		if (existing != null) return existing.roleId;

		const role = await this.roleService.create({
			name: target.name,
			description: ROLE_DESCRIPTIONS[target.kind],
			color: null,
			iconUrl: null,
			target: 'manual',
			isPublic: true,
			asBadge: true,
			isModerator: false,
			isAdministrator: false,
			isExplorable: false,
			preserveAssignmentOnMoveAccount: false,
			canEditMembersByModerator: false,
			displayOrder: 0,
			policies: {},
		});

		try {
			await this.intraRolesRepository.insert({
				id: this.idService.gen(),
				roleId: role.id,
				kind: target.kind,
				key: target.key,
			});
		} catch (err) {
			// 記録できなかったロールは使わないので消しておく
			await this.roleService.delete(role).catch(deleteErr => {
				this.logger.error(`Failed to delete unused role ${role.id}: ${deleteErr instanceof Error ? deleteErr.message : String(deleteErr)}`);
			});

			if (!isDuplicateKeyValueError(err)) throw err;

			// 同じ条件のロールを別の同期が先に作成した場合は、そちらを使う
			const concurrent = await this.intraRolesRepository.findOneByOrFail({ kind: target.kind, key: target.key });
			return concurrent.roleId;
		}

		this.logger.info(`Created role ${role.id} (${target.name}) for intra ${target.kind} ${target.key}`);
		return role.id;
	}
}
