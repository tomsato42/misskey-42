/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiCalendarEvent } from './CalendarEvent.js';

/**
 * カレンダーのイベントの購読。イベントの作成者は必ず購読している
 */
@Entity('calendar_event_subscription')
@Index(['eventId', 'userId'], { unique: true })
export class MiCalendarEventSubscription {
	@PrimaryColumn(id())
	public id: string;

	@Column(id())
	public eventId: MiCalendarEvent['id'];

	@ManyToOne(() => MiCalendarEvent, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public event: MiCalendarEvent | null;

	@Index()
	@Column(id())
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;
}
