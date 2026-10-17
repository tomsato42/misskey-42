/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Misskey が発行するメディア用 Cookie のトークンを検証する。
// packages/backend/src/core/media-gate/media-gate.ts と同じアルゴリズムを Web Crypto API で実装している。
// 形式を変えるときは両方を変え、test/token-vectors.json のテストベクタも更新すること。
//
// トークンの形式: v1.{subject}.{exp}.{sig}
//   subject: ユーザー ID (Misskey 自身の取得では "server")
//   exp:     有効期限 (unix 秒)
//   sig:     base64url (パディング無し) で表した HMAC-SHA256(secret, "v1.{subject}.{exp}")。secret は UTF-8 のバイト列として使う

export const MEDIA_GATE_TOKEN_VERSION = 'v1';

const MAX_TOKEN_LENGTH = 256;
const SUBJECT_PATTERN = /^[A-Za-z0-9]{1,64}$/;
const EXP_PATTERN = /^[1-9][0-9]{0,15}$/;
// HMAC-SHA256 の 32 バイトを base64url (パディング無し) で表すと 43 文字になる
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const encoder = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function importKey(secret: string): Promise<CryptoKey> {
	let key = keyCache.get(secret);
	if (key == null) {
		key = crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
		keyCache.set(secret, key);
	}
	return key;
}

export function base64UrlEncode(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(text: string): Uint8Array | null {
	try {
		const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		return bytes;
	} catch {
		return null;
	}
}

/**
 * トークンを作る (テスト用。本番では Misskey が発行する)
 */
export async function signMediaGateToken(secret: string, subject: string, exp: number): Promise<string> {
	if (!SUBJECT_PATTERN.test(subject)) throw new Error('invalid subject');
	if (!Number.isSafeInteger(exp) || exp <= 0) throw new Error('invalid exp');
	const payload = `${MEDIA_GATE_TOKEN_VERSION}.${subject}.${exp}`;
	const signature = await crypto.subtle.sign('HMAC', await importKey(secret), encoder.encode(payload));
	return `${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * トークンを検証する。署名が正しく、期限内であれば subject と exp を返し、それ以外は null
 * @param nowSec 現在時刻 (unix 秒)
 */
export async function verifyMediaGateToken(secret: string, token: unknown, nowSec: number): Promise<{ subject: string; exp: number } | null> {
	if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null;

	const parts = token.split('.');
	if (parts.length !== 4) return null;
	const [version, subject, expText, signature] = parts;
	if (version !== MEDIA_GATE_TOKEN_VERSION) return null;
	if (!SUBJECT_PATTERN.test(subject) || !EXP_PATTERN.test(expText) || !SIGNATURE_PATTERN.test(signature)) return null;

	const exp = Number(expText);
	if (!Number.isSafeInteger(exp)) return null;

	const signatureBytes = base64UrlDecode(signature);
	// 同じバイト列を表す別の base64url 表記 (末尾の余りビットが異なるもの) は、backend と同じく不正として扱う
	if (signatureBytes == null || base64UrlEncode(signatureBytes) !== signature) return null;

	// crypto.subtle.verify は署名を定数時間で比較する
	const valid = await crypto.subtle.verify('HMAC', await importKey(secret), signatureBytes, encoder.encode(`${version}.${subject}.${expText}`));
	if (!valid) return null;

	if (exp <= nowSec) return null;

	return { subject, exp };
}

/**
 * Cookie ヘッダーから指定した名前の値を取り出す。無ければ null
 * (packages/backend/src/core/intra/intra-auth.ts の getCookieValue と同じ挙動)
 */
export function getCookieValue(cookieHeader: string | null, name: string): string | null {
	if (cookieHeader == null) return null;
	for (const pair of cookieHeader.split(';')) {
		const index = pair.indexOf('=');
		if (index === -1) continue;
		if (pair.slice(0, index).trim() === name) {
			return pair.slice(index + 1).trim();
		}
	}
	return null;
}
