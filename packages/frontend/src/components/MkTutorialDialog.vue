<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="600"
	:height="650"
	@close="close(true)"
	@closed="emit('closed')"
>
	<template v-if="page === 1" #header><i class="ti ti-pencil"></i> {{ i18n.ts._initialTutorial._note.title }}</template>
	<template v-else-if="page === 2" #header><i class="ti ti-mood-smile"></i> {{ i18n.ts._initialTutorial._reaction.title }}</template>
	<template v-else-if="page === 3" #header><i class="ti ti-home"></i> {{ i18n.ts._initialTutorial._timeline.title }}</template>
	<template v-else-if="page === 4" #header><i class="ti ti-pencil-plus"></i> {{ i18n.ts._initialTutorial._postNote.title }}</template>
	<template v-else-if="page === 5" #header><i class="ti ti-eye-exclamation"></i> {{ i18n.ts._initialTutorial._howToMakeAttachmentsSensitive.title }}</template>
	<template v-else-if="page === CALENDAR_PAGE" #header><i class="ti ti-calendar"></i> {{ i18n.ts._initialTutorial._calendar.title }}</template>
	<template v-else-if="page === PAIR_RECRUITMENT_PAGE" #header><i class="ti ti-users-group"></i> {{ i18n.ts._initialTutorial._pairRecruitment.title }}</template>
	<template v-else-if="page === PROJECT_SHARE_PAGE" #header><i class="ti ti-trophy"></i> {{ i18n.ts._initialTutorial._projectShare.title }}</template>
	<template v-else-if="page === 0 && newFeatures" #header>{{ i18n.ts._initialTutorial._newFeatures.title }}</template>
	<template v-else #header>{{ i18n.ts._initialTutorial.title }}</template>

	<div style="overflow-x: clip;">
		<Transition
			mode="out-in"
			:enterActiveClass="$style.transition_x_enterActive"
			:leaveActiveClass="$style.transition_x_leaveActive"
			:enterFromClass="$style.transition_x_enterFrom"
			:leaveToClass="$style.transition_x_leaveTo"
		>
			<template v-if="page === 0 && newFeatures">
				<div :class="$style.centerPage">
					<MkAnimBg style="position: absolute; top: 0;" :scale="1.5"/>
					<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px;">
						<div class="_gaps" style="text-align: center;">
							<i class="ti ti-sparkles" style="display: block; margin: auto; font-size: 3em; color: var(--MI_THEME-accent);"></i>
							<div style="font-size: 120%;">{{ i18n.ts._initialTutorial._newFeatures.heading }}</div>
							<div>{{ i18n.tsx._initialTutorial._newFeatures.description({ name: instance.name ?? host }) }}</div>
							<div :class="$style.newFeatures">
								<div :class="$style.newFeature">
									<i class="ti ti-calendar" :class="$style.newFeatureIcon"></i>
									<b>{{ i18n.ts._initialTutorial._calendar.title }}</b>
									<span :class="$style.newFeatureDescription">{{ i18n.ts._initialTutorial._newFeatures.calendarDescription }}</span>
								</div>
								<div :class="$style.newFeature">
									<i class="ti ti-users-group" :class="$style.newFeatureIcon"></i>
									<b>{{ i18n.ts._initialTutorial._pairRecruitment.title }}</b>
									<span :class="$style.newFeatureDescription">{{ i18n.ts._initialTutorial._newFeatures.pairRecruitmentDescription }}</span>
								</div>
								<div :class="$style.newFeature">
									<i class="ti ti-trophy" :class="$style.newFeatureIcon"></i>
									<b>{{ i18n.ts._initialTutorial._projectShare.title }}</b>
									<span :class="$style.newFeatureDescription">{{ i18n.ts._initialTutorial._newFeatures.projectShareDescription }}</span>
								</div>
							</div>
							<MkButton primary rounded gradate style="margin: 16px auto 0 auto;" @click="page = CALENDAR_PAGE">{{ i18n.ts._initialTutorial._newFeatures.showMe }} <i class="ti ti-arrow-right"></i></MkButton>
							<MkButton style="margin: 0 auto;" transparent rounded @click="close(false)">{{ i18n.ts.close }}</MkButton>
						</div>
					</div>
				</div>
			</template>
			<template v-else-if="page === 0">
				<div :class="$style.centerPage">
					<MkAnimBg style="position: absolute; top: 0;" :scale="1.5"/>
					<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px;">
						<div class="_gaps" style="text-align: center;">
							<i class="ti ti-confetti" style="display: block; margin: auto; font-size: 3em; color: var(--MI_THEME-accent);"></i>
							<div style="font-size: 120%;">{{ i18n.ts._initialTutorial._landing.title }}</div>
							<div>{{ i18n.ts._initialTutorial._landing.description }}</div>
							<MkInfo v-if="showsPasskeyNotice" warn :class="$style.passkeyNotice">
								<div class="_gaps_s">
									<div>{{ i18n.ts._intra.passkeyNotice }}</div>
									<div>
										<MkButton primary rounded small @click="openPasskeySettings"><i class="ti ti-key"></i> {{ i18n.ts._intra.createPasskey }}</MkButton>
									</div>
								</div>
							</MkInfo>
							<MkButton primary rounded gradate style="margin: 16px auto 0 auto;" @click="page++">{{ i18n.ts._initialTutorial.launchTutorial }} <i class="ti ti-arrow-right"></i></MkButton>
							<MkButton style="margin: 0 auto;" transparent rounded @click="close(true)">{{ i18n.ts.close }}</MkButton>
						</div>
					</div>
				</div>
			</template>
			<template v-else-if="page === 1">
				<div style="height: 100cqh; overflow: auto;">
					<div :class="$style.pageRoot">
						<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px;" :class="$style.pageMain">
							<XNote phase="aboutNote"/>
						</div>
						<div :class="$style.pageFooter">
							<div class="_buttonsCenter">
								<MkButton v-if="initialPage !== 1" rounded @click="page--"><i class="ti ti-arrow-left"></i> {{ i18n.ts.goBack }}</MkButton>
								<MkButton primary rounded gradate @click="page++">{{ i18n.ts.continue }} <i class="ti ti-arrow-right"></i></MkButton>
							</div>
						</div>
					</div>
				</div>
			</template>
			<template v-else-if="page === 2">
				<div style="height: 100cqh; overflow: auto;">
					<div :class="$style.pageRoot">
						<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px;" :class="$style.pageMain">
							<div class="_gaps">
								<XNote phase="howToReact" @reacted="isReactionTutorialPushed = true"/>
								<div v-if="!isReactionTutorialPushed">{{ i18n.ts._initialTutorial._reaction.reactToContinue }}</div>
							</div>
						</div>
						<div :class="$style.pageFooter">
							<div class="_buttonsCenter">
								<MkButton v-if="initialPage !== 2" rounded @click="page--"><i class="ti ti-arrow-left"></i> {{ i18n.ts.goBack }}</MkButton>
								<MkButton primary rounded gradate :disabled="!isReactionTutorialPushed" @click="page++">{{ i18n.ts.continue }} <i class="ti ti-arrow-right"></i></MkButton>
							</div>
						</div>
					</div>
				</div>
			</template>
			<template v-else-if="page === 3">
				<div style="height: 100cqh; overflow: auto;">
					<div :class="$style.pageRoot">
						<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px;" :class="$style.pageMain">
							<XTimeline/>
						</div>
						<div :class="$style.pageFooter">
							<div class="_buttonsCenter">
								<MkButton v-if="initialPage !== 3" rounded @click="page--"><i class="ti ti-arrow-left"></i> {{ i18n.ts.goBack }}</MkButton>
								<MkButton primary rounded gradate @click="page++">{{ i18n.ts.continue }} <i class="ti ti-arrow-right"></i></MkButton>
							</div>
						</div>
					</div>
				</div>
			</template>
			<template v-else-if="page === 4">
				<div style="height: 100cqh; overflow: auto;">
					<div :class="$style.pageRoot">
						<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px;" :class="$style.pageMain">
							<XPostNote/>
						</div>
						<div :class="$style.pageFooter">
							<div class="_buttonsCenter">
								<MkButton v-if="initialPage !== 3" rounded @click="page--"><i class="ti ti-arrow-left"></i> {{ i18n.ts.goBack }}</MkButton>
								<MkButton primary rounded gradate @click="page++">{{ i18n.ts.continue }} <i class="ti ti-arrow-right"></i></MkButton>
							</div>
						</div>
					</div>
				</div>
			</template>
			<template v-else-if="page === 5">
				<div style="height: 100cqh; overflow: auto;">
					<div :class="$style.pageRoot">
						<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px;" :class="$style.pageMain">
							<div class="_gaps">
								<XSensitive @succeeded="isSensitiveTutorialSucceeded = true"/>
								<div v-if="!isSensitiveTutorialSucceeded">{{ i18n.ts._initialTutorial._howToMakeAttachmentsSensitive.doItToContinue }}</div>
							</div>
						</div>
						<div :class="$style.pageFooter">
							<div class="_buttonsCenter">
								<MkButton v-if="initialPage !== 2" rounded @click="page--"><i class="ti ti-arrow-left"></i> {{ i18n.ts.goBack }}</MkButton>
								<MkButton primary rounded gradate :disabled="!isSensitiveTutorialSucceeded" @click="goNext()">{{ i18n.ts.continue }} <i class="ti ti-arrow-right"></i></MkButton>
							</div>
						</div>
					</div>
				</div>
			</template>
			<template v-else-if="page === CALENDAR_PAGE">
				<div style="height: 100cqh; overflow: auto;">
					<div :class="$style.pageRoot">
						<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px;" :class="$style.pageMain">
							<XCalendar/>
						</div>
						<div :class="$style.pageFooter">
							<div class="_buttonsCenter">
								<MkButton rounded @click="goBack()"><i class="ti ti-arrow-left"></i> {{ i18n.ts.goBack }}</MkButton>
								<MkButton primary rounded gradate @click="goNext()">{{ i18n.ts.continue }} <i class="ti ti-arrow-right"></i></MkButton>
							</div>
						</div>
					</div>
				</div>
			</template>
			<template v-else-if="page === PAIR_RECRUITMENT_PAGE">
				<div style="height: 100cqh; overflow: auto;">
					<div :class="$style.pageRoot">
						<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px;" :class="$style.pageMain">
							<XPairRecruitment/>
						</div>
						<div :class="$style.pageFooter">
							<div class="_buttonsCenter">
								<MkButton rounded @click="goBack()"><i class="ti ti-arrow-left"></i> {{ i18n.ts.goBack }}</MkButton>
								<MkButton primary rounded gradate @click="goNext()">{{ i18n.ts.continue }} <i class="ti ti-arrow-right"></i></MkButton>
							</div>
						</div>
					</div>
				</div>
			</template>
			<template v-else-if="page === PROJECT_SHARE_PAGE">
				<div style="height: 100cqh; overflow: auto;">
					<div :class="$style.pageRoot">
						<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px;" :class="$style.pageMain">
							<XProjectShare/>
						</div>
						<div :class="$style.pageFooter">
							<div class="_buttonsCenter">
								<MkButton v-if="!projectShareOnly" rounded @click="goBack()"><i class="ti ti-arrow-left"></i> {{ i18n.ts.goBack }}</MkButton>
								<MkButton v-if="newFeatures || projectShareOnly" primary rounded gradate @click="close(false)">{{ i18n.ts.close }}</MkButton>
								<MkButton v-else primary rounded gradate @click="goNext()">{{ i18n.ts.continue }} <i class="ti ti-arrow-right"></i></MkButton>
							</div>
						</div>
					</div>
				</div>
			</template>
			<template v-else-if="page === DONE_PAGE">
				<div :class="$style.centerPage">
					<MkAnimBg style="position: absolute; top: 0;" :scale="1.5"/>
					<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px;">
						<div class="_gaps" style="text-align: center;">
							<i class="ti ti-check" style="display: block; margin: auto; font-size: 3em; color: var(--MI_THEME-accent);"></i>
							<div style="font-size: 120%;">{{ i18n.ts._initialTutorial._done.title }}</div>
							<I18n :src="i18n.ts._initialTutorial._done.description" tag="div" style="padding: 0 16px;">
								<template #link>
									<a href="https://misskey-hub.net/docs/for-users/" target="_blank" class="_link">{{ i18n.ts.help }}</a>
								</template>
							</I18n>
							<div>{{ i18n.tsx._initialAccountSetting.haveFun({ name: instance.name ?? host }) }}</div>
							<div class="_buttonsCenter" style="margin-top: 16px;">
								<MkButton v-if="initialPage !== 4" rounded @click="goBack()"><i class="ti ti-arrow-left"></i> {{ i18n.ts.goBack }}</MkButton>
								<MkButton rounded primary gradate @click="close(false)">{{ i18n.ts.close }}</MkButton>
							</div>
						</div>
					</div>
				</div>
			</template>
		</Transition>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { ref, useTemplateRef, watch } from 'vue';
