/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In, IsNull } from 'typeorm';
import type { DataSource, SelectQueryBuilder } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type {
	CalendarEventsRepository,
	FollowingsRepository,
	UserListMembershipsRepository,
	UserListsRepository,
	UsersRepository,
} from '@/models/_.js';
import { MiCalendarEvent } from '@/models/CalendarEvent.js';
import type { MiUser } from '@/models/User.js';
import { RoleService } from '@/core/RoleService.js';
import { bindThis } from '@/decorators.js';
import { CalendarEventValidationError } from './calendar-errors.js';
import { calendarEventVisibleSql, isCalendarEventVisibleTo, normalizeCalendarEventVisibility } from './calendar-visibility.js';
import type { CalendarEventViewerRelation, CalendarEventVisibilityInput, NormalizedCalendarEventVisibility } from './calendar-visibility.js';

type Me = { id: MiUser['id'] };

type VisibilityFields = Pick<MiCalendarEvent, 'id' | 'userId' | 'visibility' | 'visibleUserIds' | 'userListId'>;

export type CalendarViewOptions = {
	/** モデレーター以上なら公開範囲の外のイベントも見る (管理人ビューと、管理の操作)。ほかの人には効かない */
	moderatorView?: boolean;
};

/**
 * イベントの公開範囲の検証と判定。作成者は常に見られる。
 * モデレーター以上も普段はほかの人と同じで、moderatorView を付けたときだけ公開範囲に関係なく見られる
 */
@Injectable()
export class CalendarVisibilityService {
	constructor(
		@Inject(DI.db)
		private db: DataSource,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userListsRepository)
		private userListsRepository: UserListsRepository,

		@Inject(DI.userListMembershipsRepository)
		private userListMembershipsRepository: UserListMembershipsRepository,

		@Inject(DI.followingsRepository)
		private followingsRepository: FollowingsRepository,

		@Inject(DI.calendarEventsRepository)
		private calendarEventsRepository: CalendarEventsRepository,

