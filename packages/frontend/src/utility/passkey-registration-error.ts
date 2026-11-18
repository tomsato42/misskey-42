/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { i18n } from '@/i18n.js';

/**
 * ブラウザがパスキーの作成 (navigator.credentials.create) に失敗した理由。
 * - canceled: キャンセル・時間切れ・タップの直後でない・アプリ内ブラウザで使えないなど。ブラウザはこれらを区別させない (NotAllowedError)
 * - alreadyRegistered: この端末 (パスワードマネージャー) にこのアカウントのパスキーがもうある
 * - unsupported: 端末・セキュリティキーが求める条件 (本人確認・端末に保存できるパスキー・アルゴリズム) を満たさない
 * - other: そのほか
 */
export type PasskeyRegistrationErrorKind = 'canceled' | 'alreadyRegistered' | 'unsupported' | 'other';

/**
 * startRegistration (@simplewebauthn/browser) が投げたエラーを分類する。
 * WebAuthnError の name は元の DOMException の name なので、name で見る
 */
export function classifyPasskeyRegistrationError(err: unknown): PasskeyRegistrationErrorKind {
	// DOMException が Error を継承しない環境もあるので、name を持つかで見る
	const name = typeof err === 'object' && err != null && 'name' in err ? err.name : null;
	switch (name) {
		case 'NotAllowedError':
		case 'AbortError':
			return 'canceled';
		case 'InvalidStateError':
			return 'alreadyRegistered';
		case 'ConstraintError':
		case 'NotSupportedError':
			return 'unsupported';
		default:
			return 'other';
	}
}

/**
 * パスキーの作成に失敗したときに出す文
 */
export function getPasskeyRegistrationErrorMessage(err: unknown): string {
	switch (classifyPasskeyRegistrationError(err)) {
		case 'canceled':
			return i18n.ts._intra.passkeyCreateCanceled;
		case 'alreadyRegistered':
			return i18n.ts._intra.passkeyAlreadyRegistered;
		case 'unsupported':
			return i18n.ts._intra.passkeyAuthenticatorUnsupported;
		default:
			return i18n.tsx._intra.passkeyCreateError({ message: typeof err === 'object' && err != null && 'message' in err ? String(err.message) : String(err) });
	}
}
