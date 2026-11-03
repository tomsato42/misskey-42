<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.container">
<div :class="$style.root">
	<MkInput v-model="title" :class="$style.full" :disabled="disabled" :autofocus="autofocus">
		<template #label>{{ i18n.ts._calendar.eventTitle }}</template>
		<template v-if="errors.title" #caption><span :class="$style.error" role="alert"><i class="ti ti-alert-triangle"></i> {{ getCalendarEventValidationMessage(errors.title) }}</span></template>
	</MkInput>

	<MkInput v-model="date" type="date" :disabled="disabled">
		<template #label>{{ i18n.ts._calendar.date }}</template>
		<template v-if="errors.date" #caption><span :class="$style.error" role="alert"><i class="ti ti-alert-triangle"></i> {{ getCalendarEventValidationMessage(errors.date) }}</span></template>
	</MkInput>
	<div :class="$style.allDay">
		<MkSwitch v-model="isAllDay" :disabled="disabled">{{ i18n.ts._calendar.allDay }}</MkSwitch>
	</div>

	<template v-if="!isAllDay">
		<MkInput v-model="startTime" type="time" :disabled="disabled">
			<template #label>{{ i18n.ts._calendar.startTime }}</template>
			<template v-if="errors.startTime" #caption><span :class="$style.error" role="alert"><i class="ti ti-alert-triangle"></i> {{ getCalendarEventValidationMessage(errors.startTime) }}</span></template>
		</MkInput>
		<MkInput v-model="endTime" type="time" :disabled="disabled">
			<template #label>{{ i18n.ts._calendar.endTime }}</template>
			<template #caption>
				<span v-if="errors.endTime" :class="$style.error" role="alert"><i class="ti ti-alert-triangle"></i> {{ getCalendarEventValidationMessage(errors.endTime) }}</span>
				<span v-else>{{ i18n.ts._calendar.endTimeDescription }}</span>
			</template>
		</MkInput>
	</template>

	<MkInput v-model="location" :disabled="disabled">
		<template #label>{{ i18n.ts.location }}</template>
		<template v-if="errors.location" #caption><span :class="$style.error" role="alert"><i class="ti ti-alert-triangle"></i> {{ getCalendarEventValidationMessage(errors.location) }}</span></template>
	</MkInput>
	<MkInput v-model="hashtag" :disabled="disabled" autocapitalize="off" :spellcheck="false">
		<template #label>{{ i18n.ts._calendar.hashtag }}</template>
		<template #prefix>#</template>
		<template #caption>
			<span v-if="errors.hashtag" :class="$style.error" role="alert"><i class="ti ti-alert-triangle"></i> {{ getCalendarEventValidationMessage(errors.hashtag) }}</span>
			<span v-else>{{ i18n.ts._calendar.hashtagDescription }}</span>
		</template>
	</MkInput>

	<MkTextarea v-if="withDescription" v-model="description" :class="$style.full" :disabled="disabled" mfmAutocomplete :mfmPreview="true">
		<template #label>{{ i18n.ts.description }}</template>
		<template v-if="errors.description" #caption><span :class="$style.error" role="alert"><i class="ti ti-alert-triangle"></i> {{ getCalendarEventValidationMessage(errors.description) }}</span></template>
	</MkTextarea>

	<div :class="$style.full">
		<div :id="visibilityLabelId" :class="$style.label">{{ visibilityLabel ?? i18n.ts._calendar.visibility }}</div>
		<button
			ref="visibilityButton"
			type="button"
			class="_button"
			:class="$style.visibilityButton"
			:aria-labelledby="`${visibilityLabelId} ${visibilityValueId}`"
			aria-haspopup="menu"
			:disabled="disabled"
			@click="openVisibilityPicker"
		>
			<i :class="[getCalendarVisibilityIcon(visibility), $style.visibilityIcon]" aria-hidden="true"></i>
			<span :id="visibilityValueId" :class="$style.visibilityText">
				<b>{{ getCalendarVisibilityLabel(visibility) }}</b>
				<small>{{ getCalendarVisibilityDescription(visibility) }}</small>
			</span>
			<i class="ti ti-chevron-down" :class="$style.visibilityChevron" aria-hidden="true"></i>
		</button>

		<div v-if="visibility === 'specified'" :class="$style.invitees">
			<span :class="$style.inviteesLabel">{{ i18n.ts._calendar.invitees }}</span>
			<div :class="$style.inviteeList">
				<span v-for="user in visibleUsers" :key="user.id" :class="$style.invitee">
					<MkAvatar :user="user" :class="$style.inviteeAvatar"/>
					<MkAcct :user="user"/>
					<button type="button" class="_button" :class="$style.inviteeRemove" :aria-label="i18n.tsx._calendar.removeInvitee({ user: `@${user.username}` })" :disabled="disabled" @click="removeVisibleUser(user.id)"><i class="ti ti-x"></i></button>
				</span>
				<button v-tooltip="i18n.ts._calendar.addInvitee" type="button" class="_button" :class="$style.inviteeAdd" :aria-label="i18n.ts._calendar.addInvitee" :disabled="disabled" @click="addVisibleUser"><i class="ti ti-user-plus"></i></button>
			</div>
		</div>

		<div v-else-if="visibility === 'list'" :class="$style.listField">
			<MkSelect v-if="userLists != null && userLists.length > 0" v-model="userListId" :items="userListItems" :disabled="disabled" :placeholder="i18n.ts._calendar.selectUserList">
				<template #label>{{ i18n.ts._calendar.userList }}</template>
			</MkSelect>
			<span v-else-if="userLists != null" :class="$style.listEmpty">{{ i18n.ts._calendar.noUserLists }}</span>
			<MkLoading v-else :em="true"/>
		</div>

		<div :class="$style.caption">
			<span v-if="errors.visibility" :class="$style.error" role="alert"><i class="ti ti-alert-triangle"></i> {{ getCalendarEventValidationMessage(errors.visibility) }}</span>
			<template v-else>
				<span :class="{ [$style.inviteNotice]: visibility === 'specified' || visibility === 'list' }">
					<i :class="visibility === 'specified' || visibility === 'list' ? 'ti ti-bell' : 'ti ti-info-circle'" aria-hidden="true"></i> {{ visibilityCaption }}
				</span>
				<!-- 指定ユーザー・リスト以外では、作ったあとに招待できることを添える -->
				<span v-if="!editing && visibility !== 'specified' && visibility !== 'list'" :class="$style.captionLine">{{ i18n.ts._calendar.inviteFromEventPage }}</span>
			</template>
		</div>
	</div>
