<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="440"
	:height="680"
	@close="dialog?.close()"
	@closed="emit('closed')"
>
	<template #header>{{ i18n.ts._pairRecruitment.inviteTitle }}</template>

	<div class="_spacer" style="--MI_SPACER-min: 16px; --MI_SPACER-max: 20px;">
		<div class="_gaps_s">
			<MkTab v-if="recruitment.projects.length > 1" v-model="projectTab" :tabs="projectTabs"/>
			<MkInput v-model="query" type="search" :debounce="true" :placeholder="i18n.ts._pairRecruitment.searchInvitees">
				<template #prefix><i class="ti ti-search"></i></template>
			</MkInput>
			<MkError v-if="fetchError" @retry="fetchCandidates()"/>
			<MkLoading v-else-if="candidates == null"/>
			<MkResult v-else-if="candidates.length === 0" type="empty"/>
			<div v-else :class="$style.rows">
				<button
					v-for="c in candidates"
					:key="c.user.id"
					type="button"
					role="checkbox"
					class="_button"
					:class="$style.row"
					:aria-checked="selected.has(c.user.id)"
					:disabled="sending"
					@click="toggle(c.user.id)"
				>
					<span :class="[$style.checkbox, { [$style.checked]: selected.has(c.user.id) }]" aria-hidden="true">
						<i v-if="selected.has(c.user.id)" class="ti ti-check"></i>
					</span>
					<MkAvatar :user="c.user" :class="$style.avatar"/>
					<span :class="$style.rowBody">
						<b :class="$style.rowName"><MkUserName :user="c.user"/></b>
						<span :class="$style.chips">
							<span v-for="slug in c.projectSlugs" :key="slug" :class="$style.chip">{{ projectName(slug) }}</span>
						</span>
					</span>
				</button>
			</div>
		</div>
	</div>

	<template #footer>
		<div class="_buttons" :class="$style.footer">
			<MkButton rounded @click="dialog?.close()">{{ i18n.ts.cancel }}</MkButton>
			<MkButton primary rounded :wait="sending" :disabled="selected.size === 0 || sending" @click="send">
				<i class="ti ti-send"></i> {{ i18n.tsx._pairRecruitment.sendInvitations({ n: selected.size }) }}
			</MkButton>
		</div>
	</template>
</MkModalWindow>
</template>

<script lang="ts" setup>
// 同じキャンパスで募集の課題に取り組める人を探して招待するダイアログ。招待を受け取らない設定の人は出ない。
// 送れたら done で更新後の募集を返す。開くときは utility/pair-recruitment-dialog.ts の openPairInviteDialog を使う
import { computed, ref, shallowRef, useTemplateRef, watch } from 'vue';
import type * as Misskey from 'misskey-js';
import type { Tab } from '@/components/MkTab.vue';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkTab from '@/components/MkTab.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { showPairRecruitmentError } from '@/utility/pair-recruitment-action.js';

/** 1 回に送れる人数 (バックエンドの pair-recruitments/invite の上限) */
const MAX_INVITEES = 10;

const props = defineProps<{
	recruitment: Misskey.entities.PairRecruitmentDetailed;
}>();

const emit = defineEmits<{
	(ev: 'done', recruitment: Misskey.entities.PairRecruitmentDetailed): void;
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');

const ALL = '__all__';
const projectTab = ref(ALL);
const projectTabs = computed<Tab[]>(() => [
	{ key: ALL, label: i18n.ts._pairRecruitment.inviteAll },
	...props.recruitment.projects.map(p => ({ key: p.slug, label: p.name })),
]);

const query = ref('');
const candidates = shallowRef<Misskey.entities.PairInviteCandidate[] | null>(null);
// 検索は入力のたびに取り直すので、失敗はダイアログではなくこの場に出す
const fetchError = ref(false);
const selected = ref(new Set<string>());
const sending = ref(false);

function projectName(slug: string): string {
	return props.recruitment.projects.find(p => p.slug === slug)?.name ?? slug;
}

let requestSeq = 0;

async function fetchCandidates() {
	const seq = ++requestSeq;
	candidates.value = null;
	fetchError.value = false;
	try {
		const res = await misskeyApi('pair-recruitments/invite-candidates', {
			recruitmentId: props.recruitment.id,
			projectSlug: projectTab.value === ALL ? null : projectTab.value,
			query: query.value.trim() === '' ? null : query.value.trim(),
		});
		if (seq === requestSeq) candidates.value = res;
	} catch (err) {
		if (seq !== requestSeq) return;
		candidates.value = [];
		fetchError.value = true;
	}
}

watch([projectTab, query], fetchCandidates, { immediate: true });

function toggle(userId: string) {
	const next = new Set(selected.value);
	if (next.has(userId)) {
		next.delete(userId);
	} else {
		if (next.size >= MAX_INVITEES) return;
		next.add(userId);
	}
	selected.value = next;
}

async function send() {
	if (sending.value || selected.value.size === 0) return;
	sending.value = true;
	try {
		const updated = await misskeyApi('pair-recruitments/invite', {
			recruitmentId: props.recruitment.id,
			userIds: [...selected.value],
		});
		os.toast(i18n.ts._pairRecruitment.invitationsSent);
		emit('done', updated);
		dialog.value?.close();
	} catch (err) {
		showPairRecruitmentError(err);
	} finally {
		sending.value = false;
	}
}
</script>

<style lang="scss" module>
.rows {
	display: flex;
	flex-direction: column;
	border-radius: 8px;
	overflow: clip;
	background: var(--MI_THEME-panel);
}

.row {
	display: flex;
	align-items: center;
	gap: 12px;
	min-height: 56px;
	padding: 10px 14px;
	text-align: left;

	& + & {
		border-top: solid 0.5px var(--MI_THEME-divider);
	}

	&:not(:disabled):hover {
		background: var(--MI_THEME-panelHighlight);
	}
}

.avatar {
	flex: none;
	width: 34px;
	height: 34px;
}

.rowBody {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 4px;
	font-size: 0.9em;
}

.rowName {
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.chips {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
}

.chip {
	padding: 1px 8px;
	border-radius: 6px;
	font-size: 0.85em;
	font-weight: bold;
	color: var(--MI_THEME-accent);
	background: var(--MI_THEME-accentedBg);
}

.checkbox {
	flex: none;
	width: 20px;
	height: 20px;
	display: grid;
	place-items: center;
	box-sizing: border-box;
	border: solid 2px var(--MI_THEME-divider);
	border-radius: 5px;
	font-size: 14px;
	color: var(--MI_THEME-fgOnAccent);

	&.checked {
		border-color: var(--MI_THEME-accent);
		background: var(--MI_THEME-accent);
	}
}

.footer {
	justify-content: flex-end;
}
</style>
