/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiCalendarEvent } from './CalendarEvent.js';

/**
 * イベントへの招待。同じ人への招待は、誰が送ったかに関係なく 1 回だけ (最初に送った人を記録する)。
 * 作成日時は id から求める
 */
@Entity('calendar_event_invitation')
@Index(['eventId', 'userId'], { unique: true })
export class MiCalendarEventInvitation {
	@PrimaryColumn(id())
	public id: string;

	@Column(id())
	public eventId: MiCalendarEvent['id'];

	@ManyToOne(() => MiCalendarEvent, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public event: MiCalendarEvent | null;

	/**
	 * 招待された人
	 */
	@Index()
	@Column(id())
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	/**
	 * 招待した人
	 */
	@Index()
	@Column(id())
	public inviterId: MiUser['id'];

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public inviter: MiUser | null;
}
