(() => {
    'use strict';
    let previousTab = null;
    const animations = new Set();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const games = [
        ['page-wheel', 'page-admin', '01 · วงล้อสุ่ม'],
        ['page-memory', 'page-memory-admin', '02 · จับคู่รูปภาพ'],
        ['page-claw', 'page-claw-admin', '03 · ตู้คีบลูกบอล'],
        ['page-quiz', 'page-quiz-admin', '04 · รู้ใจแค่ไหน']
    ];
    games.forEach(([pageId]) => {
        const nav = document.createElement('nav');
        nav.className = 'game-tabs play-tabs';
        nav.setAttribute('aria-label', 'เลือกเกม');
        games.forEach(([destination, , label]) => {
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'game-tab'; button.dataset.page = destination;
            button.textContent = label;
            button.classList.toggle('selected', destination === pageId);
            nav.append(button);
        });
        document.querySelector('#' + pageId + ' main').prepend(nav);
    });
    document.querySelectorAll('.game-tabs').forEach(nav => {
        const pageId = nav.closest('.page').id;
        nav.querySelectorAll('span.game-tab').forEach(span => {
            const button = document.createElement('button');
            button.type = 'button'; button.className = span.className; button.textContent = span.textContent;
            button.dataset.page = pageId; span.replaceWith(button);
        });
        nav.setAttribute('role', 'tablist');
        nav.querySelectorAll('.game-tab').forEach(button => {
            const selected = button.classList.contains('selected');
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-selected', String(selected));
            button.setAttribute('aria-controls', button.dataset.page);
            button.tabIndex = selected ? 0 : -1;
        });
        const indicator = document.createElement('span'); indicator.className = 'tab-indicator'; indicator.setAttribute('aria-hidden', 'true');
        nav.prepend(indicator); nav.classList.add('has-indicator');
        nav.addEventListener('keydown', event => {
            const tabs = Array.from(nav.querySelectorAll('.game-tab'));
            const index = tabs.indexOf(document.activeElement);
            if (index < 0) return;
            let next;
            if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
            if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
            if (event.key === 'Home') next = 0;
            if (event.key === 'End') next = tabs.length - 1;
            if (next === undefined) return;
            event.preventDefault();
            tabs.forEach((tab, i) => { tab.tabIndex = i === next ? 0 : -1; });
            tabs[next].focus(); // Manual activation: Enter/Space changes games.
        });
    });
    function animate(el, frames, options = {}) {
        if (!el.animate || reducedMotion.matches) return;
        const animation = el.animate(frames, { duration: 520, easing: 'cubic-bezier(.22,1,.36,1)', ...options });
        animations.add(animation);
        animation.finished.then(() => animations.delete(animation), () => animations.delete(animation));
    }
    function placeIndicator(nav, from) {
        const selected = nav.querySelector('.selected');
        const indicator = nav.querySelector('.tab-indicator');
        if (!selected || !indicator || !nav.offsetWidth) return;
        const x = selected.offsetLeft;
        indicator.style.width = selected.offsetWidth + 'px';
        indicator.style.transform = `translateX(${x}px)`;
        if (from) animate(indicator, [
            { transform: `translateX(${from.x}px)`, width: from.width + 'px' },
            { transform: `translateX(${x}px)`, width: selected.offsetWidth + 'px' }
        ], { duration: 450 });
        if (x < nav.scrollLeft || x + selected.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = Math.max(0, x - 12);
    }
    document.addEventListener('click', event => {
        const tab = event.target.closest('.game-tab');
        const current = tab?.closest('.game-tabs').querySelector('.selected');
        previousTab = current ? { x: current.offsetLeft, width: current.offsetWidth } : null;
    }, true);
    function revealPage() {
        const page = document.querySelector('.page.active');
        page.querySelectorAll('.game-tabs').forEach(nav => placeIndicator(nav, previousTab));
        previousTab = null;
        const targets = page.id === 'page-login'
            ? page.querySelectorAll('.hero-logo, .hero-quote, .header-text, .credentials-form, .actions-group')
            : page.querySelectorAll('main > .eyebrow, main > h1, main > .page-subtitle, .title-row, .game-card, main > .panel, main > .admin-layout, main > .quiz-intro-layout, main > .play-layout, main > .memory-stage, main > .claw-machine');
        targets.forEach((el, i) => {
            if (el.getAnimations) el.getAnimations().forEach(animation => animation.cancel());
            animate(el, [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'translateY(0)' }], { delay: Math.min(i * 45, 225), fill: 'backwards' });
        });
    }
    document.addEventListener('jao:pagechange', revealPage);
    new ResizeObserver(() => document.querySelectorAll('.page.active .game-tabs').forEach(nav => placeIndicator(nav))).observe(document.body);
    if (document.fonts) document.fonts.ready.then(() => document.querySelectorAll('.page.active .game-tabs').forEach(nav => placeIndicator(nav)));
    document.addEventListener('click', event => {
        const button = event.target.closest('.button, .primary-login-button, .continue-guest-button');
        if (!button || button.disabled) return;
        const rect = button.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height) * 2;
        const ripple = document.createElement('span'); ripple.className = 'tap-ripple'; ripple.setAttribute('aria-hidden', 'true');
        ripple.style.cssText = `width:${size}px;height:${size}px;left:${(event.detail ? event.clientX - rect.left : rect.width / 2) - size / 2}px;top:${(event.detail ? event.clientY - rect.top : rect.height / 2) - size / 2}px`;
        button.append(ripple); setTimeout(() => ripple.remove(), 600);
    });
    function celebrate(host) {
        if (host.id === 'result-dialog') {
            document.dispatchEvent(new CustomEvent('halloween:wheelwin'));
            return;
        }
        const layer = document.createElement('div'); layer.className = 'celebration'; layer.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < 28; i++) {
            const piece = document.createElement('i');
            piece.style.cssText = `--confetti:${['#c2410c','#e2ad52','#385b4b','#8b5575'][i % 4]};--dx:${(Math.random() - .5) * 600}px;--dy:${120 + Math.random() * 420}px;--turn:${Math.random() * 700}deg;animation-delay:${Math.random() * .12}s`;
            layer.append(piece);
        }
        host.append(layer); setTimeout(() => layer.remove(), 1600);
    }
    document.addEventListener('jao:celebrate', () => celebrate(document.body));
    ['result-dialog', 'claw-result-dialog'].forEach(id => {
        const dialog = document.getElementById(id);
        new MutationObserver(changes => {
            if (id === 'result-dialog' && dialog.open && changes.some(change => change.attributeName === 'open')) celebrate(dialog);
            if (id === 'claw-result-dialog' && dialog.open && dialog.classList.contains('is-revealed') && changes.some(change => change.attributeName === 'class')) celebrate(dialog);
        }).observe(dialog, { attributes: true, attributeFilter: ['open', 'class'] });
    });
    new MutationObserver(() => {
        document.querySelectorAll('#quiz-choices .quiz-choice').forEach((choice, index) => animate(choice, [{ opacity: .2, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 260, delay: index * 30 }));
    }).observe(document.getElementById('quiz-choices'), { childList: true });
    revealPage();
})();
