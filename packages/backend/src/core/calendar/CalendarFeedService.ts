/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { CalendarEventsRepository, MiMeta, UserProfilesRepository } from '@/models/_.js';
import type { MiUser } from '@/models/User.js';
import { MiCalendarEventSubscription } from '@/models/CalendarEventSubscription.js';
import { IdService } from '@/core/IdService.js';
import { CacheService } from '@/core/CacheService.js';
import { isDuplicateKeyValueError } from '@/misc/is-duplicate-key-value-error.js';
import { bindThis } from '@/decorators.js';
import { buildICalendar } from './calendar-ical.js';

/**
 * subscribed: 購読しているイベント (自分が作成したものを含む)、all: すべてのイベント
 */
export const calendarFeedKinds = ['subscribed', 'all'] as const;
export type CalendarFeedKind = typeof calendarFeedKinds[number];

/** 鍵の元にする乱数のバイト数。base64url で 43 文字になる (列は varchar(64)) */
const FEED_TOKEN_BYTES = 32;

const FEED_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 配信する範囲: 過去30日 〜 これから365日 (開始日時) */
export const CALENDAR_FEED_PAST_MS = 30 * DAY_MS;
export const CALENDAR_FEED_FUTURE_MS = 365 * DAY_MS;

/** 配信するイベントの数の上限 (開始が早い順) */
export const CALENDAR_FEED_MAX_EVENTS = 2000;

export type CalendarFeedUrls = {
	subscribedUrl: string;
	allUrl: string;
};

/** カレンダー配信の鍵を新しく作る (暗号学的に安全な乱数 32 バイトの base64url) */
export function generateCalendarFeedToken(): string {
	return randomBytes(FEED_TOKEN_BYTES).toString('base64url');
}

/** generateCalendarFeedToken で作った形か (DB を引く前に形の違うものを弾く) */
export function isValidCalendarFeedToken(token: string): boolean {
	return FEED_TOKEN_PATTERN.test(token);
}

/**
 * カレンダー配信 (iCalendar) の鍵の管理と、配信する中身を作る
 */
@Injectable()
export class CalendarFeedService {
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.calendarEventsRepository)
		private calendarEventsRepository: CalendarEventsRepository,

		private idService: IdService,
		private cacheService: CacheService,
	) {
	}

	//#region 鍵

	@bindThis
	public buildUrls(token: string): CalendarFeedUrls {
		return {
			subscribedUrl: `${this.config.url}/calendar/feed/subscribed/${token}.ics`,
			allUrl: `${this.config.url}/calendar/feed/all/${token}.ics`,
		};
	}

	/**
	 * 配信の鍵を返す。まだ無ければ作って保存する
	 */
	@bindThis
	public async getOrCreateToken(userId: MiUser['id']): Promise<string> {
		const profile = await this.userProfilesRepository.findOne({ where: { userId }, select: { userId: true, calendarFeedToken: true } });
		if (profile?.calendarFeedToken != null) return profile.calendarFeedToken;

		const token = generateCalendarFeedToken();
		// 同時に呼ばれたときに上書きし合わないよう、まだ鍵が無いときだけ保存する
		const result = await this.saveToken(userId, token, true);
		if (result) return token;

		const latest = await this.userProfilesRepository.findOneOrFail({ where: { userId }, select: { userId: true, calendarFeedToken: true } });
		if (latest.calendarFeedToken == null) throw new Error('Failed to create calendar feed token');
		return latest.calendarFeedToken;
	}

	/**
	 * 配信の鍵を作り直す。古い URL は使えなくなる
	 */
	@bindThis
	public async regenerateToken(userId: MiUser['id']): Promise<string> {
		const token = generateCalendarFeedToken();
		await this.saveToken(userId, token, false);
		return token;
	}

	/**
	 * @param onlyIfEmpty true ならまだ鍵が無いときだけ保存する
	 * @returns 保存したか
	 */
	@bindThis
	private async saveToken(userId: MiUser['id'], token: string, onlyIfEmpty: boolean): Promise<boolean> {
		try {
			const result = await this.userProfilesRepository.update(
				onlyIfEmpty ? { userId, calendarFeedToken: IsNull() } : { userId },
				{ calendarFeedToken: token },
			);
			// 鍵はキャッシュから読まないが、古い値を残さないように消しておく
			await this.cacheService.userProfileCache.delete(userId);
			return (result.affected ?? 0) > 0;
		} catch (err) {
			// 32 バイトの乱数が他の人と重なることは事実上ないが、念のため
			if (isDuplicateKeyValueError(err)) throw new Error('Calendar feed token collision');
			throw err;
		}
	}

	/**
	 * 鍵から配信するユーザーを引く。形の違う鍵、存在しない鍵、凍結・削除済みのユーザーは null
	 */
	@bindThis
	public async findUserByToken(token: string): Promise<Pick<MiUser, 'id'> | null> {
		if (!isValidCalendarFeedToken(token)) return null;

		const profile = await this.userProfilesRepository.createQueryBuilder('profile')
			.innerJoin('profile.user', 'user')
			.select(['profile.userId'])
			.where('profile.calendarFeedToken = :token', { token })
			.andWhere('user.isSuspended = FALSE')
			.andWhere('user.isDeleted = FALSE')
			.andWhere('user.host IS NULL')
			.getOne();

		return profile != null ? { id: profile.userId } : null;
	}

	//#endregion

	//#region 配信

	/**
	 * 配信する iCalendar の文字列を作る
	 */
	@bindThis
	public async buildFeed(user: Pick<MiUser, 'id'>, kind: CalendarFeedKind, now: Date): Promise<string> {
		const query = this.calendarEventsRepository.createQueryBuilder('event')
			.where('event.startsAt >= :from', { from: new Date(now.getTime() - CALENDAR_FEED_PAST_MS) })
			.andWhere('event.startsAt < :to', { to: new Date(now.getTime() + CALENDAR_FEED_FUTURE_MS) })
			.orderBy('event.startsAt', 'ASC')
			.addOrderBy('event.id', 'ASC')
			.limit(CALENDAR_FEED_MAX_EVENTS);

		if (kind === 'subscribed') {
			query.innerJoin(MiCalendarEventSubscription, 'subscription', 'subscription.eventId = event.id AND subscription.userId = :userId', { userId: user.id });
		}

		const events = await query.getMany();
		const instanceName = this.meta.name ?? this.config.host;

		return buildICalendar(events.map(event => ({
			...event,
			createdAt: this.idService.parse(event.id).date,
		})), {
			name: kind === 'subscribed' ? `${instanceName}(購読中)` : `${instanceName}(すべて)`,
			host: this.config.host,
			url: this.config.url,
			now,
		});
	}

	//#endregion
}
