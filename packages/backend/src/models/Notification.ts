/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { userExportableEntities } from '@/types.js';
import { MiUser } from './User.js';
import { MiNote } from './Note.js';
import { MiAccessToken } from './AccessToken.js';
import { MiRole } from './Role.js';
import { MiDriveFile } from './DriveFile.js';
import { MiNoteDraft } from './NoteDraft.js';
import type { CalendarEventInvitedNotificationData, CalendarEventReminderNotificationData, CalendarEventUpdatedNotificationData } from '@/core/calendar/calendar-notification.js';
import { MiPairRecruitment } from './PairRecruitment.js';
import type { MiIntraProjectResult } from './IntraProjectResult.js';
import type { PairClosedReason } from '@/core/pair/pair-recruitment.js';

// misskey-js の notificationTypes と同期すべし
export type MiNotification = {
	type: 'note';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	noteId: MiNote['id'];
} | {
	type: 'follow';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
} | {
	type: 'mention';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	noteId: MiNote['id'];
} | {
	type: 'reply';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	noteId: MiNote['id'];
} | {
	type: 'renote';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	noteId: MiNote['id'];
	targetNoteId: MiNote['id'];
} | {
	type: 'quote';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	noteId: MiNote['id'];
} | {
	type: 'reaction';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	noteId: MiNote['id'];
	reaction: string;
} | {
	type: 'pollEnded';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	noteId: MiNote['id'];
} | {
	type: 'scheduledNotePosted';
	id: string;
	createdAt: string;
	noteId: MiNote['id'];
} | {
	type: 'scheduledNotePostFailed';
	id: string;
	createdAt: string;
	noteDraftId: MiNoteDraft['id'];
} | {
	type: 'receiveFollowRequest';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
} | {
	type: 'followRequestAccepted';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	message: string | null;
} | {
	type: 'roleAssigned';
	id: string;
	createdAt: string;
	roleId: MiRole['id'];
} | {
	type: 'chatRoomInvitationReceived';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	invitationId: string;
} | {
	type: 'achievementEarned';
	id: string;
	createdAt: string;
	achievement: string;
} | {
	type: 'exportCompleted';
	id: string;
	createdAt: string;
	exportedEntity: typeof userExportableEntities[number];
	fileId: MiDriveFile['id'];
} | {
	type: 'login';
	id: string;
	createdAt: string;
} | {
	type: 'createToken';
	id: string;
	createdAt: string;
} | {
	type: 'app';
	id: string;
	createdAt: string;

	/**
	 * アプリ通知のbody
	 */
	customBody: string;

	/**
	 * アプリ通知のheader
	 * (省略時はアプリ名で表示されることを期待)
	 */
	customHeader: string | null;

	/**
	 * アプリ通知のicon(URL)
	 * (省略時はアプリアイコンで表示されることを期待)
	 */
	customIcon: string | null;

	/**
	 * アプリ通知のアプリ(のトークン)
	 */
	appAccessTokenId: MiAccessToken['id'] | null;
} | {
	type: 'test';
	id: string;
	createdAt: string;
} | ({
	// 42times: 購読しているカレンダーのイベントのリマインド
	type: 'calendarEventReminder';
	id: string;
	createdAt: string;
} & CalendarEventReminderNotificationData) | ({
	// 42times: 購読しているカレンダーのイベントの日時の変更・中止
	type: 'calendarEventUpdated';
	id: string;
	createdAt: string;
} & CalendarEventUpdatedNotificationData) | ({
	// 42times: イベントに招待された。notifierId は招待した人
	type: 'calendarEventInvited';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
} & CalendarEventInvitedNotificationData) | {
	/** 自分のペア募集に参加希望が届いた。notifierId は参加希望を送った人 */
	type: 'pairJoinRequested';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	pairRecruitmentId: MiPairRecruitment['id'];
	/** 通知を作った時点の課題の slug と名前 (募集が消えても表示できるように持つ) */
	projectSlug: string;
	projectName: string;
} | {
	/** ペア募集への参加希望が承認された。notifierId は募集の作成者 */
	type: 'pairAccepted';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	pairRecruitmentId: MiPairRecruitment['id'];
	projectSlug: string;
	projectName: string;
} | {
	/** ペア募集が締め切られた。作成者自身にも届く (期限切れのとき) ので notifierId は持たない */
	type: 'pairClosed';
	id: string;
	createdAt: string;
	pairRecruitmentId: MiPairRecruitment['id'];
	projectSlug: string;
	projectName: string;
	reason: PairClosedReason;
} | {
	/** ペア募集に招待された。notifierId は募集の作成者 */
	type: 'pairInvited';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	pairRecruitmentId: MiPairRecruitment['id'];
	projectSlug: string;
	projectName: string;
} | {
	/** 募集の作成者が課題を外したので、参加希望が取り下げになった。notifierId は募集の作成者 */
	type: 'pairApplicationCancelled';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	pairRecruitmentId: MiPairRecruitment['id'];
	projectSlug: string;
	projectName: string;
} | {
	/** 42times: 42 intra の課題の結果が出た (合否は問わない) */
	type: 'intraProjectFinished';
	id: string;
	createdAt: string;
	intraProjectResultId: MiIntraProjectResult['id'];
	/** 通知を作った時点の課題の slug・名前・点数・合否 */
	projectSlug: string;
	projectName: string;
	finalMark: number;
	validated: boolean;
} | {
	/** 42times: 自分で頼んだ 42 intra の課題の再取得が終わった */
	type: 'intraProjectsRefreshed';
	id: string;
	createdAt: string;
	/** 42 API から取得できなかった */
	failed: boolean;
} | {
	/** 42times: 42 intra のレベルが上がった */
	type: 'intraLevelUp';
	id: string;
	createdAt: string;
	/** 上がった後のレベル (整数) */
	level: number;
} | {
	/** 42times: 2次元コードを読み込んで登録した。notifier はコードを見せた人 */
	type: 'acquaintanceSuggested';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
};

export type MiGroupedNotification = MiNotification | {
	type: 'reaction:grouped';
	id: string;
	createdAt: string;
	noteId: MiNote['id'];
	reactions: {
		userId: string;
		reaction: string;
	}[];
} | {
	type: 'renote:grouped';
	id: string;
	createdAt: string;
	noteId: MiNote['id'];
	userIds: string[];
};
