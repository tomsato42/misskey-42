<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader v-model:tab="tab" :actions="headerActions" :tabs="headerTabs" :swipable="false">
	<div class="_spacer" style="--MI_SPACER-w: 1000px;">
		<div :class="$style.head">
			<MkButton small iconOnly :aria-label="i18n.ts._calendar.prevMonth" @click="goMonth(-1)"><i class="ti ti-chevron-left"></i></MkButton>
			<span :class="$style.month">{{ formatCalendarYearMonth(currentMonth) }}</span>
			<MkButton small iconOnly :aria-label="i18n.ts._calendar.nextMonth" @click="goMonth(1)"><i class="ti ti-chevron-right"></i></MkButton>
			<MkButton small rounded :disabled="currentMonth === todayMonth" @click="goToday">{{ i18n.ts.today }}</MkButton>
			<span :class="$style.grow"></span>
			<MkButton primary rounded :class="$style.create" @click="createEvent()"><i class="ti ti-plus"></i> {{ i18n.ts._calendar.createEvent }}</MkButton>
		</div>

		<MkInfo v-if="moderatorView" warn :class="$style.moderatorNotice">
			<span :class="$style.moderatorNoticeBody">
				<span>{{ i18n.ts._calendar.moderatorViewNotice }}</span>
				<MkButton small rounded @click="setCalendarModeratorView(false)">{{ i18n.ts._calendar.moderatorViewTurnOff }}</MkButton>
			</span>
		</MkInfo>

		<MkError v-if="error" @retry="fetchEvents()"/>

		<div class="_panel" :class="[$style.panel, { [$style.fetching]: fetching }]">
			<div :class="$style.grid">
				<div
					v-for="dow in 7"
					:key="`dow-${dow}`"
					:class="[$style.dow, { [$style.sunday]: dow === 1 }]"
					aria-hidden="true"
				>
					{{ getWeekdayShortLabel(dow - 1) }}
				</div>
				<!-- セルを押すとその日のイベントの一覧を出す。キーボードでは日付のボタンで同じ操作ができる -->
				<div
					v-for="day in days"
					:key="day.date"
					:class="[$style.cell, { [$style.out]: !day.inMonth, [$style.today]: day.date === today }]"
					@click="openDayMenu(day.date, $event)"
				>
					<button
						class="_button"
						:class="$style.dayNumber"
						:aria-label="formatCalendarDay(day.date)"
						@click.stop="openDayMenu(day.date, $event)"
					>
						{{ day.day }}
					</button>
					<MkA
						v-for="event in visibleEvents(day.date)"
						:key="event.id"
						:to="`/calendar/events/${event.id}`"
						:class="[$style.chip, { [$style.subscribed]: event.isSubscribed, [$style.canceled]: event.isCanceled }]"
						:title="chipTitle(event)"
						@click.stop
					>
						<span :class="$style.chipTime">{{ event.isAllDay ? i18n.ts._calendar.allDay : event.startTime }}</span>
						<i v-if="event.isOutsideVisibility" class="ti ti-shield-lock" :class="$style.chipVisibility" aria-hidden="true"></i>
						<i v-else-if="event.visibility !== 'public'" class="ti ti-lock" :class="$style.chipVisibility" aria-hidden="true"></i>
						<span>{{ event.title }}</span>
					</MkA>
					<button
						v-if="hiddenCount(day.date) > 0"
						class="_button"
						:class="$style.more"
						@click.stop="openDayMenu(day.date, $event)"
					>
						{{ i18n.tsx._calendar.moreEvents({ n: hiddenCount(day.date) }) }}
					</button>
				</div>
			</div>
		</div>

		<div :class="$style.legend">
			<span><i :class="[$style.legendMark, $style.subscribed]"></i>{{ i18n.ts._calendar.subscribed }}</span>
			<span><i :class="$style.legendMark"></i>{{ i18n.ts._calendar.notSubscribed }}</span>
			<span><i :class="[$style.legendMark, $style.canceled]"></i><s>{{ i18n.ts._calendar.canceled }}</s></span>
			<span><i class="ti ti-lock" aria-hidden="true"></i>{{ i18n.ts._calendar.restrictedVisibility }}</span>
			<span v-if="moderatorView"><i class="ti ti-shield-lock" aria-hidden="true"></i>{{ i18n.ts._calendar.outsideVisibility }}</span>
		</div>

		<!-- 表示している月のイベントを日付ごとに並べる。カレンダーと同じタブで絞り込む (スマホではこちらで中身を見る) -->
		<section :class="$style.monthList" :aria-labelledby="monthListTitleId">
			<div :class="$style.sectionLabel">
				<i class="ti ti-calendar-event" aria-hidden="true"></i>
				<h2 :id="monthListTitleId" :class="$style.sectionTitle">{{ i18n.tsx._calendar.monthEvents({ month: currentMonthNumber }) }}</h2>
				<span v-if="!fetching && !error" :class="$style.sectionCount">{{ i18n.tsx._calendar.eventsCount({ n: events.length }) }}</span>
			</div>

			<div v-if="dateGroups.length > 0" class="_panel" :class="[$style.monthPanel, { [$style.fetching]: fetching }]">
				<template v-for="group in dateGroups" :key="group.date">
					<div v-if="group.todayDividerBefore" :class="$style.todayDivider">
						<span>{{ i18n.tsx._calendar.todayWithDate({ date: formatCalendarDay(today) }) }}</span>
					</div>
					<div :class="[$style.dateGroup, { [$style.pastGroup]: group.isPast }]">
						<div :class="[$style.groupDate, { [$style.groupToday]: group.isToday, [$style.sunday]: dayOfWeek(group.date) === 0 }]" aria-hidden="true">
							<span :class="$style.groupDay">{{ parseCalendarDate(group.date)?.day }}</span>
							<span :class="$style.groupDow">{{ getWeekdayShortLabel(dayOfWeek(group.date)) }}</span>
						</div>
						<div :class="$style.groupEvents">
							<MkA
								v-for="event in group.events"
								:key="event.id"
								:to="`/calendar/events/${event.id}`"
								:class="$style.eventRow"
								:aria-label="eventRowLabel(event)"
							>
								<span :class="$style.eventTime">{{ formatCalendarEventTime(event) }}</span>
								<span :class="$style.eventBody">
									<b :class="[$style.eventTitle, { [$style.canceledTitle]: event.isCanceled }]">{{ event.title }}</b>
									<small :class="$style.eventMeta">
										<span v-if="event.location"><i class="ti ti-map-pin" aria-hidden="true"></i>{{ event.location }}</span>
										<span v-if="event.visibility !== 'public'"><i :class="getCalendarVisibilityIcon(event.visibility)" aria-hidden="true"></i>{{ getCalendarVisibilityLabel(event.visibility) }}</span>
										<span v-if="event.isOutsideVisibility" :class="$style.outside"><i class="ti ti-shield-lock" aria-hidden="true"></i>{{ i18n.ts._calendar.outsideVisibility }}</span>
										<span><i class="ti ti-users" aria-hidden="true"></i>{{ i18n.tsx._calendar.subscribersShort({ n: event.subscribersCount }) }}</span>
									</small>
								</span>
								<span :class="$style.eventBadges">
									<span v-if="event.isCanceled" :class="$style.canceledBadge">{{ i18n.ts._calendar.canceled }}</span>
									<span v-else-if="event.isSubscribed" :class="$style.subscribedBadge"><i class="ti ti-bell-ringing" aria-hidden="true"></i>{{ i18n.ts._calendar.subscribed }}</span>
									<i class="ti ti-chevron-right" :class="$style.eventChevron" aria-hidden="true"></i>
								</span>
							</MkA>
						</div>
					</div>
				</template>
			</div>
			<div v-else-if="!fetching && !error" class="_panel" :class="$style.monthEmpty">
				<MkResult type="empty" :text="i18n.ts._calendar.noEventsThisMonth"/>
				<MkButton rounded @click="createEvent()"><i class="ti ti-plus"></i> {{ i18n.ts._calendar.createEvent }}</MkButton>
			</div>
		</section>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, onActivated, ref, useId, watch } from 'vue';
