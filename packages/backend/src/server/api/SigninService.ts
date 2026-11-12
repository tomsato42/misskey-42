/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Misskey from 'misskey-js';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { SigninsRepository, UserProfilesRepository } from '@/models/_.js';
import { IdService } from '@/core/IdService.js';
import type { MiLocalUser } from '@/models/User.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { SigninEntityService } from '@/core/entities/SigninEntityService.js';
import { bindThis } from '@/decorators.js';
import { EmailService } from '@/core/EmailService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { buildMediaGateCookie, issueMediaGateToken, nowUnixSec } from '@/core/media-gate/media-gate.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

@Injectable()
export class SigninService {
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.signinsRepository)
		private signinsRepository: SigninsRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private signinEntityService: SigninEntityService,
		private emailService: EmailService,
		private notificationService: NotificationService,
		private idService: IdService,
		private globalEventService: GlobalEventService,
	) {
	}

	@bindThis
	public signin(request: FastifyRequest, reply: FastifyReply, user: MiLocalUser) {
		setImmediate(async () => {
			this.notificationService.createNotification(user.id, 'login', {});

			const record = await this.signinsRepository.insertOne({
				id: this.idService.gen(),
				userId: user.id,
				ip: request.ip,
				headers: request.headers as any,
				success: true,
			});

			this.globalEventService.publishMainStream(user.id, 'signin', await this.signinEntityService.pack(record));

			const profile = await this.userProfilesRepository.findOneByOrFail({ userId: user.id });
			if (profile.email && profile.emailVerified) {
				this.emailService.sendEmail(profile.email, 'New login / ログインがありました',
					'There is a new login. If you do not recognize this login, update the security status of your account, including changing your password. / 新しいログインがありました。このログインに心当たりがない場合は、パスワードを変更するなど、アカウントのセキュリティ状態を更新してください。',
					'There is a new login. If you do not recognize this login, update the security status of your account, including changing your password. / 新しいログインがありました。このログインに心当たりがない場合は、パスワードを変更するなど、アカウントのセキュリティ状態を更新してください。');
			}
		});

		// mediaGate が有効なら、画像・添付ファイルを見るための Cookie も発行する。
		// Set-Cookie は既に設定されたものに追記される (intra の exchange はログイン用コードの Cookie を消す指定をしている)
		if (this.config.mediaGate != null) {
			const { token } = issueMediaGateToken(this.config.mediaGate, user.id, nowUnixSec());
			reply.header('Set-Cookie', buildMediaGateCookie(this.config.mediaGate.cookieName, token, this.config.mediaGate.ttlSec, this.config.url.startsWith('https://')));
		}

		reply.code(200);
		return {
			finished: true,
			id: user.id,
			i: user.token!,
		} satisfies Misskey.entities.SigninFlowResponse;
	}
}

