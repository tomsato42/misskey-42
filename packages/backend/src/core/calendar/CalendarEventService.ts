/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { And, In, IsNull, LessThan, MoreThanOrEqual } from 'typeorm';
import type { DataSource, FindOptionsWhere } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type {
	CalendarEventNotesRepository,
	CalendarEventRemindersRepository,
	CalendarEventsRepository,
	CalendarEventSubscriptionsRepository,
} from '@/models/_.js';
import { MiCalendarEvent } from '@/models/CalendarEvent.js';
import { MiCalendarEventSubscription } from '@/models/CalendarEventSubscription.js';
import { MiCalendarEventNote } from '@/models/CalendarEventNote.js';
import { MiFollowing } from '@/models/Following.js';
import type { MiUser } from '@/models/User.js';
import type { MiNote } from '@/models/Note.js';
import { RoleService } from '@/core/RoleService.js';
import { IdService } from '@/core/IdService.js';
import { isDuplicateKeyValueError } from '@/misc/is-duplicate-key-value-error.js';
import { bindThis } from '@/decorators.js';
import { CalendarNotificationService } from './CalendarNotificationService.js';
import { CalendarVisibilityService } from './CalendarVisibilityService.js';
import type { CalendarViewOptions } from './CalendarVisibilityService.js';
import { CalendarInvitationService } from './CalendarInvitationService.js';
import {
	CalendarEventCanceledError,
	CalendarEventCannotUnsubscribeOwnError,
	CalendarEventNoteAlreadyLinkedError,
	CalendarEventNoteNotLinkedError,
	CalendarEventNotFoundError,
	CalendarEventPermissionError,
} from './calendar-errors.js';
import { normalizeCalendarEventInput } from './calendar-event-input.js';
import { startOfJstDay, toCalendarEventScheduleInput } from './calendar-time.js';
import { isCalendarEventVisibilityChanged } from './calendar-visibility.js';
import type { CalendarEventInput } from './calendar-event-input.js';
import type { CalendarEventSchedule } from './calendar-time.js';
import type { CalendarEventVisibilityInput, NormalizedCalendarEventVisibility } from './calendar-visibility.js';

type Me = { id: MiUser['id'] };

/**
 * all: すべて、subscribed: 購読しているもの (自分が作成したものを含む)、mine: 自分が作成したもの
 */
export type CalendarEventFilter = 'all' | 'subscribed' | 'mine';

export type CalendarEventScheduleChange = {
	previous: CalendarEventSchedule;
	current: CalendarEventSchedule;
};

export type CalendarEventUpdateResult = {
	event: MiCalendarEvent;
	/** 日時 (開始・終了・終日) が変わったときだけ入る */
	scheduleChange: CalendarEventScheduleChange | null;
	/** 公開範囲が変わったか */
	visibilityChanged: boolean;
};

function hasVisibilityInput(input: CalendarEventVisibilityInput | undefined): input is CalendarEventVisibilityInput {
	return input != null && (input.visibility !== undefined || input.visibleUserIds !== undefined || input.userListId !== undefined);
}

function visibilityOf(event: Pick<MiCalendarEvent, 'visibility' | 'visibleUserIds' | 'userListId'>): NormalizedCalendarEventVisibility {
	return { visibility: event.visibility, visibleUserIds: event.visibleUserIds, userListId: event.userListId };
}

function isSameSchedule(a: CalendarEventSchedule, b: CalendarEventSchedule): boolean {
	return a.startsAt.getTime() === b.startsAt.getTime()
		&& (a.endsAt?.getTime() ?? null) === (b.endsAt?.getTime() ?? null)
		&& a.isAllDay === b.isAllDay;
}

/**
 * カレンダーのイベントの作成・編集・購読・ノートとの紐づけ
 */
@Injectable()
export class CalendarEventService {
	constructor(
		@Inject(DI.db)
		private db: DataSource,

		@Inject(DI.calendarEventsRepository)
		private calendarEventsRepository: CalendarEventsRepository,

		@Inject(DI.calendarEventSubscriptionsRepository)
		private calendarEventSubscriptionsRepository: CalendarEventSubscriptionsRepository,

		@Inject(DI.calendarEventNotesRepository)
		private calendarEventNotesRepository: CalendarEventNotesRepository,

		@Inject(DI.calendarEventRemindersRepository)
		private calendarEventRemindersRepository: CalendarEventRemindersRepository,

		private roleService: RoleService,
		private idService: IdService,
		private calendarNotificationService: CalendarNotificationService,
		private calendarVisibilityService: CalendarVisibilityService,
		private calendarInvitationService: CalendarInvitationService,
	) {
	}