import * as Misskey from 'misskey-js';
import type { MenuItem } from '@/types/menu.js';
import type { PageHeaderItem } from '@/types/page-header.js';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import * as os from '@/os.js';
import { iAmModerator } from '@/i.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { useRouter } from '@/router.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import {
	buildCalendarDateGroups,
	buildMonthGrid,
	calendarFilters,
	currentJstYearMonth,
	dayOfWeek,
	groupCalendarEventsByDate,
	parseCalendarDate,
	parseYearMonth,
	shiftYearMonth,
	toJstDateString,
} from '@/utility/calendar.js';
import type { CalendarFilter } from '@/utility/calendar.js';
import { formatCalendarDay, formatCalendarEventTime, formatCalendarYearMonth, getCalendarVisibilityLabel, getWeekdayShortLabel } from '@/utility/calendar-event-messages.js';
import { getCalendarVisibilityIcon } from '@/utility/calendar-visibility.js';
import { openCalendarEventEditDialog } from '@/utility/calendar-event-dialog.js';
import { calendarModeratorView as moderatorView, setCalendarModeratorView } from '@/utility/calendar-moderator-view.js';

/** セルに出すイベントの数。これより多い日は「他 N 件」にまとめる */
const MAX_CHIPS_PER_DAY = 3;

