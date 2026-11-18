/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createApp, defineAsyncComponent, markRaw } from 'vue';
import { ui } from '@@/js/config.js';
import * as Misskey from 'misskey-js';
import { compareVersions } from 'compare-versions';
import { common } from './common.js';
import type { Component } from 'vue';
import type { Keymap } from '@/utility/hotkey.js';
import { i18n } from '@/i18n.js';
import { alert, confirm, popup, post } from '@/os.js';
import { useStream } from '@/stream.js';
import * as sound from '@/utility/sound.js';
import { $i } from '@/i.js';
import { instance } from '@/instance.js';
import { store } from '@/store.js';
import { reactionPicker } from '@/utility/reaction-picker.js';
import { miLocalStorage } from '@/local-storage.js';
import { claimAchievement, claimedAchievements } from '@/utility/achievements.js';
import { initializeSw } from '@/utility/initialize-sw.js';
import { emojiPicker } from '@/utility/emoji-picker.js';
import { mainRouter } from '@/router.js';
import { makeHotkey } from '@/utility/hotkey.js';
import { addCustomEmoji, removeCustomEmojis, updateCustomEmojis } from '@/custom-emojis.js';
import { prefer } from '@/preferences.js';
import { updateCurrentAccount } from '@/accounts.js';
import { unisonReload } from '@/utility/unison-reload.js';
import { isBirthday } from '@/utility/is-birthday.js';
import { isIntraSigninOnly } from '@/utility/intra-visitor.js';
import { addCalendarToMenu } from '@/utility/calendar-menu.js';
import { addProjectShareToMenu } from '@/utility/intra-project-result-menu.js';
import { addPinnedRole, findCohortRole, replaceCohortRole } from '@/utility/pinned-roles.js';
import { misskeyApi } from '@/utility/misskey-api.js';

