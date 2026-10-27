<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_gaps">
	<div style="text-align: center; padding: 0 16px;">{{ i18n.ts._initialTutorial._projectShare.description }}</div>
	<div class="_gaps_s">
		<!-- 練習用の課題の行とカード (点数を共有の画面・ノートと同じ見た目)。API は呼ばない -->
		<div class="_panel" :class="$style.row">
			<MkIntraProjectResultTile :finalMark="exampleResult.finalMark" :validated="exampleResult.validated" small/>
			<b :class="$style.name">{{ exampleResult.projectName }}</b>
			<MkIntraProjectResultStars :count="exampleResult.outstandingCount ?? 0"/>
			<MkButton primary rounded small :disabled="posted" @click="posted = true">{{ i18n.ts._intraProjectResult.post }}</MkButton>
		</div>
		<MkIntraProjectResult v-if="posted" :result="exampleResult"/>
		<div v-if="posted" :class="$style.hint"><b style="color: var(--MI_THEME-accent);"><i class="ti ti-check"></i> {{ i18n.ts._initialTutorial.wellDone }}</b> {{ i18n.ts._initialTutorial._projectShare.posted }}</div>
		<div v-else :class="$style.hint">{{ i18n.ts._initialTutorial._projectShare.tryPosting }}</div>
	</div>
	<div :class="$style.steps">
		<div :class="$style.step">
			<b>1. {{ i18n.ts._initialTutorial._projectShare.step1 }}</b>
			<span>{{ i18n.ts._initialTutorial._projectShare.step1Description }}</span>
		</div>
		<div :class="$style.step">
			<b>2. {{ i18n.ts._initialTutorial._projectShare.step2 }}</b>
			<span>{{ i18n.ts._initialTutorial._projectShare.step2Description }}</span>
		</div>
		<div :class="$style.step">
			<b>3. {{ i18n.ts._initialTutorial._projectShare.step3 }}</b>
			<span>{{ i18n.ts._initialTutorial._projectShare.step3Description }}</span>
		</div>
	</div>
	<div :class="$style.divider"></div>
	<div style="text-align: center; padding: 0 16px;"><i class="ti ti-trophy"></i> {{ i18n.ts._initialTutorial._projectShare.whereToOpen }}</div>
</div>
</template>

<script setup lang="ts">
import type * as Misskey from 'misskey-js';
import { ref } from 'vue';
import MkButton from '@/components/MkButton.vue';
import MkIntraProjectResult from '@/components/MkIntraProjectResult.vue';
import MkIntraProjectResultTile from '@/components/MkIntraProjectResultTile.vue';
import MkIntraProjectResultStars from '@/components/MkIntraProjectResultStars.vue';
import { i18n } from '@/i18n.js';

// 42 の課題名とログイン名なので翻訳しない
const exampleResult: Misskey.entities.IntraProjectNote = {
	projectSlug: 'webserv',
	projectName: 'webserv',
	finalMark: 125,
	validated: true,
	outstandingCount: 2,
	members: [
		// 練習なのでプロフィールには飛ばない (アカウントが無いメンバーと同じ見た目にする)
		{ login: 'ai', user: null },
		{ login: 'marvin', user: null },
	],
	attemptNumber: null,
	attemptCount: null,
	markedAt: null,
	intraLogin: null,
};

const posted = ref(false);
</script>

<style lang="scss" module>
.row {
	display: flex;
	align-items: center;
	gap: 10px;
	min-height: 48px;
	padding: 8px 14px;
}

.name {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	// intra の課題の名前の色
	color: #00898b;
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