// 表示する月とタブは URL のクエリで持つ (変えると router.replace でページを開き直す)
const props = defineProps<{
	month?: string;
	filter?: string;
}>();

const router = useRouter();

const today = toJstDateString(new Date());
const todayMonth = currentJstYearMonth();
const currentMonth = computed(() => parseYearMonth(props.month) != null ? props.month! : todayMonth);
const currentFilter = computed<CalendarFilter>(() => (calendarFilters as readonly string[]).includes(props.filter ?? '') ? props.filter as CalendarFilter : 'all');

function navigate(month: string, filter: CalendarFilter) {
	router.replace('/calendar', {
		query: filter === 'all' ? { month } : { month, filter },
	});
}

const tab = computed<string>({
	get: () => currentFilter.value,
	set: (value) => {
		if (value === currentFilter.value) return;
		navigate(currentMonth.value, value as CalendarFilter);
	},
});

function goMonth(delta: number) {
	navigate(shiftYearMonth(currentMonth.value, delta), currentFilter.value);
}

function goToday() {
	navigate(todayMonth, currentFilter.value);
}

const days = computed(() => buildMonthGrid(currentMonth.value));

const events = ref<Misskey.entities.CalendarEvent[]>([]);
const fetching = ref(true);
const error = ref(false);
let fetchCount = 0;

async function fetchEvents() {
	const id = ++fetchCount;
	fetching.value = true;
	error.value = false;
	try {
		const res = await misskeyApi('calendar/events/list', {
			month: currentMonth.value,
			filter: currentFilter.value,
			moderatorView: moderatorView.value,
		});
		if (id !== fetchCount) return;
		events.value = res;
	} catch {
		if (id !== fetchCount) return;
		error.value = true;
	} finally {
		if (id === fetchCount) fetching.value = false;
	}
}

fetchEvents();

watch(moderatorView, () => fetchEvents());

// ページのキャッシュから戻ったとき (イベントページで購読したあとなど) は読み直す。最初の表示では setup で読んでいるので読まない
let activatedOnce = false;
onActivated(() => {
	if (activatedOnce) fetchEvents();
	activatedOnce = true;
});

const eventsByDate = computed(() => groupCalendarEventsByDate(events.value));

const monthListTitleId = useId();
const currentMonthNumber = computed(() => parseYearMonth(currentMonth.value)?.month ?? 0);
const dateGroups = computed(() => buildCalendarDateGroups(eventsByDate.value, today));