</div>
</div>
</template>

<script lang="ts" setup>
// イベントの入力欄。値は v-model (CalendarEventFormValue) でやり取りし、送信や API の呼び出しは使う側が行う。
// カレンダーの作成・編集ダイアログ (MkCalendarEventEditDialog) と、投稿フォームの「イベントを告知」の欄で使う
import { computed, defineAsyncComponent, ref, useId, useTemplateRef, watch } from 'vue';
import * as Misskey from 'misskey-js';
import type { WritableComputedRef } from 'vue';
import type { CalendarEventFormErrors, CalendarEventFormValue } from '@/utility/calendar-event-form.js';
import MkInput from '@/components/MkInput.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { getCalendarApiErrorMessage, getCalendarEventValidationMessage, getCalendarVisibilityDescription, getCalendarVisibilityLabel } from '@/utility/calendar-event-messages.js';
import { getCalendarVisibilityIcon } from '@/utility/calendar-visibility.js';

const model = defineModel<CalendarEventFormValue>({ required: true });

const props = withDefaults(defineProps<{
	/** 欄ごとの検証エラー。欄の下に文言を出す */
	errors?: CalendarEventFormErrors;
	/** 説明の欄を出すか。投稿フォームではノートの本文が説明になるので出さない */
	withDescription?: boolean;
	/** 公開範囲の欄の見出し。省略すると「公開範囲」 */
	visibilityLabel?: string;
	/** 既存のイベントを編集しているか (公開範囲の欄の注意書きを変える) */
	editing?: boolean;
	disabled?: boolean;
	autofocus?: boolean;
}>(), {
	errors: () => ({}),
	withDescription: true,
	editing: false,
	disabled: false,
	autofocus: false,
});

// 親から受け取ったオブジェクトを直接書き換えず、項目を差し替えた新しいオブジェクトを返す
function field<K extends keyof CalendarEventFormValue>(key: K): WritableComputedRef<CalendarEventFormValue[K]> {
	return computed({
		get: () => model.value[key],
		set: (value) => {
			model.value = { ...model.value, [key]: value };
		},
	});
}

const title = field('title');
const date = field('date');
const startTime = field('startTime');
const endTime = field('endTime');
const isAllDay = field('isAllDay');
const location = field('location');
const hashtag = field('hashtag');
const description = field('description');
const visibility = field('visibility');
const visibleUsers = field('visibleUsers');
const userListId = field('userListId');

const visibilityLabelId = useId();
const visibilityValueId = useId();
const visibilityButton = useTemplateRef('visibilityButton');

function openVisibilityPicker() {
	const { dispose } = os.popup(defineAsyncComponent(() => import('@/components/MkCalendarVisibilityPicker.vue')), {
		currentVisibility: visibility.value,
		anchorElement: visibilityButton.value,
	}, {
		changeVisibility: v => {
			visibility.value = v;
		},
		closed: () => dispose(),
	});
}

async function addVisibleUser() {
	const user = await os.selectUser({ localOnly: true });
	if (visibleUsers.value.some(u => u.id === user.id)) return;
	visibleUsers.value = [...visibleUsers.value, user];
}