	//#region 作成・編集

	/**
	 * イベントを作り、作成者を購読させる。
	 * 告知のノートを渡すと、イベントの告知のノートとして記録し、イベントに紐づける。
	 * 公開範囲が指定ユーザー・リストなら、見られる人を招待する
	 * @throws CalendarEventValidationError 入力が仕様に合わない
	 * @throws CalendarEventPermissionError 告知のノートの作成者が me ではない
	 * @throws CalendarEventNoteAlreadyLinkedError 告知のノートが既に別のイベントに紐づいている
	 */
	@bindThis
	public async create(
		me: Me,
		input: CalendarEventInput,
		opts: { announcementNote?: Pick<MiNote, 'id' | 'userId'>; visibility?: CalendarEventVisibilityInput } = {},
	): Promise<MiCalendarEvent> {
		const values = normalizeCalendarEventInput(input);
		const announcementNote = opts.announcementNote ?? null;
		if (announcementNote != null && announcementNote.userId !== me.id) {
			throw new CalendarEventPermissionError();
		}
		const visibility = await this.resolveVisibility(opts.visibility ?? {}, me.id);

		const eventId = this.idService.gen();

		try {
			await this.db.transaction(async em => {
				await em.insert(MiCalendarEvent, {
					id: eventId,
					userId: me.id,
					...values,
					...visibility,
					announcementNoteId: announcementNote?.id ?? null,
					canceledAt: null,
					updatedAt: null,
				});
				await em.insert(MiCalendarEventSubscription, {
					id: this.idService.gen(),
					eventId,
					userId: me.id,
				});
				if (announcementNote != null) {
					await em.insert(MiCalendarEventNote, {
						id: this.idService.gen(),
						eventId,
						noteId: announcementNote.id,
						userId: me.id,
					});
				}
			});
		} catch (err) {
			// 一意制約に触れうるのは告知のノートの紐づけだけ (イベントと購読の id は新しく作ったもの)
			if (announcementNote != null && isDuplicateKeyValueError(err)) {
				throw new CalendarEventNoteAlreadyLinkedError();
			}
			throw err;
		}

		const created = await this.calendarEventsRepository.findOneByOrFail({ id: eventId });
		if (visibility.visibility === 'specified' || visibility.visibility === 'list') {
			await this.onAudienceChanged(created);
		}
		return created;
	}

	/**
	 * 公開範囲の入力を検証して保存する形にする (ノートと一緒に作るときは、ノートを作る前に確かめるのに使う)
	 * @param creatorId イベントの作成者
	 * @throws CalendarEventValidationError
	 */
	@bindThis
	public async resolveVisibility(input: CalendarEventVisibilityInput, creatorId: MiUser['id']): Promise<NormalizedCalendarEventVisibility> {
		return await this.calendarVisibilityService.resolve(input, creatorId);
	}