/** 月の一覧の行の読み上げ用のラベル (日付は aria-hidden にしているので入れる) */
function eventRowLabel(event: Misskey.entities.CalendarEvent): string {
	return [
		event.isCanceled ? i18n.ts._calendar.canceled : null,
		event.title,
		formatCalendarDay(event.date),
		formatCalendarEventTime(event),
		event.location,
		event.visibility !== 'public' ? getCalendarVisibilityLabel(event.visibility) : null,
		event.isOutsideVisibility === true ? i18n.ts._calendar.outsideVisibility : null,
		event.isSubscribed === true && !event.isCanceled ? i18n.ts._calendar.subscribed : null,
	].filter(x => x != null && x !== '').join(' ');
}

function eventsOf(date: string): Misskey.entities.CalendarEvent[] {
	return eventsByDate.value.get(date) ?? [];
}

function visibleEvents(date: string): Misskey.entities.CalendarEvent[] {
	return eventsOf(date).slice(0, MAX_CHIPS_PER_DAY);
}

function hiddenCount(date: string): number {
	return eventsOf(date).length - visibleEvents(date).length;
}

function chipTitle(event: Misskey.entities.CalendarEvent): string {
	const text = `${formatCalendarEventTime(event)} ${event.title}`;
	// 全員以外に公開しているイベントは、カレンダーでは鍵の印だけなので、公開範囲を添える
	const notes = [
		event.visibility !== 'public' ? getCalendarVisibilityLabel(event.visibility) : null,
		event.isOutsideVisibility === true ? i18n.ts._calendar.outsideVisibility : null,
		event.isCanceled ? i18n.ts._calendar.canceled : null,
	].filter(x => x != null);
	return notes.length > 0 ? `${text} (${notes.join(', ')})` : text;
}

async function createEvent(date?: string) {
	const created = await openCalendarEventEditDialog({
		// 今月以外を表示しているときは、表示している月の 1 日を初期値にする
		initialDate: date ?? (currentMonth.value === todayMonth ? today : `${currentMonth.value}-01`),
	});
	if (created == null) return;
	router.push('/calendar/events/:eventId', { params: { eventId: created.id } });
}

function openDayMenu(date: string, ev: MouseEvent) {
	const list = eventsOf(date);
	const items: MenuItem[] = [{
		type: 'label',
		text: formatCalendarDay(date),
	}];
	for (const event of list) {
		const time = formatCalendarEventTime(event);
		items.push({
			type: 'link',
			to: `/calendar/events/${event.id}`,
			text: event.title,
			caption: event.isCanceled ? `${time} ・ ${i18n.ts._calendar.canceled}` : event.location != null ? `${time} ・ ${event.location}` : time,
			icon: event.isCanceled ? 'ti ti-calendar-off' : event.isSubscribed ? 'ti ti-bell-ringing' : 'ti ti-calendar-event',
		});
	}
	if (list.length > 0) items.push({ type: 'divider' });
	items.push({
		text: i18n.ts._calendar.createEventOnThisDay,
		icon: 'ti ti-plus',
		action: () => {
			createEvent(date);
		},
	});
	os.popupMenu(items, ev.currentTarget ?? ev.target);
}

const headerTabs = computed(() => [{
	key: 'all',
	title: i18n.ts._calendar.all,
	icon: 'ti ti-calendar',
}, {
	key: 'subscribed',
	title: i18n.ts._calendar.subscribed,
	icon: 'ti ti-bell-ringing',
}, {
	key: 'mine',
	title: i18n.ts._calendar.mine,
	icon: 'ti ti-user',
}]);

