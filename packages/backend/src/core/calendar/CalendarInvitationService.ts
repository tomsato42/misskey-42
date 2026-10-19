/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type {
	CalendarEventInvitationsRepository,
	CalendarEventSubscriptionsRepository,
	UserListMembershipsRepository,
	UserListsRepository,
	UserProfilesRepository,
} from '@/models/_.js';
import type { MiCalendarEvent } from '@/models/CalendarEvent.js';
import { MiCalendarEventInvitation } from '@/models/CalendarEventInvitation.js';
import type { MiUser } from '@/models/User.js';
import type { MiUserList } from '@/models/UserList.js';
import { CacheService } from '@/core/CacheService.js';
import { IdService } from '@/core/IdService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { RoleService } from '@/core/RoleService.js';
import { bindThis } from '@/decorators.js';
import { CalendarEventCanceledError, CalendarEventPermissionError, CalendarUserListNotFoundError } from './calendar-errors.js';
import { CalendarVisibilityService } from './CalendarVisibilityService.js';

type Me = { id: MiUser['id'] };

type InvitationTarget = Pick<MiCalendarEvent, 'id' | 'userId' | 'canceledAt' | 'visibility' | 'visibleUserIds' | 'userListId'>;

/**
 * invitable: 招待できる、subscribed: 購読している (作成者を含む)、invited: 招待済み、
 * unavailable: 送れない (自分自身・イベントを見られない人・凍結や削除済みの人)
 */
export const calendarInvitationStatuses = ['invitable', 'subscribed', 'invited', 'unavailable'] as const;
export type CalendarInvitationStatus = typeof calendarInvitationStatuses[number];

/** 1 回の招待で送る相手の上限 (ユーザーとリストのメンバーを合わせて)。超えた分は送らない */
export const CALENDAR_INVITATION_MAX_TARGETS = 200;

/** 公開範囲 (指定ユーザー・リスト) で見られる人を招待するときの上限 */
const CALENDAR_AUDIENCE_INVITATION_MAX_TARGETS = 1000;

export type CalendarInvitationResult = {
	/** 招待した数 (dryRun のときは招待できる数) */
	invited: number;
	/** 購読しているので送らなかった数 */
	subscribed: number;
	/** 招待済みなので送らなかった数 */
	alreadyInvited: number;
	/** 送れなかった数 */
	unavailable: number;
};

/**
 * イベントへの招待。招待できるのはイベントを購読している人と、管理できる人 (作成者・モデレーター以上。canInvite)。
 * 同じ人への招待は 1 回だけで、招待された人には calendarEventInvited の通知が届く
 */
@Injectable()
export class CalendarInvitationService {
	constructor(
		@Inject(DI.calendarEventInvitationsRepository)
		private calendarEventInvitationsRepository: CalendarEventInvitationsRepository,

		@Inject(DI.calendarEventSubscriptionsRepository)
		private calendarEventSubscriptionsRepository: CalendarEventSubscriptionsRepository,

		@Inject(DI.userListsRepository)
		private userListsRepository: UserListsRepository,

		@Inject(DI.userListMembershipsRepository)
		private userListMembershipsRepository: UserListMembershipsRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private calendarVisibilityService: CalendarVisibilityService,
		private notificationService: NotificationService,
		private cacheService: CacheService,
		private roleService: RoleService,
		private idService: IdService,
	) {
	}

	/**
	 * me がイベントに招待を送れるか。作成者とモデレーター以上はいつでも、購読している人は全員・フォロワー・相互フォローのイベントなら送れる。
	 * 招待の状態 (unavailable) からは、その人がイベントを見られるか、つまり作成者との関係が分かる。
	 * 指定ユーザー・リストのイベントは見られる人を作成者が決めている (作ったときに招待している) ので、管理できる人だけにする。
	 * フォロワー・相互フォローのイベントは、作成者がその関係 (フォロワー・フォロー) を非公開にしていたら購読者には送らせない。
	 * me がイベントを見られること (作成者をフォローしていること) は呼ぶ側で確かめておく
	 */
	@bindThis
	public async canInvite(event: Pick<MiCalendarEvent, 'id' | 'userId' | 'visibility'>, me: Me): Promise<boolean> {
		if (event.userId === me.id) return true;
		if (await this.roleService.isModerator(me)) return true;
		if (event.visibility === 'specified' || event.visibility === 'list') return false;
		if (await this.calendarVisibilityService.hidesAudienceRelations(event)) return false;
		return await this.calendarEventSubscriptionsRepository.exists({ where: { eventId: event.id, userId: me.id } });
	}

	/**
	 * inviter から見た、ユーザーごとの招待の状態
	 */
	@bindThis
	public async getStatuses(event: Pick<MiCalendarEvent, 'id'>, inviter: Me, userIds: MiUser['id'][]): Promise<Map<MiUser['id'], CalendarInvitationStatus>> {
		const ids = [...new Set(userIds)];
		const result = new Map<MiUser['id'], CalendarInvitationStatus>();
		if (ids.length === 0) return result;

		const [canView, subscriptions, invitations] = await Promise.all([
			this.calendarVisibilityService.filterUsersWhoCanView(event, ids),
			this.calendarEventSubscriptionsRepository.find({ where: { eventId: event.id, userId: In(ids) }, select: { userId: true } }),
			this.calendarEventInvitationsRepository.find({ where: { eventId: event.id, userId: In(ids) }, select: { userId: true } }),
		]);
		const subscribed = new Set(subscriptions.map(s => s.userId));
		const invited = new Set(invitations.map(i => i.userId));

		for (const id of ids) {
			if (id === inviter.id || !canView.has(id)) {
				result.set(id, 'unavailable');
			} else if (subscribed.has(id)) {
				result.set(id, 'subscribed');
			} else if (invited.has(id)) {
				result.set(id, 'invited');
			} else {
				result.set(id, 'invitable');
			}
		}
		return result;
	}

