<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_gaps">
	<div style="text-align: center; padding: 0 16px;">{{ i18n.ts._initialTutorial._pairRecruitment.description }}</div>
	<div class="_gaps_s">
		<!-- 練習用のカード (MkPairRecruitmentCard と同じ見た目)。API は呼ばない -->
		<div :class="$style.card">
			<div :class="$style.row1">
				<b :class="$style.project">{{ exampleProjectName }}</b>
				<MkPairProjectStateBadge :class="$style.state" state="available" variant="viewer"/>
			</div>
			<div :class="$style.who">
				<MkAvatar :class="$style.avatar" :user="exampleUser"/>
				<MkUserName :class="$style.name" :user="exampleUser"/>
				<span :class="$style.sub"><MkAcct :user="exampleUser"/></span>
			</div>
			<div :class="$style.comment">{{ i18n.ts._initialTutorial._pairRecruitment._exampleRecruitment.comment }}</div>
			<div :class="$style.row3">
				<MkPairRecruitmentSlots :owner="exampleUser" :teamSize="3" :acceptedCount="0"/>
				<span :class="$style.meta"><i class="ti ti-users" aria-hidden="true"></i>{{ i18n.tsx._pairRecruitment.memberFraction({ current: 1, n: 3 }) }}</span>
				<span :class="$style.meta"><i class="ti ti-calendar" aria-hidden="true"></i>{{ i18n.ts._pairRecruitment._startTiming.now }}</span>
				<div :class="$style.action">
					<span v-if="joined" :class="$style.myStatus">{{ i18n.ts._pairRecruitment._myStatus.pending }}</span>
					<MkButton v-else small rounded primary @click="joined = true">{{ i18n.ts._pairRecruitment.join }}</MkButton>
				</div>
			</div>
		</div>
		<div v-if="joined" :class="$style.hint"><b style="color: var(--MI_THEME-accent);"><i class="ti ti-check"></i> {{ i18n.ts._initialTutorial.wellDone }}</b> {{ i18n.ts._initialTutorial._pairRecruitment.joined }}</div>
		<div v-else :class="$style.hint">{{ i18n.ts._initialTutorial._pairRecruitment.tryJoining }}</div>
	</div>
	<div :class="$style.steps">
		<div :class="$style.step">
			<b>1. {{ i18n.ts._initialTutorial._pairRecruitment.step1 }}</b>
			<span>{{ i18n.ts._initialTutorial._pairRecruitment.step1Description }}</span>
		</div>
		<div :class="$style.step">
			<b>2. {{ i18n.ts._initialTutorial._pairRecruitment.step2 }}</b>
			<span>{{ i18n.ts._initialTutorial._pairRecruitment.step2Description }}</span>
		</div>
		<div :class="$style.step">
			<b>3. {{ i18n.ts._initialTutorial._pairRecruitment.step3 }}</b>
			<span>{{ i18n.ts._initialTutorial._pairRecruitment.step3Description }}</span>
		</div>
	</div>
	<div :class="$style.divider"></div>
	<div style="text-align: center; padding: 0 16px;"><i class="ti ti-users-group"></i> {{ i18n.ts._initialTutorial._pairRecruitment.whereToOpen }}</div>
</div>
</template>

<script setup lang="ts">
import * as Misskey from 'misskey-js';
import { ref } from 'vue';
import MkButton from '@/components/MkButton.vue';
import MkPairProjectStateBadge from '@/components/MkPairProjectStateBadge.vue';
import MkPairRecruitmentSlots from '@/components/MkPairRecruitmentSlots.vue';
import { i18n } from '@/i18n.js';

// 42 の課題名なので翻訳しない
const exampleProjectName = 'ft_irc';

// MkTutorialDialog.Note.vue の例のノートと同じ人
const exampleUser: Misskey.entities.UserLite = {
	id: '0000000001',
	name: '藍',
	username: 'ai',
	host: null,
	avatarDecorations: [],
	avatarUrl: '/client-assets/tutorial/ai.webp',
	avatarBlurhash: 'eiKmhHIByXxZ~qWXs:-pR*NbR*s:xuRjoL-oR*WCt6WWf6WVf6oeWB',
	isBot: false,
	isCat: true,
	emojis: {},
	onlineStatus: 'unknown',
	badgeRoles: [],
};

const joined = ref(false);
</script>

<style lang="scss" module>
.card {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 16px 20px;
	border: solid 0.5px var(--MI_THEME-divider);
	border-radius: 8px;
	background: var(--MI_THEME-panel);
}

.row1 {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
}

.project {
	font-size: 1.15em;
}

.state {
	margin-left: auto;
}

.who {
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 0;
	font-size: 0.9em;
}

.avatar {
	width: 28px;
	height: 28px;
	flex: none;
}

.name {
	font-weight: bold;
}

.sub {
	min-width: 0;
	opacity: 0.7;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.comment {
	line-height: 1.5;
	overflow-wrap: anywhere;
}

.row3 {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 12px;
	font-size: 0.9em;
}

.meta {
	display: flex;
	align-items: center;
	gap: 4px;
	opacity: 0.75;
}

.action {
	margin-left: auto;
}

.myStatus {
	color: var(--MI_THEME-accent);
	font-weight: bold;
}

.hint {
	text-align: center;
	font-size: 0.9em;
}

.steps {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
	gap: 8px;
}

.step {
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 10px 12px;
	border-radius: 8px;
	background: var(--MI_THEME-buttonBg);
	font-size: 0.9em;

	> b {
		color: var(--MI_THEME-accent);
	}
}

.divider {
	height: 1px;
	background: var(--MI_THEME-divider);
}
</style>