const headerActions = computed<PageHeaderItem[]>(() => [...(iAmModerator ? [{
	// 管理人ビューの切り替え (モデレーター以上だけ)
	icon: moderatorView.value ? 'ti ti-shield-check' : 'ti ti-shield',
	text: moderatorView.value ? i18n.ts._calendar.moderatorViewTurnOff : i18n.ts._calendar.moderatorViewTurnOn,
	highlighted: moderatorView.value,
	handler: () => {
		setCalendarModeratorView(!moderatorView.value);
	},
}] : []), {
	icon: 'ti ti-rss',
	text: i18n.ts._calendar.feed,
	handler: () => {
		router.push('/settings/calendar');
	},
}, {
	icon: 'ti ti-plus',
	text: i18n.ts._calendar.createEvent,
	handler: () => {
		createEvent();
	},
}]);

definePage(() => ({
	title: i18n.ts._calendar.calendar,
	icon: 'ti ti-calendar',
}));
</script>

<style lang="scss" module>
.head {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
	margin-bottom: 12px;
}

.month {
	font-size: 1.3em;
	font-weight: bold;
	margin: 0 4px;
}

.grow {
	flex: 1;
}

.moderatorNotice {
	margin-bottom: 12px;
}

.moderatorNoticeBody {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px 12px;
}

/* 管理人ビューで出している、公開範囲の外のイベントの印 */
.outside {
	color: var(--MI_THEME-warn);
}

.panel {
	transition: opacity 0.2s ease;

	&.fetching {
		opacity: 0.6;
	}
}

.grid {
	display: grid;
	grid-template-columns: repeat(7, minmax(0, 1fr));
}

.dow {
	padding: 8px;
	font-size: 0.85em;
	opacity: 0.7;
	border-bottom: solid 0.5px var(--MI_THEME-divider);

	&.sunday {
		color: var(--MI_THEME-error);
		opacity: 0.9;
	}
}

.cell {
	min-height: 108px;
	padding: 6px;
	display: flex;
	flex-direction: column;
	gap: 3px;
	min-width: 0;
	border-bottom: solid 0.5px var(--MI_THEME-divider);
	border-right: solid 0.5px var(--MI_THEME-divider);
	cursor: pointer;

	&:nth-child(7n) {
		border-right: none;
	}

	&:nth-last-child(-n + 7) {
		border-bottom: none;
	}

	&:hover {
		background: var(--MI_THEME-panelHighlight);
	}

	&.out > * {
		opacity: 0.4;
	}
}

.dayNumber {
	flex: none;
	font-size: 0.85em;
	width: 24px;
	height: 24px;
	display: grid;
	place-items: center;
	border-radius: 999px;

	.today & {
		background: var(--MI_THEME-accent);
		color: var(--MI_THEME-fgOnAccent);
		font-weight: bold;
	}
}

.chip {
	display: block;
	font-size: 0.8em;
	line-height: 1.5;
	padding: 1px 6px;
	border-radius: 5px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	background: var(--MI_THEME-buttonBg);
	color: var(--MI_THEME-fg);

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
		text-decoration: none;
	}

	&.subscribed {
		background: var(--MI_THEME-accentedBg);
		color: var(--MI_THEME-accent);
		box-shadow: inset 0 0 0 1px var(--MI_THEME-accent);
	}

	&.canceled {
		text-decoration: line-through;
		opacity: 0.6;
	}
}

.chipTime {
	margin-right: 4px;
}

.chipVisibility {
	margin-right: 3px;
	opacity: 0.75;
}

.more {
	font-size: 0.8em;
	text-align: left;
	padding: 1px 4px;
	opacity: 0.7;
	border-radius: 5px;

	&:hover {
		opacity: 1;
	}
}

.legend {
	display: flex;
	flex-wrap: wrap;
	gap: 16px;
	margin-top: 10px;
	font-size: 0.85em;
	opacity: 0.8;

	> span {
		display: flex;
		align-items: center;
		gap: 6px;
	}
}

.legendMark {
	display: inline-block;
	width: 14px;
	height: 10px;
	border-radius: 3px;
	background: var(--MI_THEME-buttonBg);

	&.subscribed {
		background: var(--MI_THEME-accentedBg);
		box-shadow: inset 0 0 0 1px var(--MI_THEME-accent);
	}

	&.canceled {
		opacity: 0.6;
	}
}

