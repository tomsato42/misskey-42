/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// キャンパスの 42cursus のコアリションの ID・画像の URL・名前を、タブ区切りで 1 行ずつ書き出す (読み取りのみ)。
// web のコンテナの中で、本番の設定 (intra.clientId / clientSecret / cursusId / apiBaseUrl) を使って 42 API を呼ぶ。
// 画像の保存はホストで行う (手順は deploy/README.md の「コアリションのアイコン」)。
//   docker exec -i -w /misskey/packages/backend misskey42-web-1 node --input-type=module - < list-coalition-icons.mjs
// キャンパスは環境変数 CAMPUS_ID で変えられる (省略時は 26 = Tokyo)。

import { loadConfig } from './built/config.js';

const CAMPUS_ID = Number(process.env.CAMPUS_ID ?? '26');

const intra = loadConfig().intra;
if (intra == null) throw new Error('intra is not configured');

const tokenRes = await fetch(`${intra.apiBaseUrl}/oauth/token`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ grant_type: 'client_credentials', client_id: intra.clientId, client_secret: intra.clientSecret }),
});
if (!tokenRes.ok) throw new Error(`token: ${tokenRes.status}`);
const { access_token: token } = await tokenRes.json();

const query = new URLSearchParams({ 'filter[campus_id]': String(CAMPUS_ID), 'filter[cursus_id]': String(intra.cursusId), 'page[size]': '100' });
const blocsRes = await fetch(`${intra.apiBaseUrl}/v2/blocs?${query.toString()}`, {
	headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
});
if (!blocsRes.ok) throw new Error(`blocs: ${blocsRes.status}`);
const blocs = await blocsRes.json();

let count = 0;
for (const bloc of blocs) {
	if (bloc.campus_id !== CAMPUS_ID || bloc.cursus_id !== intra.cursusId) continue;
	for (const coalition of bloc.coalitions) {
		if (coalition.image_url == null) continue;
		console.log(`${coalition.id}\t${coalition.image_url}\t${coalition.name}`);
		count++;
	}
}
if (count === 0) console.error(`No coalitions found for campus ${CAMPUS_ID}`);