	/**
	 * イベントを編集する。input・visibility に無い項目は変えない。
	 * 日時が変わったら送ったリマインダーの記録を消し (送り直せるように)、onScheduleChanged を呼ぶ。
	 * 公開範囲が変わったら、範囲の外になった人の購読を外し、onAudienceChanged を呼ぶ
	 * @throws CalendarEventPermissionError 作成者でもモデレーター以上でもない
	 * @throws CalendarEventCanceledError 中止したイベント
	 * @throws CalendarEventValidationError 入力が仕様に合わない
	 */
	@bindThis
	public async update(event: MiCalendarEvent, input: Partial<CalendarEventInput>, me: Me, visibilityInput?: CalendarEventVisibilityInput): Promise<CalendarEventUpdateResult> {
		await this.assertCanManage(event, me);
		if (event.canceledAt != null) throw new CalendarEventCanceledError();

		const previousVisibility = visibilityOf(event);
		// 公開範囲の項目は、省略したものを今の値で補ってから検証する (リストは作成者のものでなければならない)
		const visibility = hasVisibilityInput(visibilityInput)
			? await this.resolveVisibility({
				visibility: visibilityInput.visibility ?? event.visibility,
				visibleUserIds: visibilityInput.visibleUserIds !== undefined ? visibilityInput.visibleUserIds : event.visibleUserIds,
				userListId: visibilityInput.userListId !== undefined ? visibilityInput.userListId : event.userListId,
			}, event.userId)
			: previousVisibility;
		const visibilityChanged = isCalendarEventVisibilityChanged(previousVisibility, visibility);

		const defined = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<CalendarEventInput>;
		const merged: CalendarEventInput = {
			title: event.title,
			location: event.location,
			description: event.description,
			...toCalendarEventScheduleInput(event),
			...defined,
			// 保存済みのハッシュタグは正規化済みなので、変えないときは検証し直さない
			hashtag: defined.hashtag !== undefined ? defined.hashtag : null,
		};
		const normalized = normalizeCalendarEventInput(merged);
		const values = {
			...normalized,
			hashtag: defined.hashtag !== undefined ? normalized.hashtag : event.hashtag,
			...visibility,
			updatedAt: new Date(),
		};

		const previous: CalendarEventSchedule = { startsAt: event.startsAt, endsAt: event.endsAt, isAllDay: event.isAllDay };
		const current: CalendarEventSchedule = { startsAt: values.startsAt, endsAt: values.endsAt, isAllDay: values.isAllDay };
		const scheduleChange = isSameSchedule(previous, current) ? null : { previous, current };

		await this.calendarEventsRepository.update(event.id, values);
		const updated: MiCalendarEvent = { ...event, ...values };

		if (scheduleChange != null) {
			await this.calendarEventRemindersRepository.delete({ eventId: event.id });
			await this.onScheduleChanged(updated, scheduleChange, me);
		}

		if (visibilityChanged) {
			await this.calendarVisibilityService.removeSubscriptionsOutsideVisibility(updated);
			await this.onAudienceChanged(updated);
		}

		return { event: updated, scheduleChange, visibilityChanged };
	}

	/**
	 * イベントを中止する (イベントは残し、canceledAt を入れる)。終わったら onCanceled を呼ぶ
	 * @throws CalendarEventPermissionError 作成者でもモデレーター以上でもない
	 * @throws CalendarEventCanceledError 既に中止している
	 */
	@bindThis
	public async cancel(event: MiCalendarEvent, me: Me): Promise<MiCalendarEvent> {
		await this.assertCanManage(event, me);
		if (event.canceledAt != null) throw new CalendarEventCanceledError();

		const now = new Date();
		// 同時に中止されたときに通知が二重にならないよう、まだ中止していないときだけ更新する
		const result = await this.calendarEventsRepository.update({ id: event.id, canceledAt: IsNull() }, { canceledAt: now, updatedAt: now });
		if (result.affected === 0) {
			const latest = await this.calendarEventsRepository.findOneBy({ id: event.id });
			if (latest == null) throw new CalendarEventNotFoundError();
			throw new CalendarEventCanceledError();
		}

		const canceled: MiCalendarEvent = { ...event, canceledAt: now, updatedAt: now };
		await this.onCanceled(canceled, me);
		return canceled;
	}

	/**
	 * イベントを削除する。購読・ノートとの紐づけ・リマインダーの記録も消える (ノート自体は残る)
	 * @throws CalendarEventPermissionError 作成者でもモデレーター以上でもない
	 */
	@bindThis
	public async delete(event: MiCalendarEvent, me: Me): Promise<void> {
		await this.assertCanManage(event, me);
		await this.calendarEventsRepository.delete(event.id);
	}

	/**
	 * 編集・中止・削除ができるか (作成者かモデレーター以上)
	 */
	@bindThis
	public async canManage(event: Pick<MiCalendarEvent, 'userId'>, me: Me): Promise<boolean> {
		if (event.userId === me.id) return true;
		return await this.roleService.isModerator(me);
	}

	/**
	 * 複数のイベントについて canManage を判定する関数を返す (一覧の表示用)。
	 * モデレーターかどうかは、自分が作成していないイベントがあるときに 1 回だけ調べる
	 */
	@bindThis
	public async createManageChecker(me: Me, events: Pick<MiCalendarEvent, 'userId'>[]): Promise<(event: Pick<MiCalendarEvent, 'userId'>) => boolean> {
		const isModerator = events.some(e => e.userId !== me.id) ? await this.roleService.isModerator(me) : false;
		return event => event.userId === me.id || isModerator;
	}

	@bindThis
	private async assertCanManage(event: Pick<MiCalendarEvent, 'userId'>, me: Me): Promise<void> {
		if (!await this.canManage(event, me)) throw new CalendarEventPermissionError();
	}