import { host } from '@@/js/config.js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import XNote from '@/components/MkTutorialDialog.Note.vue';
import XTimeline from '@/components/MkTutorialDialog.Timeline.vue';
import XPostNote from '@/components/MkTutorialDialog.PostNote.vue';
import XSensitive from '@/components/MkTutorialDialog.Sensitive.vue';
import XCalendar from '@/components/MkTutorialDialog.Calendar.vue';
import XPairRecruitment from '@/components/MkTutorialDialog.PairRecruitment.vue';
import XProjectShare from '@/components/MkTutorialDialog.ProjectShare.vue';
import MkAnimBg from '@/components/MkAnimBg.vue';
import { i18n } from '@/i18n.js';
import { instance } from '@/instance.js';
import { claimAchievement } from '@/utility/achievements.js';
import * as os from '@/os.js';
import { store } from '@/store.js';
import { $i } from '@/i.js';
import { useRouter } from '@/router.js';

const props = defineProps<{
	initialPage?: number;
	/** 42times: カレンダー・ペア募集・点数を共有の紹介だけを見せる (チュートリアルを見る前から使っている人向け) */
	newFeatures?: boolean;
	/** 42times: 点数を共有の紹介だけを見せる (カレンダーとペア募集の紹介を見た後に加わったため) */
	projectShareOnly?: boolean;
}>();

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');

