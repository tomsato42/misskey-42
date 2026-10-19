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
import { NotificationService } from '@/core/NotificationService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { isDuplicateKeyValueError } from '@/misc/is-duplicate-key-value-error.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { IntraApiService } from './IntraApiService.js';
import { IntraProjectService } from './IntraProjectService.js';
import { IntraCohortService } from './IntraCohortService.js';
import { IntraCoalitionService } from './IntraCoalitionService.js';
import { extractIntraProfile } from './intra-user.js';
import { PRECREATED_MAX_LEVEL, diffIntraRoleAssignments, getIntraRoleIconUrl, getIntraRoleTargets, getLeveledUpLevel, getLevelRoleTarget } from './intra-role.js';
import type { IntraRoleIconTemplates, IntraRoleTarget } from './intra-role.js';
import type { IntraProfile, IntraUser } from './intra-user.js';
import type { IntraCoalition } from './intra-coalition.js';

type IntraConfig = NonNullable<Config['intra']>;

const ROLE_DESCRIPTIONS: Record<IntraRoleTarget['kind'], string> = {
	level: '42 intra のレベルに応じて自動で付与されます',
	campus: '42 intra のキャンパスに応じて自動で付与されます',
	pool: '42 intra のピシンの時期に応じて自動で付与されます',
	cohort: '42 intra の本科 (42cursus) への入学時期に応じて自動で付与されます',
	coalition: '42 intra のコアリションに応じて自動で付与されます',
};

/**
 * 42 intra のユーザー情報を、プロフィールとロールに反映する。
 * ユーザーの凍結・削除はしない
 */
