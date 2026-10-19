<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="420"
	:height="680"
	@close="dialog?.close()"
	@closed="emit('closed')"
>
	<template #header>{{ i18n.ts._calendar.inviteToEvent }}</template>

	<div class="_spacer" style="--MI_SPACER-min: 16px; --MI_SPACER-max: 20px;">
		<div class="_gaps_s">
			<div :class="$style.event">
				<div :class="$style.dateBox" aria-hidden="true">
					<span>{{ i18n.tsx.monthX({ month: eventDate.month }) }}</span>
					<b>{{ eventDate.day }}</b>
					<span>{{ getWeekdayShortLabel(eventDayOfWeek) }}</span>
				</div>
				<div :class="$style.eventInfo">
					<b :class="$style.eventTitle">{{ event.title }}</b>
					<small :class="$style.eventMeta">{{ formatCalendarScheduleAndLocation(event) }}</small>
				</div>
			</div>

			<MkInfo v-if="event.visibility !== 'public'">{{ i18n.tsx._calendar.inviteLimitedNotice({ visibility: getCalendarVisibilityLabel(event.visibility) }) }}</MkInfo>

			<MkTab v-model="tab" :tabs="tabs"/>

			<template v-if="tab === 'users'">
				<MkInput v-model="query" type="search" :debounce="true" :placeholder="i18n.ts._calendar.searchUsers">
					<template #prefix><i class="ti ti-search"></i></template>
				</MkInput>
				<div :class="$style.sectionLabel">{{ query.trim() === '' ? i18n.ts._calendar.followingUsers : i18n.ts.searchResult }}</div>
				<MkLoading v-if="users == null"/>
				<MkResult v-else-if="users.length === 0" type="empty"/>
				<div v-else :class="$style.rows">
					<button
						v-for="user in users"
						:key="user.id"
						type="button"
						role="checkbox"
						class="_button"
						:class="[$style.row, { [$style.unselectable]: !isInvitable(user.id) }]"
						:aria-checked="selected.has(user.id)"
						:disabled="!isInvitable(user.id) || sending"
						@click="toggleUser(user)"
					>
						<MkAvatar :user="user" :class="$style.avatar"/>
						<span :class="$style.rowBody">
							<b :class="$style.rowName"><MkUserName :user="user"/></b>
							<span :class="$style.rowSub" class="_monospace">@{{ acct(user) }}</span>
						</span>
						<span v-if="statusLabel(user.id) != null" :class="$style.status">{{ statusLabel(user.id) }}</span>
						<span v-else-if="statuses.has(user.id)" :class="[$style.checkbox, { [$style.checked]: selected.has(user.id) }]" aria-hidden="true">
							<i v-if="selected.has(user.id)" class="ti ti-check"></i>
						</span>
					</button>
				</div>
			</template>

			<template v-else>
				<div :class="$style.sectionLabel">{{ i18n.ts._calendar.yourLists }}</div>
				<MkLoading v-if="userLists == null"/>
				<MkResult v-else-if="userLists.length === 0" type="empty" :text="i18n.ts._calendar.noUserLists"/>
				<div v-else :class="$style.rows">
					<button
						v-for="list in userLists"
						:key="list.id"
						type="button"
						class="_button"
						:class="$style.row"
						:aria-pressed="selectedListId === list.id"
						:disabled="sending"
						@click="selectList(list.id)"
					>
						<span :class="[$style.radio, { [$style.checked]: selectedListId === list.id }]" aria-hidden="true"></span>
						<i class="ti ti-list" :class="$style.listIcon" aria-hidden="true"></i>
						<span :class="$style.rowBody">
							<b :class="$style.rowName">{{ list.name }}</b>
							<span :class="$style.rowSub">{{ i18n.tsx._calendar.usersCount({ n: list.userIds?.length ?? 0 }) }}</span>
						</span>
					</button>
				</div>
				<div v-if="listPreview != null" :class="$style.breakdown">
					<div><span>{{ i18n.ts._calendar.inviteBreakdownSubscribed }}</span><span>{{ i18n.tsx._calendar.usersCount({ n: listPreview.subscribed }) }}</span></div>
					<div><span>{{ i18n.ts._calendar.inviteBreakdownInvited }}</span><span>{{ i18n.tsx._calendar.usersCount({ n: listPreview.alreadyInvited }) }}</span></div>
					<div><span>{{ i18n.ts._calendar.inviteBreakdownUnavailable }}</span><span>{{ i18n.tsx._calendar.usersCount({ n: listPreview.unavailable }) }}</span></div>
					<div :class="$style.breakdownTotal"><span>{{ i18n.ts._calendar.inviteBreakdownSend }}</span><span>{{ i18n.tsx._calendar.usersCount({ n: listPreview.invited }) }}</span></div>
				</div>
			</template>

			<div :class="$style.notice">{{ i18n.ts._calendar.inviteNotice }}</div>
		</div>
	</div>

	<template #footer>
		<div :class="$style.footer">
			<span :class="$style.summary">{{ inviteCount > 0 ? i18n.tsx._calendar.willSendInvites({ n: inviteCount }) : tab === 'users' ? i18n.ts._calendar.selectInvitees : i18n.ts._calendar.selectUserList }}</span>
			<MkButton primary rounded :wait="sending" :disabled="inviteCount === 0 || sending" @click="send">
				<i class="ti ti-send"></i> {{ i18n.ts._calendar.sendInvites }}
			</MkButton>
		</div>
	</template>