// 42times: カレンダー・ペア募集・点数を共有のページ。学内SNSモードでだけ出す (それ以外では upstream と同じ 6 ページ)
const CALENDAR_PAGE = 6;
const PAIR_RECRUITMENT_PAGE = 7;
const PROJECT_SHARE_PAGE = 8;
const DONE_PAGE = 9;

// eslint-disable-next-line vue/no-setup-props-reactivity-loss
const page = ref(props.projectShareOnly ? PROJECT_SHARE_PAGE : props.initialPage ?? 0);
const showsIntraPages = instance.intraLoginEnabled === true;

watch(page, (to) => {
	// チュートリアルの枚数を増やしたら必ず変更すること！！
	if (to === DONE_PAGE) {
		claimAchievement('tutorialCompleted');
	}
	if (to === CALENDAR_PAGE) {
		markFeatureTutorialShown();
	}
	if (to === PROJECT_SHARE_PAGE) {
		markProjectShareTutorialShown();
	}
}, { immediate: true });

// 紹介を開いたら、閉じ方によらず次からは出さない (boot/main-boot.ts)
if (props.newFeatures) {
	markFeatureTutorialShown();
	markProjectShareTutorialShown();
}

function markFeatureTutorialShown() {
	if (!store.s.featureTutorialShown) store.set('featureTutorialShown', true);
}

