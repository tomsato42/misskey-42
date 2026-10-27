/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { IsNull } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { UserProfilesRepository, UserSecurityKeysRepository, UsersRepository } from '@/models/_.js';
import type { MiLocalUser } from '@/models/User.js';
import { SignupService } from '@/core/SignupService.js';
import { WebAuthnService } from '@/core/WebAuthnService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { IntraApiService } from './IntraApiService.js';
import { IntraAuthError, IntraAuthService } from './IntraAuthService.js';
import { isEligible } from './intra-user.js';
import {
	INTRA_PASSKEY_SETUP_TTL_SEC,
	buildIntraManualUsername,
	buildIntraPasskeySetupUrl,
	generateIntraToken,
	isIntraToken,
	isSignupConflictError,
} from './intra-auth.js';
import type { IntraUser } from './intra-user.js';
import type { PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

export const intraAccountFailureReasons = [
	/** 42 の API に問い合わせられなかった */
	'intra_error',
	/** そのログイン名の 42 のユーザーがいない */
	'not_found',
	/** 42cursus の在籍記録が無い (スタッフでもない) */
	'not_eligible',
	'suspended',
	'username_taken',
] as const;

export type IntraAccountFailureReason = typeof intraAccountFailureReasons[number];

export class IntraAccountError extends Error {
	constructor(public reason: IntraAccountFailureReason, message: string) {
		super(message);
	}
}

export type IntraAccountResult = {
	user: MiLocalUser;
	/** このときに作ったアカウントか */
	created: boolean;
	/** 42 のユーザーに結び付いたアカウントか */
	linked: boolean;
};

/**
 * 42 にログインできない人 (ブラックホールなど) のために、管理者がアカウントを用意し、パスキーの登録リンクを発行する
 */
@Injectable()
export class IntraAccountService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.userSecurityKeysRepository)
		private userSecurityKeysRepository: UserSecurityKeysRepository,

		private intraApiService: IntraApiService,
		private intraAuthService: IntraAuthService,
		private signupService: SignupService,
		private webAuthnService: WebAuthnService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('intra-account');
	}

	/**
	 * 42 のログイン名から、その人のアカウントを返す。無ければ作る。
	 * 42 の API で在籍記録を確かめる。manuallyVerified なら、確かめられなくても (管理者が別の方法で確かめたものとして) 作る。
	 * そのときに 42 のユーザーが取れていれば 42 ID を結び付け、取れなければ結び付けずにパスキーでログインできるアカウントにする
	 */
	@bindThis
	public async findOrCreateAccount(login: string, manuallyVerified: boolean): Promise<IntraAccountResult> {
		let intraUser: IntraUser | null;
		try {
			intraUser = await this.intraApiService.getUserByLogin(login);
		} catch (err) {
			if (!manuallyVerified) {
				throw new IntraAccountError('intra_error', `failed to fetch intra user ${login}: ${err instanceof Error ? err.message : String(err)}`);
			}
			intraUser = null;
		}

		if (intraUser == null) {
			if (!manuallyVerified) throw new IntraAccountError('not_found', `intra user ${login} was not found`);
			return await this.createUnlinkedAccount(login);
		}

		if (!manuallyVerified && !isEligible(intraUser, this.config.intra!.cursusId)) {
			throw new IntraAccountError('not_eligible', `intra user ${login} is not eligible`);
		}

		try {
			const { user, created } = await this.intraAuthService.findOrCreateUser(intraUser);
			return { user, created, linked: true };
		} catch (err) {
			if (err instanceof IntraAuthError) {
				throw new IntraAccountError(err.reason === 'suspended' || err.reason === 'username_taken' ? err.reason : 'intra_error', err.message);
			}
			throw err;
		}
	}

	/**
	 * 42 のユーザーに結び付けずにアカウントを作る。42 で本人確認できないので、パスワード・パスキーのログインの例外フラグを付ける
	 */
	@bindThis
	private async createUnlinkedAccount(login: string): Promise<IntraAccountResult> {
		const username = buildIntraManualUsername(login);

		let user: MiLocalUser;
		try {
			const { account } = await this.signupService.signup({ username, password: null });
			user = account as MiLocalUser;
		} catch (err) {
			if (isSignupConflictError(err)) {
				throw new IntraAccountError('username_taken', `username ${username} is already taken`);
			}
			throw err;
		}

		await this.userProfilesRepository.update({ userId: user.id }, { intraPasswordLoginAllowed: true });
		this.logger.info(`Created user ${user.id} (@${username}) without linking to intra (${login})`);
		return { user, created: true, linked: false };
	}

	/**
	 * パスキーの登録リンクを発行する。リンクを開いた人は、そのアカウントにパスキーを登録してログインできる
	 */
	@bindThis
	public async issuePasskeySetup(userId: MiLocalUser['id']): Promise<{ url: string; expiresAt: Date }> {
		// 前に出したリンクは使えなくする (渡し間違えたときに出し直せば済むように)
		const previous = await this.redisClient.get(`intra:passkey-setup-user:${userId}`);
		if (previous != null) await this.redisClient.del(`intra:passkey-setup:${previous}`);

		const token = generateIntraToken();
		await this.redisClient.set(`intra:passkey-setup:${token}`, userId, 'EX', INTRA_PASSKEY_SETUP_TTL_SEC);
		await this.redisClient.set(`intra:passkey-setup-user:${userId}`, token, 'EX', INTRA_PASSKEY_SETUP_TTL_SEC);
		return {
			url: buildIntraPasskeySetupUrl(this.config.url, token),
			expiresAt: new Date(Date.now() + INTRA_PASSKEY_SETUP_TTL_SEC * 1000),
		};
	}

	/**
	 * 登録リンクのユーザーを返す。無効なリンク・凍結や削除されたユーザーなら null
	 */
	@bindThis
	private async findSetupUser(token: unknown): Promise<MiLocalUser | null> {
		if (!isIntraToken(token)) return null;
		const userId = await this.redisClient.get(`intra:passkey-setup:${token}`);
		if (userId == null) return null;

		const user = await this.usersRepository.findOneBy({ id: userId, host: IsNull() }) as MiLocalUser | null;
		if (user == null || user.isSuspended || user.isDeleted) return null;
		return user;
	}

	/**
	 * 登録リンクからパスキーの登録を始める。無効なリンクなら null
	 */
	@bindThis
	public async beginPasskeySetup(token: unknown): Promise<{ username: string; options: PublicKeyCredentialCreationOptionsJSON } | null> {
		const user = await this.findSetupUser(token);
		if (user == null) return null;

		const options = await this.webAuthnService.initiateRegistration(user.id, user.username, user.name ?? undefined);
		return { username: user.username, options };
	}

	/**
	 * 登録リンクからパスキーを登録し、ログインさせるユーザーを返す。無効なリンクなら null。リンクは使い捨て
	 */
	@bindThis
	public async completePasskeySetup(token: unknown, name: string, credential: RegistrationResponseJSON): Promise<MiLocalUser | null> {
		const user = await this.findSetupUser(token);
		if (user == null) return null;

		const keyInfo = await this.webAuthnService.verifyRegistration(user.id, credential);

		// 同じリンクで 2 回登録されないよう、登録の前に消費する
		if (await this.redisClient.getdel(`intra:passkey-setup:${token}`) == null) return null;
		await this.redisClient.del(`intra:passkey-setup-user:${user.id}`);

		await this.userSecurityKeysRepository.insert({
			id: keyInfo.credentialID,
			userId: user.id,
			name,
			publicKey: Buffer.from(keyInfo.credentialPublicKey).toString('base64url'),
			counter: keyInfo.counter,
			credentialDeviceType: keyInfo.credentialDeviceType,
			credentialBackedUp: keyInfo.credentialBackedUp,
			transports: keyInfo.transports,
		});

		// パスワードを持たないので、パスキーはパスワードレスログインにしか使えない
		await this.userProfilesRepository.update({ userId: user.id }, { usePasswordLessLogin: true });

		this.logger.info(`Registered a passkey for user ${user.id} with a setup link`);
		return user;
	}
}
