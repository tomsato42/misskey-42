/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiNote } from './Note.js';
import { MiUserList } from './UserList.js';
import type { CalendarEventVisibility } from '@/core/calendar/calendar-visibility.js';

/**
 * user_profile.calendarNotificationSettings の形。
 * week: 1週間前、day: 前日、today: 当日、changes: 日時の変更・中止、invited: イベントへの招待
 */
export type CalendarNotificationSettings = {
	week: boolean;
	day: boolean;
	today: boolean;
	changes: boolean;
	invited: boolean;
};

export const DEFAULT_CALENDAR_NOTIFICATION_SETTINGS: Readonly<CalendarNotificationSettings> = {
	week: true,
	day: true,
	today: true,
	changes: true,
	invited: true,
};

/**
 * カレンダーのイベント。日時は日本時間で入力されたものを timestamptz で保存する。
 * 作成日時は id から求める
 */
@Entity('calendar_event')
export class MiCalendarEvent {
	@PrimaryColumn(id())
	public id: string;

	/**
	 * 作成者
	 */
	@Index()
	@Column(id())
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	@Column('varchar', {
		length: 128,
	})
	public title: string;

	/**
	 * 開始日時。終日のときは日本時間のその日の 0:00
	 */
	@Index()
	@Column('timestamp with time zone')
	public startsAt: Date;

	/**
	 * 終了日時。開始と同じ日本時間の日付の中だけ。終日のときと終了時刻が無いときは null
	 */
	@Column('timestamp with time zone', {
		nullable: true,
	})
	public endsAt: Date | null;

	@Column('boolean', {
		default: false,
	})
	public isAllDay: boolean;

	@Column('varchar', {
		length: 256, nullable: true,
	})
	public location: string | null;

	/**
	 * 説明 (MFM)
	 */
	@Column('text', {
		nullable: true,
	})
	public description: string | null;

	/**
	 * 先頭の # を除き、normalizeForSearch で正規化したハッシュタグ
	 */
	@Column('varchar', {
		length: 128, nullable: true,
	})
	public hashtag: string | null;

	/**
	 * 公開範囲 (core/calendar/calendar-visibility.ts)
	 */
	@Column('varchar', {
		length: 16, default: 'public',
	})
	public visibility: CalendarEventVisibility;

	/**
	 * 公開範囲が specified のときに見られるユーザー (作成者を除く)
	 */
	@Column({
		...id(),
		array: true, default: '{}',
	})
	public visibleUserIds: MiUser['id'][];

	/**
	 * 公開範囲が list のときのリスト (作成者のもの)。リストが消えると null になり、作成者 (とモデレーター) だけが見られる
	 */
	@Column({
		...id(),
		nullable: true,
	})
	public userListId: MiUserList['id'] | null;

	@ManyToOne(() => MiUserList, {
		onDelete: 'SET NULL',
	})
	@JoinColumn()
	public userList: MiUserList | null;

	/**
	 * イベントを作るときに一緒に投稿した告知のノート。ノートが消えてもイベントは残す
	 */
	@Index()
	@Column({
		...id(),
		nullable: true,
	})
	public announcementNoteId: MiNote['id'] | null;

	@ManyToOne(() => MiNote, {
		onDelete: 'SET NULL',
	})
	@JoinColumn()
	public announcementNote: MiNote | null;

	/**
	 * 中止した日時。中止していなければ null
	 */
	@Column('timestamp with time zone', {
		nullable: true,
	})
	public canceledAt: Date | null;

	/**
	 * 最後に編集 (中止を含む) した日時
	 */
	@Column('timestamp with time zone', {
		nullable: true,
	})
	public updatedAt: Date | null;
}