		private roleService: RoleService,
	) {
	}

	/**
	 * 公開範囲の入力を検証し、保存する形にする。
	 * 指定ユーザーは実在するローカルのユーザーだけを残し、リストは作成者のものだけを受け付ける
	 * @param creatorId イベントの作成者 (モデレーターが編集するときも作成者)
	 * @throws CalendarEventValidationError
	 */
	@bindThis
	public async resolve(input: CalendarEventVisibilityInput, creatorId: MiUser['id']): Promise<NormalizedCalendarEventVisibility> {
		const normalized = normalizeCalendarEventVisibility(input, creatorId);

		if (normalized.visibility === 'specified') {
			const users = await this.usersRepository.find({
				where: { id: In(normalized.visibleUserIds), host: IsNull(), isDeleted: false },
				select: { id: true },
			});
			const existing = new Set(users.map(u => u.id));
			const visibleUserIds = normalized.visibleUserIds.filter(id => existing.has(id));
			if (visibleUserIds.length === 0) throw new CalendarEventValidationError('visibleUsersRequired');
			return { ...normalized, visibleUserIds };
		}

		if (normalized.visibility === 'list') {
			const exists = await this.userListsRepository.exists({ where: { id: normalized.userListId!, userId: creatorId } });
			if (!exists) throw new CalendarEventValidationError('invalidUserList');
		}

		return normalized;
	}

	/**
	 * viewer がイベントを見られるか。viewer が null (未ログイン) なら全員向けのイベントだけ
	 */
	@bindThis
	public async canView(event: VisibilityFields, viewer: Me | null | undefined, opts?: CalendarViewOptions): Promise<boolean> {
		if (event.visibility === 'public') return true;
		if (viewer == null) return false;
		if (event.userId === viewer.id) return true;

		if (isCalendarEventVisibleTo(event, viewer, await this.getRelation(event, viewer))) return true;
		return opts?.moderatorView === true && await this.roleService.isModerator(viewer);
	}

	/** 判定に要る、閲覧者と作成者の関係だけを引く */
	@bindThis
	private async getRelation(event: VisibilityFields, viewer: Me): Promise<CalendarEventViewerRelation> {
		switch (event.visibility) {
			case 'followers':
				return { isFollowingCreator: await this.isFollowing(viewer.id, event.userId) };
			case 'mutual': {
				const [isFollowingCreator, isFollowedByCreator] = await Promise.all([
					this.isFollowing(viewer.id, event.userId),
					this.isFollowing(event.userId, viewer.id),
				]);
				return { isFollowingCreator, isFollowedByCreator };
			}
			case 'list':
				return {
					isListMember: event.userListId != null && await this.userListMembershipsRepository.exists({ where: { userListId: event.userListId, userId: viewer.id } }),
				};
			default:
				return {};
		}
	}

	@bindThis
	private async isFollowing(followerId: MiUser['id'], followeeId: MiUser['id']): Promise<boolean> {
		return await this.followingsRepository.exists({ where: { followerId, followeeId } });
	}

	/**
	 * イベントの一覧を、me が見られるものだけに絞る (並びは変えない)
	 */
	@bindThis
	public async filterVisible<T extends VisibilityFields>(events: T[], me: Me | null | undefined, opts?: CalendarViewOptions): Promise<T[]> {
		const restricted = events.filter(e => e.visibility !== 'public' && e.userId !== me?.id);
		if (restricted.length === 0) return events;
		if (me == null) return events.filter(e => e.visibility === 'public');
		if (opts?.moderatorView === true && await this.roleService.isModerator(me)) return events;

		const rows = await this.calendarEventsRepository.createQueryBuilder('event')
			.select('event.id', 'id')
			.where('event.id IN (:...ids)', { ids: restricted.map(e => e.id) })
			.andWhere(calendarEventVisibleSql('event', ':calendarViewerId'), { calendarViewerId: me.id })
			.getRawMany<{ id: MiCalendarEvent['id'] }>();
		const visible = new Set(rows.map(r => r.id));
		return events.filter(e => e.visibility === 'public' || e.userId === me.id || visible.has(e.id));
	}

	/**
	 * イベントを引くクエリに、me が見られるものだけに絞る条件を足す (モデレーター以上も絞る。ウィジェットと配信用)
	 * @param eventAlias クエリでのイベントの表の別名
	 */
	@bindThis
	public applyVisibleFilter(query: SelectQueryBuilder<any>, eventAlias: string, me: Me | null | undefined): void {
		if (me == null) {
			query.andWhere(`"${eventAlias}"."visibility" = 'public'`);
			return;
		}
		query.andWhere(calendarEventVisibleSql(eventAlias, ':calendarViewerId'), { calendarViewerId: me.id });
	}

	/**
	 * userIds のうち、イベントを見られるローカルのユーザー (凍結・削除済みを除く)。モデレーターかどうかは見ない
	 */
	@bindThis
	public async filterUsersWhoCanView(event: Pick<MiCalendarEvent, 'id'>, userIds: MiUser['id'][]): Promise<Set<MiUser['id']>> {
		if (userIds.length === 0) return new Set();
		const rows = await this.usersRepository.createQueryBuilder('user')
			.select('user.id', 'id')
			.innerJoin(MiCalendarEvent, 'event', 'event.id = :eventId', { eventId: event.id })
			.where('user.id IN (:...userIds)', { userIds })
			.andWhere('user.host IS NULL')
			.andWhere('user.isDeleted = FALSE')
			.andWhere('user.isSuspended = FALSE')
			.andWhere(calendarEventVisibleSql('event', '"user"."id"'))
			.getRawMany<{ id: MiUser['id'] }>();
		return new Set(rows.map(r => r.id));
	}

	/**
	 * 公開範囲の外になった人の購読を外す (作成者の購読は残す)。公開範囲を変えたあとに呼ぶ。
	 * モデレーターかどうかは見ないので、範囲の外のモデレーターの購読も外れる
	 * @returns 外した数
	 */
	@bindThis
	public async removeSubscriptionsOutsideVisibility(event: Pick<MiCalendarEvent, 'id'>): Promise<number> {
		const [, affected] = await this.db.query(
			`DELETE FROM "calendar_event_subscription" AS "subscription" USING "calendar_event" AS "event"
			WHERE "subscription"."eventId" = "event"."id" AND "event"."id" = $1
			AND NOT ${calendarEventVisibleSql('event', '"subscription"."userId"')}`,
			[event.id],
		) as [unknown, number];
		return affected;
	}

	/**
	 * 公開範囲で見られる人 (作成者を除く)。指定ユーザーとリストのときだけ返し、それ以外は空 (招待の通知を送る相手)
	 */
	@bindThis
	public async getAudienceUserIds(event: VisibilityFields): Promise<MiUser['id'][]> {
		if (event.visibility === 'specified') return event.visibleUserIds.filter(id => id !== event.userId);
		if (event.visibility === 'list' && event.userListId != null) {
			const memberships = await this.userListMembershipsRepository.find({
				where: { userListId: event.userListId },
				select: { userId: true },
			});
			return memberships.map(m => m.userId).filter(id => id !== event.userId);
		}
		return [];
	}
}