.monthList {
	margin-top: 28px;
}

.sectionLabel {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-bottom: 10px;
	font-size: 0.9em;
	font-weight: bold;
	opacity: 0.8;
}

.sectionTitle {
	margin: 0;
	font-size: 1em;
}

.sectionCount {
	font-weight: normal;
}

.monthPanel {
	transition: opacity 0.2s ease;

	&.fetching {
		opacity: 0.6;
	}
}

.todayDivider {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 6px 16px;
	font-size: 0.8em;
	font-weight: bold;
	color: var(--MI_THEME-accent);
	background: var(--MI_THEME-accentedBg);

	&::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--MI_THEME-accent);
		opacity: 0.35;
	}
}

.dateGroup {
	display: grid;
	grid-template-columns: 76px minmax(0, 1fr);

	& + & {
		border-top: solid 0.5px var(--MI_THEME-divider);
	}

	&.pastGroup {
		opacity: 0.55;
	}
}

.groupDate {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 2px;
	padding: 12px 0;

	&.sunday {
		color: var(--MI_THEME-error);
	}
}

.groupDay {
	width: 36px;
	height: 36px;
	display: grid;
	place-items: center;
	border-radius: 999px;
	font-size: 1.25em;
	font-weight: bold;

	.groupToday & {
		background: var(--MI_THEME-accent);
		color: var(--MI_THEME-fgOnAccent);
	}
}

.groupDow {
	font-size: 0.8em;
}

.groupEvents {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
	padding: 6px 8px 6px 0;
}

.eventRow {
	display: grid;
	grid-template-columns: 104px minmax(0, 1fr) auto;
	align-items: center;
	gap: 12px;
	padding: 9px 10px;
	border-radius: 8px;

	&:hover {
		background: var(--MI_THEME-panelHighlight);
		text-decoration: none;
	}
}

.eventTime {
	font-size: 0.9em;
	font-variant-numeric: tabular-nums;
	opacity: 0.85;
}

.eventBody {
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 3px;
}

.eventTitle {
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	color: var(--MI_THEME-fgHighlighted);
}

.canceledTitle {
	text-decoration: line-through;
}

.eventMeta {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 2px 12px;
	font-size: 0.85em;
	opacity: 0.75;

	> span {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}
}

.eventBadges {
	display: flex;
	align-items: center;
	gap: 8px;
}

.canceledBadge,
.subscribedBadge {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 2px 8px;
	border-radius: 999px;
	font-size: 0.8em;
	font-weight: bold;
	white-space: nowrap;
}

.canceledBadge {
	background: var(--MI_THEME-buttonBg);
}

.subscribedBadge {
	color: var(--MI_THEME-accent);
	background: var(--MI_THEME-accentedBg);
}

.eventChevron {
	opacity: 0.45;
}

.monthEmpty {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 12px;
	padding: 8px 16px 24px;
}

// スマホ幅ではイベントを細い印にして、セルを押したときの一覧で中身を見る
@container (max-width: 600px) {
	.create {
		display: none;
	}

	.cell {
		min-height: 56px;
		padding: 3px;
	}

	.chip {
		font-size: 0;
		height: 5px;
		padding: 0;
		border-radius: 999px;
		// 細い印は押しにくいので、押したらセルの一覧を出す
		pointer-events: none;
	}

	.more {
		font-size: 0.7em;
		padding: 0 2px;
	}

	.monthList {
		margin-top: 20px;
	}

	.dateGroup {
		grid-template-columns: 52px minmax(0, 1fr);
	}

	.groupDay {
		width: 32px;
		height: 32px;
		font-size: 1.1em;
	}

	// 時刻は題名の上に置き、行を狭くする
	.eventRow {
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 2px 8px;
		padding: 8px;
	}

	.eventTime {
		grid-column: 1 / -1;
		font-size: 0.8em;
	}

	.eventBadges {
		grid-row: 2;
		grid-column: 2;
	}
}
</style>