</MkModalWindow>
</template>

<script lang="ts" setup>
// イベントに招待するダイアログ。ユーザー (フォローしている人と検索) か、自分のリストのメンバーに送る。
// 送れたら done で送った数を返す。開くときは utility/calendar-event-dialog.ts の openCalendarEventInviteDialog を使う
import { computed, ref, shallowRef, useTemplateRef, watch } from 'vue';
import * as Misskey from 'misskey-js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkInput from '@/components/MkInput.vue';
import MkTab from '@/components/MkTab.vue';
import type { Tab } from '@/components/MkTab.vue';
import * as os from '@/os.js';
import { ensureSignin } from '@/i.js';
import { i18n } from '@/i18n.js';
import { acct } from '@/filters/user.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { dayOfWeek, parseCalendarDate } from '@/utility/calendar.js';
import { formatCalendarScheduleAndLocation, getCalendarApiErrorMessage, getCalendarVisibilityLabel, getWeekdayShortLabel } from '@/utility/calendar-event-messages.js';

type InvitationStatus = Misskey.Endpoints['calendar/events/invitation-statuses']['res'][number]['status'];
type InviteResult = Misskey.Endpoints['calendar/events/invite']['res'];

const props = defineProps<{
	event: Misskey.entities.CalendarEvent;
}>();

const emit = defineEmits<{
	(ev: 'done', invited: number): void;
	(ev: 'closed'): void;
}>();

const $i = ensureSignin();

const dialog = useTemplateRef('dialog');

const eventDate = computed(() => parseCalendarDate(props.event.date) ?? { year: 0, month: 0, day: 0 });
const eventDayOfWeek = computed(() => parseCalendarDate(props.event.date) != null ? dayOfWeek(props.event.date) : 0);

const tab = ref<'users' | 'list'>('users');
const tabs: Tab<'users' | 'list'>[] = [{
	key: 'users',
	label: i18n.ts._calendar.inviteUsers,
	icon: 'ti ti-user',
}, {
	key: 'list',
	label: i18n.ts._calendar.inviteList,
	icon: 'ti ti-list',
}];

const sending = ref(false);

function showError(err: unknown) {
	os.alert({ type: 'error', ...getCalendarApiErrorMessage(err) });
}

//#region ユーザー

const query = ref('');
/** 出しているユーザー (検索語が無いときはフォローしている人)。読み込み中は null */
const users = shallowRef<Misskey.entities.UserLite[] | null>(null);
/** ユーザーごとの招待の状態。検索し直しても前の状態は残す */
const statuses = ref(new Map<string, InvitationStatus>());
/** 選んだユーザー。検索し直しても選んだままにする */
const selected = ref(new Map<string, Misskey.entities.UserLite>());
let loadCount = 0;

async function loadUsers() {
	const id = ++loadCount;
	users.value = null;
	const q = query.value.trim();
	try {
		const found: Misskey.entities.UserLite[] = q === ''
			? (await misskeyApi('users/following', { userId: $i.id, limit: 50 })).map(f => f.followee).filter(u => u != null)
			: await misskeyApi('users/search', { query: q, origin: 'local', limit: 30, detail: false });
		const unknownIds = found.map(u => u.id).filter(userId => !statuses.value.has(userId));
		if (unknownIds.length > 0) {
			const res = await misskeyApi('calendar/events/invitation-statuses', { eventId: props.event.id, userIds: unknownIds });
			for (const s of res) statuses.value.set(s.userId, s.status);
		}
		if (id !== loadCount) return;
		users.value = found;
	} catch (err) {
		if (id !== loadCount) return;
		users.value = [];
		showError(err);
	}
}