	/**
	 * ユーザーと inviter のリストのメンバーを招待する。dryRun なら何も保存せず、送る数だけを返す
	 * @throws CalendarEventPermissionError 招待を送れない (購読しておらず、管理もできない)
	 * @throws CalendarEventCanceledError 中止したイベント
	 * @throws CalendarUserListNotFoundError リストが無い、または inviter のものではない
	 */
	@bindThis
	public async invite(
		event: InvitationTarget,
		inviter: Me,
		opts: { userIds?: MiUser['id'][]; userListId?: MiUserList['id'] | null; dryRun?: boolean },
	): Promise<CalendarInvitationResult> {
		if (event.canceledAt != null) throw new CalendarEventCanceledError();
		if (!await this.canInvite(event, inviter)) throw new CalendarEventPermissionError();

		const targets = [...(opts.userIds ?? [])];
		if (opts.userListId != null) {
			const list = await this.userListsRepository.findOneBy({ id: opts.userListId, userId: inviter.id });
			if (list == null) throw new CalendarUserListNotFoundError();
			const memberships = await this.userListMembershipsRepository.find({ where: { userListId: list.id }, select: { userId: true } });
			targets.push(...memberships.map(m => m.userId));
		}

		return await this.inviteUsers(event, inviter, [...new Set(targets)].slice(0, CALENDAR_INVITATION_MAX_TARGETS), opts.dryRun === true);
	}

	/**
	 * 公開範囲が指定ユーザー・リストのイベントの、見られる人を作成者から招待する (作ったときと、公開範囲を変えたとき)。
	 * 招待済みの人には送らないので、変えたときは新しく見られるようになった人にだけ届く
	 */
	@bindThis
	public async inviteAudience(event: InvitationTarget): Promise<CalendarInvitationResult> {
		const audience = await this.calendarVisibilityService.getAudienceUserIds(event);
		return await this.inviteUsers(event, { id: event.userId }, audience.slice(0, CALENDAR_AUDIENCE_INVITATION_MAX_TARGETS), false);
	}

	@bindThis
	private async inviteUsers(event: Pick<MiCalendarEvent, 'id'>, inviter: Me, userIds: MiUser['id'][], dryRun: boolean): Promise<CalendarInvitationResult> {
		const statuses = await this.getStatuses(event, inviter, userIds);
		const count = (status: CalendarInvitationStatus) => [...statuses.values()].filter(s => s === status).length;
		const invitable = [...statuses].filter(([, s]) => s === 'invitable').map(([id]) => id);

		const result: CalendarInvitationResult = {
			invited: invitable.length,
			subscribed: count('subscribed'),
			alreadyInvited: count('invited'),
			unavailable: count('unavailable'),
		};
		if (dryRun || invitable.length === 0) return result;

		const inserted = await this.calendarEventInvitationsRepository.createQueryBuilder()
			.insert()
			.into(MiCalendarEventInvitation)
			.values(invitable.map(userId => ({
				id: this.idService.gen(),
				eventId: event.id,
				userId,
				inviterId: inviter.id,
			})))
			// 同時に招待されたときは先に入ったものを使う
			.orIgnore()
			.returning(['userId'])
			.execute();
		const invitedIds = (inserted.raw as { userId: MiUser['id'] }[]).map(row => row.userId);

		await this.notifyInvited(event, inviter, invitedIds);
		return { ...result, invited: invitedIds.length, alreadyInvited: result.alreadyInvited + (invitable.length - invitedIds.length) };
	}

	/**
	 * 招待の通知を送る。招待の通知をオフにした人と、inviter をブロックしている人には送らない (招待の記録は残す)。
	 * inviter をミュートしている人には NotificationService が送らない
	 */
	@bindThis
	private async notifyInvited(event: Pick<MiCalendarEvent, 'id'>, inviter: Me, userIds: MiUser['id'][]): Promise<void> {
		if (userIds.length === 0) return;

		const rows = await this.userProfilesRepository.createQueryBuilder('profile')
			.select('profile.userId', 'userId')
			.where('profile.userId IN (:...userIds)', { userIds })
			// 既定はオン。項目が無いときもオンとみなす
			.andWhere('COALESCE((profile.calendarNotificationSettings ->> \'invited\')::boolean, TRUE) = TRUE')
			.getRawMany<{ userId: MiUser['id'] }>();

		for (const { userId } of rows) {
			const blocking = await this.cacheService.userBlockingCache.fetch(userId);
			if (blocking.has(inviter.id)) continue;
			this.notificationService.createNotification(userId, 'calendarEventInvited', { eventId: event.id }, inviter.id);
		}
	}

	/**
	 * me を招待した人の ID。招待されていなければ null
	 */
	@bindThis
	public async getInviterId(event: Pick<MiCalendarEvent, 'id'>, me: Me): Promise<MiUser['id'] | null> {
		const invitation = await this.calendarEventInvitationsRepository.findOne({
			where: { eventId: event.id, userId: me.id },
			select: { inviterId: true },
		});
		return invitation?.inviterId ?? null;
	}
}
