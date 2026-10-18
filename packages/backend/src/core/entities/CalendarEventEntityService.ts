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
import { formatJstDate, formatJstTime } from '@/core/calendar/calendar-time.js';
import { UserEntityService } from './UserEntityService.js';

type Me = { id: MiUser['id'] } | null | undefined;

/**
 * イベントを API の返り値の形にする。
 * 購読者数・購読状態・編集できるかは、まとめて引いた値をヒントで渡せる (渡さなければ 1 件ずつ引く)
 */
@Injectable()
export class CalendarEventEntityService {
	constructor(
		private userEntityService: UserEntityService,
		private calendarEventService: CalendarEventService,
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
			isCanceled: event.canceledAt != null,
			subscribersCount,
			...(isSubscribed !== undefined ? { isSubscribed } : {}),
		};
	}

	@bindThis
	public async pack(
		src: MiCalendarEvent['id'] | MiCalendarEvent,
		me?: Me,
		hint?: {
			packedUser?: Packed<'UserLite'>;
			subscribersCount?: number;
			isSubscribed?: boolean;
			canManage?: boolean;
		},
	): Promise<Packed<'CalendarEvent'>> {
		const event = typeof src === 'object' ? src : await this.calendarEventService.findByIdOrFail(src);

		const [user, subscribersCount, isSubscribed, canManage] = await Promise.all([
			hint?.packedUser ?? this.userEntityService.pack(event.user ?? event.userId, me),
			hint?.subscribersCount ?? this.calendarEventService.countSubscribers(event),
			me == null ? undefined : (hint?.isSubscribed ?? this.calendarEventService.isSubscribed(event, me)),
			me == null ? undefined : (hint?.canManage ?? this.calendarEventService.canManage(event, me)),
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
		};
	}

	/**
	 * 作成者・購読者数・購読状態・編集できるかをまとめて引いて pack する
	 */
	@bindThis
	public async packMany(events: MiCalendarEvent[], me?: Me): Promise<Packed<'CalendarEvent'>[]> {
		if (events.length === 0) return [];
		const eventIds = events.map(e => e.id);

		const [packedUsers, counts, subscribed, canManage] = await Promise.all([
			this.userEntityService.packMany(events.map(e => e.user ?? e.userId), me)
				.then(users => new Map(users.map(u => [u.id, u]))),
			this.calendarEventService.countSubscribersOfEvents(eventIds),
			me == null ? null : this.calendarEventService.getSubscribedEventIds(me, eventIds),
			me == null ? null : this.calendarEventService.createManageChecker(me, events),
		]);

		return await Promise.all(events.map(event => this.pack(event, me, {
			packedUser: packedUsers.get(event.userId),
			subscribersCount: counts.get(event.id) ?? 0,
			isSubscribed: subscribed?.has(event.id),
			canManage: canManage?.(event),
		})));
	}

	/**
	 * ノートごとに、紐づいているイベントの軽量版を返す (ノートの表示用)。
	 * 渡したノートはすべて Map に入り、紐づいていないノートは null。
	 * 紐づいたノートが無ければクエリは 1 回だけで済む
	 */
	@bindThis
	public async packLiteManyByNoteIds(noteIds: MiNote['id'][], me?: Me): Promise<Map<MiNote['id'], Packed<'CalendarEventLite'> | null>> {
		const result = new Map<MiNote['id'], Packed<'CalendarEventLite'> | null>(noteIds.map(id => [id, null]));
		if (noteIds.length === 0) return result;

		const eventsOfNotes = await this.calendarEventService.getEventsOfNotes([...new Set(noteIds)]);
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