function removeVisibleUser(id: string) {
	visibleUsers.value = visibleUsers.value.filter(u => u.id !== id);
}

/** 自分のリスト。公開範囲をリストにしたときに初めて読み込む */
const userLists = ref<Misskey.entities.UserList[] | null>(null);

watch(visibility, async (value) => {
	if (value !== 'list' || userLists.value != null) return;
	let lists: Misskey.entities.UserList[];
	try {
		lists = await misskeyApi('users/lists/list');
	} catch (err) {
		userLists.value = [];
		os.alert({ type: 'error', ...getCalendarApiErrorMessage(err) });
		return;
	}
	userLists.value = lists;
	// リストを選んでいなければ、最初のリストを選んでおく
	if (model.value.visibility === 'list' && model.value.userListId == null && lists.length > 0) userListId.value = lists[0].id;
}, { immediate: true });

const userListItems = computed(() => (userLists.value ?? []).map(list => ({
	label: i18n.tsx._calendar.listWithCount({ name: list.name, n: list.userIds?.length ?? 0 }),
	value: list.id,
})));

const selectedListMembersCount = computed(() => userLists.value?.find(l => l.id === userListId.value)?.userIds?.length ?? 0);

const visibilityCaption = computed(() => {
	const t = i18n.ts._calendar;
	switch (visibility.value) {
		case 'public': return t.visibilityPublicCaption;
		case 'followers': return t.visibilityFollowersCaption;
		case 'mutual': return t.visibilityMutualCaption;
		case 'specified': return props.editing ? t.willInviteNewAudience : i18n.tsx._calendar.willInviteUsers({ n: visibleUsers.value.length });
		case 'list': return props.editing ? t.willInviteNewAudience : i18n.tsx._calendar.willInviteListMembers({ n: selectedListMembersCount.value });
	}
});
</script>

<style lang="scss" module>
.container {
	// 狭い場所 (スマホの投稿フォームなど) では 1 列にする
	container-type: inline-size;
}

.root {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 16px 12px;
	align-items: start;
}

.full {
	grid-column: 1 / -1;
}

.allDay {
	// 日付の欄の入力部分と高さをそろえる (ラベルの分だけ下げる)
	align-self: end;
	min-height: 36px;
	display: flex;
	align-items: center;
}

.error {
	color: var(--MI_THEME-error);
}

// 公開範囲の欄は MkInput / MkSelect のラベル・注意書きと同じ見た目にする
.label {
	font-size: 0.85em;
	padding: 0 0 8px 0;
	user-select: none;
}

.caption {
	font-size: 0.85em;
	padding: 8px 0 0 0;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.75);
}

.inviteNotice {
	color: var(--MI_THEME-accent);
}

.captionLine {
	display: block;
	margin-top: 2px;
}

.visibilityButton {
	display: flex;
	align-items: center;
	gap: 12px;
	width: 100%;
	min-height: 48px;
	padding: 6px 12px;
	box-sizing: border-box;
	text-align: left;
	background: var(--MI_THEME-panel);
	border: solid 1px var(--MI_THEME-panel);
	border-radius: 6px;
	transition: border-color 0.1s ease-out;

	&:hover {
		border-color: var(--MI_THEME-inputBorderHover);
	}

	&:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}
}

.visibilityIcon {
	flex: none;
	font-size: 1.2em;
	color: var(--MI_THEME-accent);
}

.visibilityText {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;

	> small {
		opacity: 0.7;
	}
}

.visibilityChevron {
	flex: none;
	opacity: 0.6;
}

.invitees {
	display: flex;
	align-items: flex-start;
	gap: 10px;
	margin-top: 8px;
	padding: 8px 10px;
	border-radius: 6px;
	background: var(--MI_THEME-panel);
}

.inviteesLabel {
	flex: none;
	font-size: 0.85em;
	line-height: 28px;
	opacity: 0.7;
}

.inviteeList {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	min-width: 0;
}

.invitee {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	height: 28px;
	padding: 0 2px 0 3px;
	border-radius: 999px;
	font-size: 0.85em;
	background: var(--MI_THEME-buttonBg);
}

.inviteeAvatar {
	width: 22px;
	height: 22px;
}

.inviteeRemove,
.inviteeAdd {
	display: grid;
	place-items: center;
	border-radius: 999px;

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
	}
}

.inviteeRemove {
	width: 22px;
	height: 22px;
	font-size: 0.85em;
}

.inviteeAdd {
	width: 28px;
	height: 28px;
	background: var(--MI_THEME-buttonBg);
}

.listField {
	margin-top: 12px;
}

.listEmpty {
	display: block;
	font-size: 0.9em;
	opacity: 0.8;
}

@container (max-width: 320px) {
	.root {
		grid-template-columns: minmax(0, 1fr);
	}
}
</style>