	/**
	 * イベントの日時が変わったあとに呼ばれる。購読者 (操作した本人を除く) に通知する (送るのは待たない)
	 */
	@bindThis
	protected async onScheduleChanged(event: MiCalendarEvent, change: CalendarEventScheduleChange, me: Me): Promise<void> {
		this.calendarNotificationService.notifyRescheduled(event, change, me);
	}

	/**
	 * イベントを中止したあとに呼ばれる。購読者 (操作した本人を除く) に通知する (送るのは待たない)
	 */
	@bindThis
	protected async onCanceled(event: MiCalendarEvent, me: Me): Promise<void> {
		this.calendarNotificationService.notifyCanceled(event, me);
	}

	/**
	 * 公開範囲が指定ユーザー・リストのイベントを作ったとき、公開範囲を変えたときに呼ばれる。
	 * 見られる人のうち、まだ招待していない人を作成者から招待する (それ以外の公開範囲では何もしない)
	 */
	@bindThis
	protected async onAudienceChanged(event: MiCalendarEvent): Promise<void> {
		await this.calendarInvitationService.inviteAudience(event);
	}

	//#endregion

	//#region 購読

	/**
	 * イベントを購読する。購読済みなら何もしない
	 * @throws CalendarEventNotFoundError 公開範囲の外
	 * @throws CalendarEventCanceledError 中止したイベント
	 */
	@bindThis
	public async subscribe(event: MiCalendarEvent, me: Me): Promise<void> {
		if (!await this.canView(event, me)) throw new CalendarEventNotFoundError();
		if (event.canceledAt != null) throw new CalendarEventCanceledError();
		if (await this.isSubscribed(event, me)) return;

		try {
			await this.calendarEventSubscriptionsRepository.insert({
				id: this.idService.gen(),
				eventId: event.id,
				userId: me.id,
			});
		} catch (err) {
			// 同時に購読したときは先に入ったものを使う
			if (isDuplicateKeyValueError(err)) return;
			throw err;
		}
	}

	/**
	 * イベントの購読を解除する。購読していなければ何もしない
	 * @throws CalendarEventCannotUnsubscribeOwnError イベントの作成者
	 */
	@bindThis
	public async unsubscribe(event: MiCalendarEvent, me: Me): Promise<void> {
		if (event.userId === me.id) throw new CalendarEventCannotUnsubscribeOwnError();
		await this.calendarEventSubscriptionsRepository.delete({ eventId: event.id, userId: me.id });
	}

	@bindThis
	public async isSubscribed(event: Pick<MiCalendarEvent, 'id'>, me: Me): Promise<boolean> {
		return await this.calendarEventSubscriptionsRepository.exists({
			where: { eventId: event.id, userId: me.id },
		});
	}

	/**
	 * eventIds のうち、me が購読しているイベントの ID (一覧の表示用)
	 */
	@bindThis
	public async getSubscribedEventIds(me: Me, eventIds: MiCalendarEvent['id'][]): Promise<Set<MiCalendarEvent['id']>> {
		if (eventIds.length === 0) return new Set();
		const subscriptions = await this.calendarEventSubscriptionsRepository.find({
			where: { userId: me.id, eventId: In(eventIds) },
			select: { eventId: true },
		});
		return new Set(subscriptions.map(s => s.eventId));
	}

	@bindThis
	public async countSubscribers(event: Pick<MiCalendarEvent, 'id'>): Promise<number> {
		return await this.calendarEventSubscriptionsRepository.countBy({ eventId: event.id });
	}

	/**
	 * 作成者以外の購読者を、新しく購読した順に引く (購読者の一覧用。sinceId だけを渡したときは古い順)。
	 * 凍結・削除済みのユーザーは除く。user を結合して返す
	 */
	@bindThis
	public async listSubscribers(
		event: Pick<MiCalendarEvent, 'id' | 'userId'>,
		opts: { limit: number; sinceId?: string; untilId?: string },
	): Promise<MiCalendarEventSubscription[]> {
		const query = this.calendarEventSubscriptionsRepository.createQueryBuilder('subscription')
			.innerJoinAndSelect('subscription.user', 'user')
			.where('subscription.eventId = :eventId', { eventId: event.id })
			.andWhere('subscription.userId != :ownerId', { ownerId: event.userId })
			.andWhere('user.isDeleted = FALSE')
			.andWhere('user.isSuspended = FALSE')
			.orderBy('subscription.id', opts.sinceId != null && opts.untilId == null ? 'ASC' : 'DESC')
			.limit(opts.limit);

		if (opts.sinceId != null) query.andWhere('subscription.id > :sinceId', { sinceId: opts.sinceId });
		if (opts.untilId != null) query.andWhere('subscription.id < :untilId', { untilId: opts.untilId });

		return await query.getMany();
	}

