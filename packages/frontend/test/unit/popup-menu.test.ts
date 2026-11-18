/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 42times: ドロワーのメニューは画面いっぱいまで伸ばす (MkPopupMenu)

import { describe, test, assert, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/vue';
import { preferState } from '../setup.unit.js';
import { components } from '@/components/index.js';
import { directives } from '@/directives/index.js';
import MkPopupMenu from '@/components/MkPopupMenu.vue';

describe('MkPopupMenu', () => {
	const renderDrawerMenu = () => {
		preferState.menuStyle = 'drawer';
		const anchorElement = document.createElement('button');
		document.body.appendChild(anchorElement);
		return render(MkPopupMenu, {
			props: {
				items: [{ text: 'a', action: () => {} }],
				anchorElement,
			},
			global: { directives, components },
		});
	};

	afterEach(() => {
		cleanup();
		document.body.replaceChildren();
		delete preferState.menuStyle;
	});

	test('ドロワーでは画面の 2/3 で切らず、画面の高さまで出す', () => {
		window.innerHeight = 900;
		renderDrawerMenu();
		const menu = document.querySelector<HTMLElement>('[role="menu"] > ._popup');
		assert.isNotNull(menu);
		assert.strictEqual(menu!.style.maxHeight, 'calc(100dvh - 32px)');
	});
});