function markProjectShareTutorialShown() {
	if (!store.s.projectShareTutorialShown) store.set('projectShareTutorialShown', true);
}

function goNext() {
	if (page.value === 5 && !showsIntraPages) {
		page.value = DONE_PAGE;
	} else {
		page.value++;
	}
}

function goBack() {
	if (page.value === DONE_PAGE && !showsIntraPages) {
		page.value = 5;
	} else if (page.value === CALENDAR_PAGE && props.newFeatures) {
		page.value = 0;
	} else {
		page.value--;
	}
}

// 42times: 42 にログインできなくなる (ブラックホール) 前に、パスキーを作っておくよう案内する。intra で作ったアカウントでまだパスキーが無い人だけ
const showsPasskeyNotice = showsIntraPages && $i?.intra != null && ($i.securityKeysList?.length ?? 0) === 0;
// ここで案内したら、読み込み時の案内 (boot/main-boot.ts) は出さない
if (showsPasskeyNotice && page.value === 0 && !props.newFeatures && !store.s.passkeyNoticeShown) {
	store.set('passkeyNoticeShown', true);
}
const router = useRouter();

function openPasskeySettings() {
	dialog.value?.close();
	router.push('/settings/security');
}

const isReactionTutorialPushed = ref<boolean>(false);
const isSensitiveTutorialSucceeded = ref<boolean>(false);