	/**
	 * 作成者以外の購読者のうち、me がフォローしている人の数 (凍結・削除済みを除く)
	 */
	@bindThis
	public async countFollowingSubscribers(event: Pick<MiCalendarEvent, 'id' | 'userId'>, me: Me): Promise<number> {
		return await this.calendarEventSubscriptionsRepository.createQueryBuilder('subscription')
			.innerJoin('subscription.user', 'user')
			.innerJoin(MiFollowing, 'following', 'following.followeeId = subscription.userId AND following.followerId = :meId', { meId: me.id })
			.where('subscription.eventId = :eventId', { eventId: event.id })
			.andWhere('subscription.userId != :ownerId', { ownerId: event.userId })
			.andWhere('user.isDeleted = FALSE')
			.andWhere('user.isSuspended = FALSE')
			.getCount();
	}

	/**
	 * 購読者のアバターに並べる人の ID (イベントのページ用)。me がフォローしている人を先に、新しく購読した順に limit 人まで
	 */
	@bindThis
	public async getSubscriberPreviewUserIds(event: Pick<MiCalendarEvent, 'id'>, me: Me, limit: number): Promise<MiUser['id'][]> {
		const rows = await this.calendarEventSubscriptionsRepository.createQueryBuilder('subscription')
			.select('subscription.userId', 'userId')
			.innerJoin('subscription.user', 'user')
			.leftJoin(MiFollowing, 'following', 'following.followeeId = subscription.userId AND following.followerId = :meId', { meId: me.id })
			.where('subscription.eventId = :eventId', { eventId: event.id })
			.andWhere('user.isDeleted = FALSE')
			.andWhere('user.isSuspended = FALSE')
			.orderBy('CASE WHEN following.id IS NULL THEN 1 ELSE 0 END', 'ASC')
			.addOrderBy('subscription.id', 'DESC')
			.limit(limit)
			.getRawMany<{ userId: MiUser['id'] }>();
		return rows.map(r => r.userId);
	}

	/**
	 * イベントごとの購読者の数 (一覧の表示用)。購読者がいないイベントは 0
	 */
	@bindThis
	public async countSubscribersOfEvents(eventIds: MiCalendarEvent['id'][]): Promise<Map<MiCalendarEvent['id'], number>> {
		const counts = new Map<MiCalendarEvent['id'], number>(eventIds.map(id => [id, 0]));
		if (eventIds.length === 0) return counts;
		const rows = await this.calendarEventSubscriptionsRepository.createQueryBuilder('subscription')
			.select('subscription.eventId', 'eventId')
			.addSelect('COUNT(*)', 'count')
			.where('subscription.eventId IN (:...eventIds)', { eventIds })
			.groupBy('subscription.eventId')
			.getRawMany<{ eventId: string; count: string }>();
		for (const row of rows) {
			counts.set(row.eventId, Number(row.count));
		}
		return counts;
	}

	//#endregion

	//#region ノートとの紐づけ

	/**
	 * ノートをイベントに紐づける。同じイベントに紐づけ済みなら何もしない
	 * @throws CalendarEventPermissionError ノートの作成者ではない
	 * @throws CalendarEventNotFoundError イベントが存在しない、または公開範囲の外
	 * @throws CalendarEventNoteAlreadyLinkedError ノートが既に別のイベントに紐づいている
	 */
	@bindThis
	public async linkNote(note: Pick<MiNote, 'id' | 'userId'>, eventId: MiCalendarEvent['id'], me: Me): Promise<MiCalendarEvent> {
		if (note.userId !== me.id) throw new CalendarEventPermissionError();
		const event = await this.findByIdOrFail(eventId);
		if (!await this.canView(event, me)) throw new CalendarEventNotFoundError();

		const existing = await this.calendarEventNotesRepository.findOneBy({ noteId: note.id });
		if (existing != null) {
			if (existing.eventId === event.id) return event;
			throw new CalendarEventNoteAlreadyLinkedError();
		}

		try {
			await this.calendarEventNotesRepository.insert({
				id: this.idService.gen(),
				eventId: event.id,
				noteId: note.id,
				userId: note.userId,
			});
		} catch (err) {
			if (!isDuplicateKeyValueError(err)) throw err;
			// 同時に紐づけられたとき
			const linked = await this.calendarEventNotesRepository.findOneBy({ noteId: note.id });
			if (linked?.eventId !== event.id) throw new CalendarEventNoteAlreadyLinkedError();
		}

		return event;
	}

