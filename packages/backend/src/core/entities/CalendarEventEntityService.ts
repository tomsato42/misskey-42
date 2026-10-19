/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import type { Packed } from '@/misc/json-schema.js';
import type { MiUser } from '@/models/User.js';
import type { MiNote } from '@/models/Note.js';
import type { MiCalendarEvent } from '@/models/CalendarEvent.js';
import { bindThis } from '@/decorators.js';
import { IdService } from '@/core/IdService.js';
import { CalendarEventService } from '@/core/calendar/CalendarEventService.js';
import { CalendarInvitationService } from '@/core/calendar/CalendarInvitationService.js';
import { CalendarVisibilityService } from '@/core/calendar/CalendarVisibilityService.js';
import { formatJstDate, formatJstTime } from '@/core/calendar/calendar-time.js';
import { UserEntityService } from './UserEntityService.js';

type Me = { id: MiUser['id'] } | null | undefined;

/** イベントのページで、購読者のアバターに並べる人数 */
const SUBSCRIBERS_PREVIEW_LIMIT = 5;

/**
 * イベントを API の返り値の形にする。
 * 購読者数・購読状態・編集できるかは、まとめて引いた値をヒントで渡せる (渡さなければ 1 件ずつ引く)
 */
@Injectable()
export class CalendarEventEntityService {
	constructor(
		private userEntityService: UserEntityService,
		private calendarEventService: CalendarEventService,
		private calendarInvitationService: CalendarInvitationService,
		private calendarVisibilityService: CalendarVisibilityService,
		private idService: IdService,
	) {
	}

	@bindThis
	private packLiteSync(event: MiCalendarEvent, subscribersCount: number, isSubscribed: boolean | undefined): Packed<'CalendarEventLite'> {
		return {
			id: event.id,
			title: event.title,
			date: formatJstDate(event.startsAt),
			startTime: event.isAllDay ? null : formatJstTime(event.startsAt),
			endTime: event.isAllDay || event.endsAt == null ? null : formatJstTime(event.endsAt),
			isAllDay: event.isAllDay,
			startsAt: event.startsAt.toISOString(),
			endsAt: event.endsAt?.toISOString() ?? null,
			location: event.location,
			visibility: event.visibility,
			isCanceled: event.canceledAt != null,
			subscribersCount,
			...(isSubscribed !== undefined ? { isSubscribed } : {}),
		};
	}

	/**
	 * @param opts.detail イベントのページ用の項目 (購読者のアバター・フォローしている購読者の数・招待した人・招待できるか) も付ける
	 * @param opts.moderatorView 管理人ビューで引いたイベント。公開範囲の外か (isOutsideVisibility) も付ける
	 */
	@bindThis
	public async pack(
		src: MiCalendarEvent['id'] | MiCalendarEvent,
		me?: Me,
		hint?: {
			packedUser?: Packed<'UserLite'>;
			subscribersCount?: number;
			isSubscribed?: boolean;
			canManage?: boolean;
			isOutsideVisibility?: boolean;
		},
		opts?: { detail?: boolean; moderatorView?: boolean },
	): Promise<Packed<'CalendarEvent'>> {
		const event = typeof src === 'object' ? src : await this.calendarEventService.findByIdOrFail(src);

		const [user, subscribersCount, isSubscribed, canManage, detail, isOutsideVisibility] = await Promise.all([
			hint?.packedUser ?? this.userEntityService.pack(event.user ?? event.userId, me),
			hint?.subscribersCount ?? this.calendarEventService.countSubscribers(event),
			me == null ? undefined : (hint?.isSubscribed ?? this.calendarEventService.isSubscribed(event, me)),
			me == null ? undefined : (hint?.canManage ?? this.calendarEventService.canManage(event, me)),
			opts?.detail === true && me != null ? this.packDetail(event, me) : undefined,
			opts?.moderatorView === true && me != null
				? (hint?.isOutsideVisibility ?? this.calendarVisibilityService.canView(event, me).then(visible => !visible))
				: undefined,
		]);

		return {
			...this.packLiteSync(event, subscribersCount, isSubscribed),
			createdAt: this.idService.parse(event.id).date.toISOString(),
			updatedAt: event.updatedAt?.toISOString() ?? null,
			userId: event.userId,
			user,
			description: event.description,
			hashtag: event.hashtag,
			canceledAt: event.canceledAt?.toISOString() ?? null,
			announcementNoteId: event.announcementNoteId,
			...(canManage !== undefined ? { canManage } : {}),
			// 指定ユーザーとリストは、管理できる人 (編集する人) にだけ返す
			...(canManage === true ? { visibleUserIds: event.visibleUserIds, userListId: event.userListId } : {}),
			...(detail ?? {}),
			...(isOutsideVisibility !== undefined ? { isOutsideVisibility } : {}),
		};
	}