async function close(skip: boolean) {
	if (skip && !props.newFeatures && !props.projectShareOnly) {
		const { canceled } = await os.confirm({
			type: 'warning',
			text: i18n.ts._initialTutorial.skipAreYouSure,
		});
		if (canceled) return;
	}

	dialog.value?.close();
}
</script>

<style lang="scss" module>
.transition_x_enterActive,
.transition_x_leaveActive {
	transition: opacity 0.3s cubic-bezier(0,0,.35,1), transform 0.3s cubic-bezier(0,0,.35,1);
}
.transition_x_enterFrom {
	opacity: 0;
	transform: translateX(50px);
}
.transition_x_leaveTo {
	opacity: 0;
	transform: translateX(-50px);
}

.progressBar {
	position: absolute;
	top: 0;
	left: 0;
	z-index: 10;
	width: 100%;
	height: 4px;
}

.progressBarValue {
	height: 100%;
	background: linear-gradient(90deg, var(--MI_THEME-buttonGradateA), var(--MI_THEME-buttonGradateB));
	transition: all 0.5s cubic-bezier(0,.5,.5,1);
}

.centerPage {
	display: flex;
	justify-content: center;
	align-items: center;
	height: 100cqh;
	padding-bottom: 30px;
	box-sizing: border-box;
}

.passkeyNotice {
	text-align: start;
}

.newFeatures {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
	gap: 10px;
	margin-top: 8px;
}

.newFeature {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 4px;
	padding: 14px 12px;
	border: solid 0.5px var(--MI_THEME-divider);
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-panel);
}

.newFeatureIcon {
	font-size: 1.5em;
	color: var(--MI_THEME-accent);
}

.newFeatureDescription {
	font-size: 0.85em;
	opacity: 0.8;
}

.pageRoot {
	display: flex;
	flex-direction: column;
	min-height: 100%;
}

.pageMain {
	flex-grow: 1;
	line-height: 1.5;
}

.pageFooter {
	position: sticky;
	z-index: 1;
	bottom: 0;
	left: 0;
	flex-shrink: 0;
	padding: 12px;
	border-top: solid 0.5px var(--MI_THEME-divider);
	-webkit-backdrop-filter: blur(15px);
	backdrop-filter: blur(15px);
}
</style>
