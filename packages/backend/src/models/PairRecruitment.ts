/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiNote } from './Note.js';
import { MiChatRoom } from './ChatRoom.js';
import type { PairClosedReason, PairRecruitmentStatus, PairStartTiming } from '@/core/pair/pair-recruitment.js';

/** 募集にまとめた課題の 1 つ (作成時・編集時の値) */
export type PairRecruitmentProjectEntry = {
	slug: string;
	name: string;
	/** その課題のグループの人数の下限 (ルールが無ければ 2) */
	minGroupSize: number;
	maxGroupSize: number;
};

/**
 * 42 の課題のペア募集。募集はキャンパス単位で、作成者のキャンパスの課題 (intra_project) から 1 つ以上選ぶ。
 * intra_project の行は課題が登録できなくなると消えるため、外部キーにはせず、課題の名前と人数を作成時の値で持つ
 */
@Entity('pair_recruitment')
@Index(['campusId', 'projectSlug'])
@Index(['status', 'expiresAt'])
@Index('IDX_PAIR_RECRUITMENT_PROJECT_SLUGS', { synchronize: false }) // GIN for projectSlugs
export class MiPairRecruitment {
	@PrimaryColumn(id())
	public id: string;

	/** 作成者 */
	@Index()
	@Column({
		...id(),
	})
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	/** 作成者の主キャンパスの intra のキャンパス ID (作成時の値) */
	@Column('integer')
	public campusId: number;

	/** 最初の課題の slug */
	@Column('varchar', {
		length: 128,
	})
	public projectSlug: string;

	/** 募集の表示名 (課題の名前を / でつないだもの) */
	@Column('varchar', {
		length: 256,
	})
	public projectName: string;

	/** まとめた課題のどれでも組める人数の下限 */
	@Column('integer')
	public minGroupSize: number;

	/** まとめた課題のどれでも組める人数の上限 */
	@Column('integer')
	public maxGroupSize: number;

	/** まとめた課題 (並び順どおり) */
	@Column('jsonb', {
		default: [],
	})
	public projects: PairRecruitmentProjectEntry[];

	/** まとめた課題の slug (課題での絞り込み用) */
	@Column('varchar', {
		length: 128, array: true, default: '{}',
	})
	public projectSlugs: string[];

	/** 作成者を含むチームの人数 */
	@Column('integer')
	public teamSize: number;

	/** 始める時期 */
	@Column('varchar', {
		length: 16,
	})
	public startTiming: PairStartTiming;

	/** 始める日 (startTiming が date のときだけ。YYYY-MM-DD) */
	@Column('date', {
		nullable: true,
	})
	public startDate: string | null;

	/** ひとこと */
	@Column('varchar', {
		length: 512, nullable: true,
	})
	public comment: string | null;

	/** open: 募集中、closed: 締め切った。open でも expiresAt を過ぎていれば締め切ったものとして扱う */
	@Column('varchar', {
		length: 16, default: 'open',
	})
	public status: PairRecruitmentStatus;

	/** 締め切った理由 */
	@Column('varchar', {
		length: 16, nullable: true,
	})
	public closedReason: PairClosedReason | null;

	/** 承認したメンバーの人数 (作成者を含まない) */
	@Column('integer', {
		default: 0,
	})
	public acceptedCount: number;

	/** タイムラインに告知したノート */
	@Column({
		...id(),
		nullable: true,
	})
	public noteId: MiNote['id'] | null;

	@ManyToOne(() => MiNote, {
		onDelete: 'SET NULL',
	})
	@JoinColumn()
	public note: MiNote | null;

	/** チーム候補で話すチャットルーム (初めて開いたときに作る) */
	@Column({
		...id(),
		nullable: true,
	})
	public chatRoomId: MiChatRoom['id'] | null;

	@ManyToOne(() => MiChatRoom, {
		onDelete: 'SET NULL',
	})
	@JoinColumn()
	public chatRoom: MiChatRoom | null;

	/** 自動で締め切る日時 */
	@Column('timestamp with time zone')
	public expiresAt: Date;

	@Column('timestamp with time zone', {
		nullable: true,
	})
	public closedAt: Date | null;
}