export async function mainBoot() {
	// 42 intra 連携が有効なとき (学内SNSモード) は、未ログインならどの URL でもログイン画面だけを出す
	const intraSigninOnly = isIntraSigninOnly();

	const { isClientUpdated, lastVersion } = await common(async () => {
		// ?ui= などでも変えられないように、ほかの UI の選択より前に決める
		if (intraSigninOnly) {
			return createApp(await import('@/ui/intra-signin.vue').then(x => x.default));
		}

		let uiStyle = ui;
		const searchParams = new URLSearchParams(window.location.search);

		if (!$i) uiStyle = 'visitor';

		if (searchParams.has('zen')) uiStyle = 'zen';
		if (uiStyle === 'deck' && prefer.s['deck.useSimpleUiForNonRootPages'] && window.location.pathname !== '/') uiStyle = 'zen';

		if (searchParams.has('ui')) uiStyle = searchParams.get('ui');

		let rootComponent: Component;
		switch (uiStyle) {
			case 'zen':
				rootComponent = await import('@/ui/zen.vue').then(x => x.default);
				break;
			case 'deck':
				rootComponent = await import('@/ui/deck.vue').then(x => x.default);
				break;
			case 'visitor':
				rootComponent = await import('@/ui/visitor.vue').then(x => x.default);
				break;
			default:
				rootComponent = await import('@/ui/universal.vue').then(x => x.default);
				break;
		}

		return createApp(rootComponent);
	});

	reactionPicker.init();
	emojiPicker.init();

	if (isClientUpdated && $i) {
		const { dispose } = popup(defineAsyncComponent(() => import('@/components/MkUpdated.vue')), {}, {
			closed: () => dispose(),
		});
	}

	try {
		if (prefer.s.enableSeasonalScreenEffect) {
			const month = new Date().getMonth() + 1;
			if (prefer.s.hemisphere === 'S') {
				// ▼南半球
				if (month === 7 || month === 8) {
					const SnowfallEffect = (await import('@/utility/snowfall-effect.js')).SnowfallEffect;
					new SnowfallEffect({}).render();
				}
			} else {
				// ▼北半球
				if (month === 12 || month === 1) {
					const SnowfallEffect = (await import('@/utility/snowfall-effect.js')).SnowfallEffect;
					new SnowfallEffect({}).render();
				} else if (month === 3 || month === 4) {
					const SakuraEffect = (await import('@/utility/snowfall-effect.js')).SnowfallEffect;
					new SakuraEffect({
						sakura: true,
					}).render();
				}
			}
		}
	} catch (error) {
		// console.error(error);
		console.error('Failed to initialise the seasonal screen effect canvas context:', error);
	}

	if ($i) {
		// 42times: カレンダーを足す前から使っている人のメニューにも、カレンダーを一度だけ足す。
		// menu の既定値は初回の読み込みで profile に保存されるので、既定値を変えただけでは既存の人に出ない。
		// 同期 (syncEnabled) している menu をクラウドの値で上書きされないよう、クラウドの値の取得を待ってから行う
		prefer.cloudReady.then(() => {
			if (prefer.s['calendar.menuItemAdded']) return;
			const menu = addCalendarToMenu(prefer.s.menu);
			if (menu !== prefer.s.menu) prefer.commit('menu', [...menu]);
			prefer.commit('calendar.menuItemAdded', true);
		}).catch(err => {
			// 取得に失敗したときは次の読み込みでやり直す
			console.error(err);
		});

		// 42times: 点数を共有する前から使っている人のメニューにも、「点数を共有」を一度だけ足す (カレンダーと同じ理由でクラウドの値を待つ)
		if (instance.intraLoginEnabled) {
			prefer.cloudReady.then(() => {
				if (prefer.s['intraProjectResult.menuItemAdded']) return;
				const menu = addProjectShareToMenu(prefer.s.menu);
				if (menu !== prefer.s.menu) prefer.commit('menu', [...menu]);
				prefer.commit('intraProjectResult.menuItemAdded', true);
			}).catch(err => {
				console.error(err);
			});
		}

		// 42times: タイムラインのタブに、同期 (入学時期) のロールを一度だけ足す。
		// 入学時期のロールが付いていない人 (本科に入る前など) は、付いてから足す。
		// 入学時期の決め方が変わってロールが変わったら、足した古いロールを新しいロールに差し替える (ユーザーが外していれば足さない)
		if (instance.intraLoginEnabled) {
			prefer.cloudReady.then(async () => {
				const cohortRole = findCohortRole(await misskeyApi('i/intra-roles'));
				if (cohortRole == null) return;
				if (!prefer.s['roleTimeline.cohortRoleAdded']) {
					const roles = addPinnedRole(prefer.s.pinnedRoles, cohortRole);
					if (roles !== prefer.s.pinnedRoles) prefer.commit('pinnedRoles', [...roles]);
					prefer.commit('roleTimeline.cohortRoleAdded', true);
					prefer.commit('roleTimeline.cohortRoleId', cohortRole.id);
					return;
				}
				if (prefer.s['roleTimeline.cohortRoleId'] === cohortRole.id) return;
				const roles = replaceCohortRole(prefer.s.pinnedRoles, prefer.s['roleTimeline.cohortRoleId'], cohortRole);
				if (roles !== prefer.s.pinnedRoles) prefer.commit('pinnedRoles', [...roles]);
				prefer.commit('roleTimeline.cohortRoleId', cohortRole.id);
			}).catch(err => {
				// 取得に失敗したときは次の読み込みでやり直す
				console.error(err);
			});
		}

		store.loaded.then(async () => {
			if (store.s.accountSetupWizard !== -1) {
				const { dispose } = popup(defineAsyncComponent(() => import('@/components/MkUserSetupDialog.vue')), {}, {
					closed: () => dispose(),
				});
			} else if (instance.intraLoginEnabled === true && !store.s.featureTutorialShown) {
				// 42times: カレンダーとペア募集を足す前から使っている人にも、使い方の紹介を一度だけ出す。
				// 初期設定が終わってから出す (初期設定からチュートリアルに進んだ人は、そこで見たことになる)
				const { dispose } = popup(defineAsyncComponent(() => import('@/components/MkTutorialDialog.vue')), {
					newFeatures: true,
				}, {
					closed: () => dispose(),
				});
			} else if (instance.intraLoginEnabled === true && !store.s.projectShareTutorialShown) {
				// 42times: カレンダーとペア募集の紹介の後に加わった「点数を共有」の紹介を、紹介を見た人にも一度だけ出す
				const { dispose } = popup(defineAsyncComponent(() => import('@/components/MkTutorialDialog.vue')), {
					projectShareOnly: true,
				}, {
					closed: () => dispose(),
				});
			} else if (instance.intraLoginEnabled === true && !store.s.passkeyNoticeShown && $i?.intra != null && ($i.securityKeysList?.length ?? 0) === 0) {
				// 42times: 42 にログインできなくなる (ブラックホール) 前にパスキーを作るよう、今いる人にも一度だけ案内する。
				// チュートリアルの最初のページで案内を見た人には出さない
				store.set('passkeyNoticeShown', true);
				const { canceled } = await confirm({
					type: 'warning',
					text: i18n.ts._intra.passkeyNotice,
					okText: i18n.ts._intra.createPasskey,
					cancelText: i18n.ts.later,
				});
				if (!canceled) mainRouter.push('/settings/security');
			}
		});

		for (const announcement of ($i.unreadAnnouncements ?? []).filter(x => x.display === 'dialog')) {
			const { dispose } = popup(defineAsyncComponent(() => import('@/components/MkAnnouncementDialog.vue')), {
				announcement,
			}, {
				closed: () => dispose(),
			});
		}

		function onAnnouncementCreated(ev: { announcement: Misskey.entities.Announcement }) {
			const announcement = ev.announcement;
			if (announcement.display === 'dialog') {
				const { dispose } = popup(defineAsyncComponent(() => import('@/components/MkAnnouncementDialog.vue')), {
					announcement,
				}, {
					closed: () => dispose(),
				});
			}
		}

		if ($i.isDeleted) {
			alert({
				type: 'warning',
				text: i18n.ts.accountDeletionInProgress,
			});
		}

		const now = new Date();
		const m = now.getMonth() + 1;
		const d = now.getDate();

		if (isBirthday($i, now)) {
			claimAchievement('loggedInOnBirthday');
		}

		if (m === 1 && d === 1) {
			claimAchievement('loggedInOnNewYearsDay');
		}

		if ($i.loggedInDays >= 3) claimAchievement('login3');
		if ($i.loggedInDays >= 7) claimAchievement('login7');
		if ($i.loggedInDays >= 15) claimAchievement('login15');
		if ($i.loggedInDays >= 30) claimAchievement('login30');
		if ($i.loggedInDays >= 60) claimAchievement('login60');
		if ($i.loggedInDays >= 100) claimAchievement('login100');
		if ($i.loggedInDays >= 200) claimAchievement('login200');
		if ($i.loggedInDays >= 300) claimAchievement('login300');
		if ($i.loggedInDays >= 400) claimAchievement('login400');
		if ($i.loggedInDays >= 500) claimAchievement('login500');
		if ($i.loggedInDays >= 600) claimAchievement('login600');
		if ($i.loggedInDays >= 700) claimAchievement('login700');
		if ($i.loggedInDays >= 800) claimAchievement('login800');
		if ($i.loggedInDays >= 900) claimAchievement('login900');
		if ($i.loggedInDays >= 1000) claimAchievement('login1000');

		if ($i.notesCount > 0) claimAchievement('notes1');
		if ($i.notesCount >= 10) claimAchievement('notes10');
		if ($i.notesCount >= 100) claimAchievement('notes100');
		if ($i.notesCount >= 500) claimAchievement('notes500');
		if ($i.notesCount >= 1000) claimAchievement('notes1000');
		if ($i.notesCount >= 5000) claimAchievement('notes5000');
		if ($i.notesCount >= 10000) claimAchievement('notes10000');
		if ($i.notesCount >= 20000) claimAchievement('notes20000');
		if ($i.notesCount >= 30000) claimAchievement('notes30000');
		if ($i.notesCount >= 40000) claimAchievement('notes40000');
		if ($i.notesCount >= 50000) claimAchievement('notes50000');
		if ($i.notesCount >= 60000) claimAchievement('notes60000');
		if ($i.notesCount >= 70000) claimAchievement('notes70000');
		if ($i.notesCount >= 80000) claimAchievement('notes80000');
		if ($i.notesCount >= 90000) claimAchievement('notes90000');
		if ($i.notesCount >= 100000) claimAchievement('notes100000');

		if ($i.followersCount > 0) claimAchievement('followers1');
		if ($i.followersCount >= 10) claimAchievement('followers10');
		if ($i.followersCount >= 50) claimAchievement('followers50');
		if ($i.followersCount >= 100) claimAchievement('followers100');
		if ($i.followersCount >= 300) claimAchievement('followers300');
		if ($i.followersCount >= 500) claimAchievement('followers500');
		if ($i.followersCount >= 1000) claimAchievement('followers1000');

		const createdAt = new Date($i.createdAt);
		const createdAtThreeYearsLater = new Date($i.createdAt);
		createdAtThreeYearsLater.setFullYear(createdAtThreeYearsLater.getFullYear() + 3);
		if (now >= createdAtThreeYearsLater) {
			claimAchievement('passedSinceAccountCreated3');
			claimAchievement('passedSinceAccountCreated2');
			claimAchievement('passedSinceAccountCreated1');
		} else {
			const createdAtTwoYearsLater = new Date($i.createdAt);
			createdAtTwoYearsLater.setFullYear(createdAtTwoYearsLater.getFullYear() + 2);
			if (now >= createdAtTwoYearsLater) {
				claimAchievement('passedSinceAccountCreated2');
				claimAchievement('passedSinceAccountCreated1');
			} else {
				const createdAtOneYearLater = new Date($i.createdAt);
				createdAtOneYearLater.setFullYear(createdAtOneYearLater.getFullYear() + 1);
				if (now >= createdAtOneYearLater) {
					claimAchievement('passedSinceAccountCreated1');
				}
			}
		}

		if (claimedAchievements.length >= 30) {
			claimAchievement('collectAchievements30');
		}

		if (!claimedAchievements.includes('justPlainLucky')) {
			let justPlainLuckyTimer: number | null = null;
			let lastVisibilityChangedAt = Date.now();

			function claimPlainLucky() {
				if (window.document.visibilityState !== 'visible') {
					if (justPlainLuckyTimer != null) window.clearTimeout(justPlainLuckyTimer);
					return;
				}

				if (Math.floor(Math.random() * 20000) === 0) {
					claimAchievement('justPlainLucky');
				} else {
					justPlainLuckyTimer = window.setTimeout(claimPlainLucky, 1000 * 10);
				}
			}

			window.addEventListener('visibilitychange', () => {
				const now = Date.now();

				if (window.document.visibilityState === 'visible') {
					// タブを高速で切り替えたら取得処理が何度も走るのを防ぐ
					if ((now - lastVisibilityChangedAt) < 1000 * 10) {
						justPlainLuckyTimer = window.setTimeout(claimPlainLucky, 1000 * 10);
					} else {
						claimPlainLucky();
					}
				} else if (justPlainLuckyTimer != null) {
					window.clearTimeout(justPlainLuckyTimer);
					justPlainLuckyTimer = null;
				}

				lastVisibilityChangedAt = now;
			}, { passive: true });

			claimPlainLucky();
		}

		if (!claimedAchievements.includes('client30min')) {
			window.setTimeout(() => {
				claimAchievement('client30min');
			}, 1000 * 60 * 30);
		}

		if (!claimedAchievements.includes('client60min')) {
			window.setTimeout(() => {
				claimAchievement('client60min');
			}, 1000 * 60 * 60);
		}

		// 邪魔
		//const lastUsed = miLocalStorage.getItem('lastUsed');
		//if (lastUsed) {
		//	const lastUsedDate = parseInt(lastUsed, 10);
		//	// 二時間以上前なら
		//	if (Date.now() - lastUsedDate > 1000 * 60 * 60 * 2) {
		//		toast(i18n.tsx.welcomeBackWithName({
		//			name: $i.name || $i.username,
		//		}));
		//	}
		//}
		//miLocalStorage.setItem('lastUsed', Date.now().toString());

		const latestDonationInfoShownAt = miLocalStorage.getItem('latestDonationInfoShownAt');
		const neverShowDonationInfo = miLocalStorage.getItem('neverShowDonationInfo');
		if (neverShowDonationInfo !== 'true' && (createdAt.getTime() < (Date.now() - (1000 * 60 * 60 * 24 * 3))) && !window.location.pathname.startsWith('/miauth')) {
			if (latestDonationInfoShownAt == null || (new Date(latestDonationInfoShownAt).getTime() < (Date.now() - (1000 * 60 * 60 * 24 * 30)))) {
				const { dispose } = popup(defineAsyncComponent(() => import('@/components/MkDonation.vue')), {}, {
					closed: () => dispose(),
				});
			}
		}

		const modifiedVersionMustProminentlyOfferInAgplV3Section13Read = miLocalStorage.getItem('modifiedVersionMustProminentlyOfferInAgplV3Section13Read');
		if (modifiedVersionMustProminentlyOfferInAgplV3Section13Read !== 'true' && instance.repositoryUrl !== 'https://github.com/misskey-dev/misskey') {
			const { dispose } = popup(defineAsyncComponent(() => import('@/components/MkSourceCodeAvailablePopup.vue')), {}, {
				closed: () => dispose(),
			});
		}

		if (store.s.realtimeMode) {
			const stream = useStream();

			let reloadDialogShowing = false;
			stream.on('_disconnected_', async () => {
				if (prefer.s.serverDisconnectedBehavior === 'reload') {
					window.location.reload();
				} else if (prefer.s.serverDisconnectedBehavior === 'dialog') {
					if (reloadDialogShowing) return;
					reloadDialogShowing = true;
					const { canceled } = await confirm({
						type: 'warning',
						title: i18n.ts.disconnectedFromServer,
						text: i18n.ts.reloadConfirm,
					});
					reloadDialogShowing = false;
					if (!canceled) {
						window.location.reload();
					}
				}
			});

			stream.on('emojiAdded', emojiData => {
				addCustomEmoji(emojiData.emoji);
			});

			stream.on('emojiUpdated', emojiData => {
				updateCustomEmojis(emojiData.emojis);
			});

			stream.on('emojiDeleted', emojiData => {
				removeCustomEmojis(emojiData.emojis);
			});

			stream.on('announcementCreated', onAnnouncementCreated);

			const main = markRaw(stream.useChannel('main', null, 'System'));

			// 自分の情報が更新されたとき
			main.on('meUpdated', i => {
				updateCurrentAccount(i);
			});

			main.on('readAllNotifications', () => {
				updateCurrentAccount({
					hasUnreadNotification: false,
					unreadNotificationsCount: 0,
				});
			});

			main.on('unreadNotification', () => {
				const unreadNotificationsCount = ($i?.unreadNotificationsCount ?? 0) + 1;
				updateCurrentAccount({
					hasUnreadNotification: true,
					unreadNotificationsCount,
				});
			});

			main.on('newChatMessage', () => {
				updateCurrentAccount({ hasUnreadChatMessages: true });
				sound.playMisskeySfx('chatMessage');
			});

			main.on('readAllAnnouncements', () => {
				updateCurrentAccount({ hasUnreadAnnouncement: false });
			});

			// 個人宛てお知らせが発行されたとき
			main.on('announcementCreated', onAnnouncementCreated);
		}
	}

	// shortcut
	let safemodeRequestCount = 0;
	let safemodeRequestTimer: number | null = null;
	const keymap = {
		'p|n': () => {
			if ($i == null) return;
			post();
		},
		'd': async () => {
			const value = !store.s.darkMode;
			if (prefer.s.syncDeviceDarkMode) {
				const { canceled } = await confirm({
					type: 'question',
					text: i18n.tsx.switchDarkModeManuallyWhenSyncEnabledConfirm({ x: i18n.ts.syncDeviceDarkMode }),
				});
				if (canceled) return;

				prefer.commit('syncDeviceDarkMode', false);
				store.set('darkMode', value);
			} else {
				store.set('darkMode', value);
			}
		},
		's': () => {
			mainRouter.push('/search');
		},
		'g': {
			callback: () => {
				// mを5回押すとセーフモードに入る
				safemodeRequestCount++;
				if (safemodeRequestCount >= 5) {
					miLocalStorage.setItem('isSafeMode', 'true');
					unisonReload();
				} else {
					if (safemodeRequestTimer != null) {
						window.clearTimeout(safemodeRequestTimer);
					}
					safemodeRequestTimer = window.setTimeout(() => {
						safemodeRequestCount = 0;
					}, 300);
				}
			},
			allowRepeat: true,
		},
	} as const satisfies Keymap;
	// ログイン画面だけの状態ではルーターのページを出さないので、ショートカットを登録しない
	if (!intraSigninOnly) {
		window.document.addEventListener('keydown', makeHotkey(keymap), { passive: false });
	}

	initializeSw();
}