watch(query, loadUsers, { immediate: true });

function isInvitable(userId: string): boolean {
	return statuses.value.get(userId) === 'invitable';
}

function statusLabel(userId: string): string | null {
	switch (statuses.value.get(userId)) {
		case 'subscribed': return i18n.ts._calendar.inviteStatusSubscribed;
		case 'invited': return i18n.ts._calendar.inviteStatusInvited;
		case 'unavailable': return i18n.ts._calendar.inviteStatusUnavailable;
		default: return null;
	}
}

function toggleUser(user: Misskey.entities.UserLite) {
	if (!isInvitable(user.id)) return;
	if (selected.value.has(user.id)) {
		selected.value.delete(user.id);
	} else {
		selected.value.set(user.id, user);
	}
}

//#endregion

//#region リスト

const userLists = shallowRef<Misskey.entities.UserList[] | null>(null);
const selectedListId = ref<string | null>(null);
/** 選んだリストに送ったときの内訳 (dryRun の結果) */
const listPreview = ref<InviteResult | null>(null);

watch(tab, async (value) => {
	if (value !== 'list' || userLists.value != null) return;
	try {
		userLists.value = await misskeyApi('users/lists/list');
	} catch (err) {
		userLists.value = [];
		showError(err);
	}
});

async function selectList(listId: string) {
	selectedListId.value = listId;
	listPreview.value = null;
	try {
		const preview = await misskeyApi('calendar/events/invite', { eventId: props.event.id, userListId: listId, dryRun: true });
		if (selectedListId.value === listId) listPreview.value = preview;
	} catch (err) {
		showError(err);
	}
}

//#endregion

const inviteCount = computed(() => tab.value === 'users' ? selected.value.size : (listPreview.value?.invited ?? 0));

async function send() {
	if (sending.value || inviteCount.value === 0) return;
	sending.value = true;
	try {
		const result = await misskeyApi('calendar/events/invite', tab.value === 'users'
			? { eventId: props.event.id, userIds: [...selected.value.keys()] }
			: { eventId: props.event.id, userListId: selectedListId.value });
		emit('done', result.invited);
		dialog.value?.close();
	} catch (err) {
		showError(err);
	} finally {
		sending.value = false;
	}
}
</script>

<style lang="scss" module>
.event {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 10px 12px;
	border-radius: 8px;
	background: var(--MI_THEME-panel);
}

.dateBox {
	width: 40px;
	flex: none;
	text-align: center;
	border-radius: 8px;
	background: var(--MI_THEME-buttonBg);
	padding: 2px 0;
	font-size: 0.7em;
	line-height: 1.25;

	> b {
		display: block;
		font-size: 1.5em;
	}
}

.eventInfo {
	min-width: 0;
	display: flex;
	flex-direction: column;
}

.eventTitle,
.eventMeta {
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.eventMeta {
	opacity: 0.75;
}

.sectionLabel {
	font-size: 0.85em;
	opacity: 0.7;
}

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

	&:disabled {
		cursor: default;
	}
}

.unselectable {
	.avatar,
	.rowBody {
		opacity: 0.5;
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
	font-size: 0.9em;
}

.rowName,
.rowSub {
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.rowSub {
	font-size: 95%;
	opacity: 0.7;
}

.status {
	flex: none;
	padding: 2px 8px;
	border-radius: 999px;
	font-size: 0.75em;
	background: var(--MI_THEME-buttonBg);
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

.radio {
	flex: none;
	width: 20px;
	height: 20px;
	box-sizing: border-box;
	border: solid 2px var(--MI_THEME-divider);
	border-radius: 999px;

	&.checked {
		border-color: var(--MI_THEME-accent);
		box-shadow: inset 0 0 0 3px var(--MI_THEME-panel);
		background: var(--MI_THEME-accent);
	}
}

.listIcon {
	flex: none;
	opacity: 0.7;
}

.breakdown {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 12px 14px;
	border-radius: 8px;
	font-size: 0.85em;
	background: var(--MI_THEME-panel);

	> div {
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}
}

.breakdownTotal {
	padding-top: 6px;
	border-top: solid 0.5px var(--MI_THEME-divider);
	font-weight: bold;
}

.notice {
	font-size: 0.85em;
	opacity: 0.75;
}

.footer {
	display: flex;
	align-items: center;
	gap: 12px;
}

.summary {
	flex: 1;
	min-width: 0;
	font-size: 0.9em;
}
</style>