	/**
	 * ノートとイベントの紐づけを外す。ノートの作成者、イベントの作成者、モデレーター以上ができる。
	 * 外す権限が無い人には、見る権限の無いノートの紐づけの有無が分からないよう、紐づいていないときと同じエラーを返す
	 * @throws CalendarEventNoteNotLinkedError ノートがどのイベントにも紐づいていない、または外す権限が無い
	 */
	@bindThis
	public async unlinkNote(note: Pick<MiNote, 'id'>, me: Me): Promise<void> {
		const link = await this.calendarEventNotesRepository.findOneBy({ noteId: note.id });
		if (link == null) throw new CalendarEventNoteNotLinkedError();

		if (link.userId !== me.id) {
			const event = await this.calendarEventsRepository.findOneBy({ id: link.eventId });
			// 紐づけがあればイベントもある (イベントを消すと紐づけも消える)
			if (event == null || !await this.canManage(event, me)) throw new CalendarEventNoteNotLinkedError();
		}

		await this.calendarEventNotesRepository.delete({ id: link.id });
	}

	/**
	 * イベントに紐づいたノートの ID を新しい順に返す (イベントのノート一覧用)。
	 * ノートの公開範囲は見ていないので、表示するときに確かめる
	 */
	@bindThis
	public async getLinkedNoteIds(event: Pick<MiCalendarEvent, 'id'>, opts: { untilId?: MiNote['id']; limit: number }): Promise<MiNote['id'][]> {
		const links = await this.calendarEventNotesRepository.find({
			where: {
				eventId: event.id,
				...(opts.untilId != null ? { noteId: LessThan(opts.untilId) } : {}),
			},
			order: { noteId: 'DESC' },
			take: opts.limit,
			select: { noteId: true },
		});
		return links.map(l => l.noteId);
	}

	/** ノートが紐づいているイベントの ID。紐づいていなければ null */
	@bindThis
	public async getEventIdOfNote(noteId: MiNote['id']): Promise<MiCalendarEvent['id'] | null> {
		const link = await this.calendarEventNotesRepository.findOne({
			where: { noteId },
			select: { eventId: true },
		});
		return link?.eventId ?? null;
	}

	/**
	 * ノートごとに紐づいているイベントをまとめて引く (ノートの表示用)。紐づいていないノートは含まない
	 */
	@bindThis
	public async getEventsOfNotes(noteIds: MiNote['id'][]): Promise<Map<MiNote['id'], MiCalendarEvent>> {
		const result = new Map<MiNote['id'], MiCalendarEvent>();
		if (noteIds.length === 0) return result;

		const links = await this.calendarEventNotesRepository.find({
			where: { noteId: In(noteIds) },
			select: { noteId: true, eventId: true },
		});
		if (links.length === 0) return result;

		const events = await this.calendarEventsRepository.findBy({ id: In([...new Set(links.map(l => l.eventId))]) });
		const eventsById = new Map(events.map(e => [e.id, e]));
		for (const link of links) {
			const event = eventsById.get(link.eventId);
			if (event != null) result.set(link.noteId, event);
		}
		return result;
	}

	//#endregion

	//#region 取得

	@bindThis
	public async findById(id: MiCalendarEvent['id']): Promise<MiCalendarEvent | null> {
		return await this.calendarEventsRepository.findOneBy({ id });
	}

	/**
	 * @throws CalendarEventNotFoundError イベントが存在しない
	 */
	@bindThis
	public async findByIdOrFail(id: MiCalendarEvent['id']): Promise<MiCalendarEvent> {
		const event = await this.findById(id);
		if (event == null) throw new CalendarEventNotFoundError();
		return event;
	}