@Injectable()
export class IntraSyncService {
	private logger: Logger;
	private checkedRoleIcons = new Set<MiRole['id']>();

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
		private intraProjectService: IntraProjectService,
		private intraCohortService: IntraCohortService,
		private intraCoalitionService: IntraCoalitionService,
		private notificationService: NotificationService,
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
	 * @param intraUser 取得済みの intra のユーザー情報 (ログイン直後など)。省略すると 42 API から取得し、コアリションのロールが付いていれば所属を取り直さない
	 */
	@bindThis
	public async syncUser(userId: MiUser['id'], intraUser?: IntraUser): Promise<void> {
		const intra = this.getIntraConfig();
		// ログインのとき (intraUser を渡されたとき) だけ、コアリションの所属を取り直す
		const refreshCoalition = intraUser != null;

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

		await this.syncRoles(userId, intraUser.id, extracted, refreshCoalition);

		try {
			await this.intraProjectService.syncUserProgress(userId, intraUser, extracted.campus?.id ?? null);
		} catch (err) {
			// 課題の状態を保存できなくても、ログインやロールの同期は失敗にしない
			this.logger.warn(`Failed to sync projects of user ${userId}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	/**
	 * Lv.0 から PRECREATED_MAX_LEVEL までのレベルのロールを、該当するユーザーがいなくても作っておく。
	 * 既にあるロールには触れない (アイコンが未設定なら設定する)
	 */
	@bindThis
	public async ensureLevelRoles(): Promise<void> {
		for (let level = 0; level <= PRECREATED_MAX_LEVEL; level++) {
			await this.ensureRole(getLevelRoleTarget(level));
		}
	}

	/**
	 * intra_role で管理しているロールのうち、アイコンのひな形があってアイコンが未設定のものにアイコンを設定する。
	 * 毎時の同期ではコアリションの所属を取り直さない (ensureRole を通らない) ので、ひな形を後から設定したときのために別に確かめる
	 */
	@bindThis
	public async ensureRoleIcons(): Promise<void> {
		const templates = this.getIconTemplates();
		if (templates.levelBadgeUrl == null && templates.coalitionIconUrl == null) return;
		const managed = await this.intraRolesRepository.find({ select: { roleId: true, kind: true, key: true } });
		for (const intraRole of managed) {
			const iconUrl = getIntraRoleIconUrl(intraRole, templates);
			if (iconUrl != null) await this.ensureRoleIcon(intraRole.roleId, iconUrl);
		}
	}

	@bindThis
	private getIconTemplates(): IntraRoleIconTemplates {
		return {
			levelBadgeUrl: this.config.intra?.levelBadgeUrl ?? null,
			coalitionIconUrl: this.config.intra?.coalitionIconUrl ?? null,
		};
	}

	/**
	 * intra_role で管理しているロールの付与・解除を、intra の情報に合わせる。
	 * レベルが上がって新しいレベルのロールを付けたら intraLevelUp を通知する
	 * @param refreshCoalition コアリションのロールが既に付いていても所属を取り直すか。コアリションは変わらないので、ログインのときだけ取り直す
	 */
	@bindThis
	private async syncRoles(userId: MiUser['id'], intraId: number, profile: Pick<IntraProfile, 'level' | 'campus' | 'poolYearMonth' | 'poolNameYearMonth' | 'cursusBeginAt'>, refreshCoalition: boolean): Promise<void> {
		const intakeYearMonth = await this.intraCohortService.getIntakeYearMonth(profile.campus?.id ?? null, profile.cursusBeginAt);

		const now = Date.now();
		// RoleService のキャッシュはプロセス間で遅れて更新されるため、DB から直接読む
		const [managed, assigns] = await Promise.all([
			this.intraRolesRepository.find({ select: { roleId: true, kind: true, key: true } }),
			this.roleAssignmentsRepository.findBy({ userId }),
		]);
		const assignedRoleIds = assigns
			.filter(a => a.expiresAt == null || a.expiresAt.getTime() > now)
			.map(a => a.roleId);
		const coalitionRoleIds = new Set(managed.filter(r => r.kind === 'coalition').map(r => r.roleId));
		const hasCoalitionRole = assignedRoleIds.some(id => coalitionRoleIds.has(id));
		const previousLevelKeys = managed
			.filter(r => r.kind === 'level' && assignedRoleIds.includes(r.roleId))
			.map(r => r.key);

		let coalition: IntraCoalition | null = null;
		// false のときは、コアリションのロールを付けも外しもしない
		let coalitionKnown = refreshCoalition || !hasCoalitionRole;
		if (coalitionKnown) {
			try {
				coalition = await this.intraCoalitionService.getUserCoalition(intraId, profile.campus?.id ?? null);
			} catch (err) {
				coalitionKnown = false;
				this.logger.warn(`Failed to get the coalition of intra user ${intraId} (user ${userId}): ${err instanceof Error ? err.message : String(err)}`);
			}
		}

		const desiredRoleIds: MiRole['id'][] = [];
		let levelRoleId: MiRole['id'] | null = null;
		for (const target of getIntraRoleTargets(profile, intakeYearMonth, coalition)) {
			const roleId = await this.ensureRole(target);
			desiredRoleIds.push(roleId);
			if (target.kind === 'level') levelRoleId = roleId;
		}

		const managedRoleIds = managed
			.filter(r => coalitionKnown || r.kind !== 'coalition')
			.map(r => r.roleId);

		const { toAssign, toUnassign } = diffIntraRoleAssignments(managedRoleIds, desiredRoleIds, assignedRoleIds);

		for (const roleId of toUnassign) {
			try {
				await this.roleService.unassign(userId, roleId);
			} catch (err) {
				// 同じユーザーの同期が同時に走った場合は、既に解除されていることがある
				if (!(err instanceof RoleService.NotAssignedError)) throw err;
			}
		}

		const leveledUpLevel = getLeveledUpLevel(previousLevelKeys, profile.level);
		for (const roleId of toAssign) {
			try {
				await this.roleService.assign(userId, roleId);
			} catch (err) {
				// 同じユーザーの同期が同時に走ったときは、先に付けた方だけが通知する
				if (!(err instanceof RoleService.AlreadyAssignedError)) throw err;
				continue;
			}
			if (roleId === levelRoleId && leveledUpLevel != null) {
				this.notificationService.createNotification(userId, 'intraLevelUp', { level: leveledUpLevel });
			}
		}
	}

	/**
	 * 条件に対応するロールの ID を返す。無ければロールを作成して intra_role に記録する
	 */
	@bindThis
	private async ensureRole(target: IntraRoleTarget): Promise<MiRole['id']> {
		const iconUrl = getIntraRoleIconUrl(target, this.getIconTemplates());
		const existing = await this.intraRolesRepository.findOneBy({ kind: target.kind, key: target.key });
		if (existing != null) {
			if (iconUrl != null) await this.ensureRoleIcon(existing.roleId, iconUrl);
			return existing.roleId;
		}

		const role = await this.roleService.create({
			name: target.name,
			description: ROLE_DESCRIPTIONS[target.kind],
			color: target.color ?? null,
			iconUrl,
			target: 'manual',
			isPublic: true,
			asBadge: true,
			isModerator: false,
			isAdministrator: false,
			// ロールのタイムラインを公開する
			isExplorable: true,
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

	/**
	 * 作成済みのロールにアイコンが無ければ設定する。管理者が設定したアイコンは上書きしない。
	 * 同期のたびに確認しないよう、確認済みのロールはプロセスの中で覚えておく
	 */
	@bindThis
	private async ensureRoleIcon(roleId: MiRole['id'], iconUrl: string): Promise<void> {
		if (this.checkedRoleIcons.has(roleId)) return;
		const role = (await this.roleService.getRoles()).find(r => r.id === roleId);
		if (role == null) return;
		if (role.iconUrl == null) {
			await this.roleService.update(role, { iconUrl });
			this.logger.info(`Set icon of role ${role.id} (${role.name})`);
		}
		this.checkedRoleIcons.add(roleId);
	}
}
