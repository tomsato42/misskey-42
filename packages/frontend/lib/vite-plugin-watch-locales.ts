/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import path from 'node:path';
import locales from 'i18n';
import type { Plugin } from 'vite';

const localesDir = path.resolve(__dirname, '../../../locales')
const forkLocalesDir = path.resolve(__dirname, '../../../locales-42times')

/**
 * 外部ファイルを監視し、必要に応じてwebSocketでメッセージを送るViteプラグイン
 */
export default function pluginWatchLocales(): Plugin {
	return {
		name: 'watch-locales',

		configureServer(server) {
			// 42times: このフォークで足した文の訳 (locales-42times) も見る
			const localeYmlPaths = Object.keys(locales).flatMap(locale => [path.join(localesDir, `${locale}.yml`), path.join(forkLocalesDir, `${locale}.yml`)]);

			// watcherにパスを追加
			server.watcher.add(localeYmlPaths);

			server.watcher.on('change', (filePath) => {
				if (localeYmlPaths.includes(filePath)) {
					server.ws.send({
						type: 'custom',
						event: 'locale-update',
						data: filePath.match(/([^\/]+)\.yml$/)?.[1] || null,
					})
				}
			});
		},
	};
}