	/**
	 * me が見られるイベントを引く。公開範囲の外なら、存在しないときと同じエラーにする
	 * @param opts.moderatorView モデレーター以上なら公開範囲の外のイベントも引く (管理人ビューと、管理の操作)
	 * @throws CalendarEventNotFoundError イベントが存在しない、または公開範囲の外
	 */
	@bindThis
	public async findVisibleByIdOrFail(id: MiCalendarEvent['id'], me: Me | null | undefined, opts?: CalendarViewOptions): Promise<MiCalendarEvent> {
		const event = await this.findByIdOrFail(id);
		if (!await this.canView(event, me, opts)) throw new CalendarEventNotFoundError();
		return event;
	}

	/**
	 * me がイベントを見られるか (作成者は常に見られる。モデレーター以上は moderatorView のときだけ公開範囲に関係なく見られる)
	 */
	@bindThis
	public async canView(event: MiCalendarEvent, me: Me | null | undefined, opts?: CalendarViewOptions): Promise<boolean> {
		return await this.calendarVisibilityService.canView(event, me, opts);
	}

	/**
	 * me が since 以降に作ったイベントの作成日時を新しい順に最大 limit 件返す (作成数の上限の確認用)。
	 * 作成日時は id から求める
	 */
	@bindThis
	public async getCreatedDatesSince(me: Me, since: Date, limit: number): Promise<Date[]> {
		const events = await this.calendarEventsRepository.find({
			where: { userId: me.id, id: MoreThanOrEqual(this.idService.gen(since.getTime())) },
			select: { id: true },
			order: { id: 'DESC' },
			take: limit,
		});
		return events.map(e => this.idService.parse(e.id).date);
	}

	/** id の順に関係なく、指定したイベントをまとめて引く (無いものは含まない) */
	@bindThis
	public async findByIds(ids: MiCalendarEvent['id'][]): Promise<MiCalendarEvent[]> {
		if (ids.length === 0) return [];
		return await this.calendarEventsRepository.findBy({ id: In(ids) });
	}

	/**
	 * 開始日時が from 以上 to 未満の、me が見られるイベントを開始日時順に返す (中止したものを含む)。
	 * 月の表示では getJstMonthRange の範囲を渡す
	 */
	@bindThis
	public async listInRange(from: Date, to: Date, filter: CalendarEventFilter, me: Me, opts?: CalendarViewOptions): Promise<MiCalendarEvent[]> {
		const where: FindOptionsWhere<MiCalendarEvent> = {
			startsAt: And(MoreThanOrEqual(from), LessThan(to)),
		};
		if (filter === 'mine') where.userId = me.id;

		const events = await this.calendarVisibilityService.filterVisible(await this.calendarEventsRepository.find({
			where,
			order: { startsAt: 'ASC', id: 'ASC' },
		}), me, opts);
		if (filter !== 'subscribed') return events;

		// 範囲内のイベントは多くないので、購読の有無はまとめて引いて絞り込む
		const subscribed = await this.getSubscribedEventIds(me, events.map(e => e.id));
		return events.filter(e => subscribed.has(e.id));
	}

	/**
	 * me が見られる、これからのイベントを開始日時順に返す (ウィジェット用)。中止したものは含まない。
	 * 終日のイベントは当日中、終了時刻のあるイベントは終了まで、終了時刻の無いイベントは開始までを「これから」とする
	 */
	@bindThis
	public async listUpcoming(me: Me, limit: number, filter: CalendarEventFilter = 'all'): Promise<MiCalendarEvent[]> {
		const now = new Date();
		const query = this.calendarEventsRepository.createQueryBuilder('event')
			// イベントは日をまたがないので、これからのイベントは必ず今日以降に始まる (startsAt の索引を使うための条件)
			.where('event.startsAt >= :todayStart', { todayStart: startOfJstDay(now) })
			.andWhere('event.canceledAt IS NULL')
			.andWhere('(event.isAllDay = TRUE OR COALESCE(event.endsAt, event.startsAt) >= :now)', { now })
			.orderBy('event.startsAt', 'ASC')
			.addOrderBy('event.id', 'ASC')
			.limit(limit);

		if (filter === 'mine') {
			query.andWhere('event.userId = :meId', { meId: me.id });
		} else if (filter === 'subscribed') {
			query.innerJoin(MiCalendarEventSubscription, 'subscription', 'subscription.eventId = event.id AND subscription.userId = :meId', { meId: me.id });
		}
		this.calendarVisibilityService.applyVisibleFilter(query, 'event', me);

		return await query.getMany();
	}

	//#endregion
}