	@bindThis
	private async packDetail(event: MiCalendarEvent, me: { id: MiUser['id'] }) {
		const [previewIds, followingSubscribersCount, inviterId, canInvite] = await Promise.all([
			this.calendarEventService.getSubscriberPreviewUserIds(event, me, SUBSCRIBERS_PREVIEW_LIMIT),
			this.calendarEventService.countFollowingSubscribers(event, me),
			this.calendarInvitationService.getInviterId(event, me),
			this.calendarInvitationService.canInvite(event, me),
		]);
		const users = await this.userEntityService.packMany([...new Set([...previewIds, ...(inviterId != null ? [inviterId] : [])])], me);
		const usersById = new Map(users.map(u => [u.id, u]));

		return {
			subscribersPreview: previewIds.map(id => usersById.get(id)).filter(u => u != null),
			followingSubscribersCount,
			invitedBy: inviterId != null ? usersById.get(inviterId) ?? null : null,
			canInvite,
		};
	}

	/**
	 * 作成者・購読者数・購読状態・編集できるか (管理人ビューでは公開範囲の外か) をまとめて引いて pack する
	 * @param opts.moderatorView 管理人ビューで引いたイベント。公開範囲の外か (isOutsideVisibility) も付ける
	 */
	@bindThis
	public async packMany(events: MiCalendarEvent[], me?: Me, opts?: { moderatorView?: boolean }): Promise<Packed<'CalendarEvent'>[]> {
		if (events.length === 0) return [];
		const eventIds = events.map(e => e.id);
		const moderatorView = opts?.moderatorView === true && me != null;

		const [packedUsers, counts, subscribed, canManage, visible] = await Promise.all([
			this.userEntityService.packMany(events.map(e => e.user ?? e.userId), me)
				.then(users => new Map(users.map(u => [u.id, u]))),
			this.calendarEventService.countSubscribersOfEvents(eventIds),
			me == null ? null : this.calendarEventService.getSubscribedEventIds(me, eventIds),
			me == null ? null : this.calendarEventService.createManageChecker(me, events),
			// 管理人ビューでなければ見られるものを、公開範囲の内とする
			moderatorView ? this.calendarVisibilityService.filterVisible(events, me).then(list => new Set(list.map(e => e.id))) : null,
		]);

		return await Promise.all(events.map(event => this.pack(event, me, {
			packedUser: packedUsers.get(event.userId),
			subscribersCount: counts.get(event.id) ?? 0,
			isSubscribed: subscribed?.has(event.id),
			canManage: canManage?.(event),
			isOutsideVisibility: visible != null ? !visible.has(event.id) : undefined,
		}, { moderatorView })));
	}

	/**
	 * イベントの ID ごとに軽量版を返す (通知の表示用)。削除されたイベントと、me が公開範囲の外のイベントは Map に入らない
	 * (通知は表示するたびにイベントを引き直すので、あとで見られなくなったイベントの中身を出さない)。
	 * 購読者数と購読状態はまとめて引く
	 */
	@bindThis
	public async packLiteManyByIds(eventIds: MiCalendarEvent['id'][], me?: Me): Promise<Map<MiCalendarEvent['id'], Packed<'CalendarEventLite'>>> {
		const result = new Map<MiCalendarEvent['id'], Packed<'CalendarEventLite'>>();
		const events = await this.calendarVisibilityService.filterVisible(await this.calendarEventService.findByIds([...new Set(eventIds)]), me);
		if (events.length === 0) return result;

		const foundIds = events.map(e => e.id);
		const [counts, subscribed] = await Promise.all([
			this.calendarEventService.countSubscribersOfEvents(foundIds),
			me == null ? null : this.calendarEventService.getSubscribedEventIds(me, foundIds),
		]);

		for (const event of events) {
			result.set(event.id, this.packLiteSync(event, counts.get(event.id) ?? 0, subscribed?.has(event.id)));
		}
		return result;
	}

	/**
	 * ノートごとに、紐づいているイベントの軽量版を返す (ノートの表示用)。
	 * 渡したノートはすべて Map に入り、紐づいていないノートと、me が公開範囲の外のイベントは null。
	 * 紐づいたノートが無ければクエリは 1 回だけで済む
	 */
	@bindThis
	public async packLiteManyByNoteIds(noteIds: MiNote['id'][], me?: Me): Promise<Map<MiNote['id'], Packed<'CalendarEventLite'> | null>> {
		const result = new Map<MiNote['id'], Packed<'CalendarEventLite'> | null>(noteIds.map(id => [id, null]));
		if (noteIds.length === 0) return result;

		const eventsOfNotes = await this.calendarEventService.getEventsOfNotes([...new Set(noteIds)]);
		if (eventsOfNotes.size === 0) return result;

		// 公開範囲の外のイベントは、ノートに付けない (ノートだけを見せる)
		const visibleEvents = new Set((await this.calendarVisibilityService.filterVisible([...new Map([...eventsOfNotes.values()].map(e => [e.id, e])).values()], me)).map(e => e.id));
		for (const [noteId, event] of eventsOfNotes) {
			if (!visibleEvents.has(event.id)) eventsOfNotes.delete(noteId);
		}
		if (eventsOfNotes.size === 0) return result;

		const eventIds = [...new Set([...eventsOfNotes.values()].map(e => e.id))];
		const [counts, subscribed] = await Promise.all([
			this.calendarEventService.countSubscribersOfEvents(eventIds),
			me == null ? null : this.calendarEventService.getSubscribedEventIds(me, eventIds),
		]);

		for (const [noteId, event] of eventsOfNotes) {
			result.set(noteId, this.packLiteSync(event, counts.get(event.id) ?? 0, subscribed?.has(event.id)));
		}
		return result;
	}
}
