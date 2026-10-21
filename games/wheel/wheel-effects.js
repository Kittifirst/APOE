(() => {
    'use strict';
    const stage = document.querySelector('#page-wheel .wheel-stage');
    const ritual = stage.querySelector('.wheel-ritual');
    const trigger = document.getElementById('spin-button');
    const label = document.getElementById('spin-label');
    const dialog = document.getElementById('result-dialog');
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const svgNamespace = 'http://www.w3.org/2000/svg';
    let awardTimer;

    // Decoration has no access to game state, prize selection, stock, or persistence.
    function symbol(name, viewBox) {
        const svg = document.createElementNS(svgNamespace, 'svg');
        svg.setAttribute('viewBox', viewBox);
        svg.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS(svgNamespace, 'use');
        use.setAttribute('href', '#' + name);
        svg.append(use);
        return svg;
    }
    const embers = stage.querySelector('.wheel-embers');
    for (let index = 0; index < 14; index++) {
        const ember = document.createElement('i');
        ember.className = 'wheel-ember';
        ember.style.cssText = `--ember-x:${6 + (index * 31 % 88)}%;--ember-y:${25 + (index * 17 % 66)}%;--ember-size:${2 + index % 2}px;--ember-duration:${5 + index % 5}s;--ember-delay:${-index * .7}s`;
        embers.append(ember);
    }
    const orb = dialog.querySelector('.result-gift');
    orb.classList.add('wheel-prize-orb');
    orb.setAttribute('aria-hidden', 'true');
    const pumpkin = symbol('i-pumpkin', '0 0 64 64');
    pumpkin.classList.add('icon');
    orb.replaceChildren(pumpkin);
    dialog.querySelector('.dialog-content > .eyebrow').textContent = 'YOUR HALLOWEEN TREAT';
    dialog.querySelector('#result-title').textContent = 'ฟักทองเสกโชคให้แล้ว!';
    dialog.querySelector('.dialog-content > .micro-copy').textContent = 'ของขวัญเล็ก ๆ จากค่ำคืนที่เต็มไปด้วยเวทมนตร์';

    function motionState() {
        const active = document.getElementById('page-wheel').classList.contains('active');
        stage.dataset.motion = preference.matches ? 'reduced' : document.hidden || !active ? 'paused' : 'running';
        if (preference.matches || !active || document.hidden) {
            ritual.querySelectorAll('.spell-spark').forEach(piece => piece.remove());
            dialog.querySelectorAll('.wheel-treat-burst').forEach(layer => layer.remove());
        }
    }
    function castingState() {
        stage.classList.toggle('is-casting', label.textContent.includes('กำลังหมุน'));
    }
    new MutationObserver(castingState).observe(label, { childList: true, characterData: true, subtree: true });
    document.addEventListener('jao:pagechange', motionState);
    document.addEventListener('visibilitychange', motionState);
    preference.addEventListener('change', motionState);
    motionState();
    castingState();

    trigger.addEventListener('pointerdown', event => {
        if (trigger.disabled || preference.matches || document.hidden) return;
        // Replace the previous spray so repeated taps cannot accumulate particles.
        ritual.querySelectorAll('.spell-spark').forEach(piece => piece.remove());
        const bounds = ritual.getBoundingClientRect();
        const x = event.clientX - bounds.left;
        const y = event.clientY - bounds.top;
        for (let index = 0; index < 10; index++) {
            const angle = index * Math.PI / 5;
            const spark = document.createElement('span');
            spark.className = 'spell-spark';
            spark.setAttribute('aria-hidden', 'true');
            spark.style.cssText = `--spark-x:${x}px;--spark-y:${y}px;--spark-dx:${Math.cos(angle) * 48}px;--spark-dy:${Math.sin(angle) * 48}px`;
            ritual.append(spark);
            setTimeout(() => spark.remove(), 900);
        }
    });

    document.addEventListener('halloween:wheelwin', () => {
        if (!dialog.open || document.hidden) return;
        clearTimeout(awardTimer);
        stage.classList.add('is-awarded');
        awardTimer = setTimeout(() => stage.classList.remove('is-awarded'), 1300);
        dialog.querySelector('.wheel-treat-burst')?.remove();
        if (preference.matches) return;
        const layer = document.createElement('div');
        layer.className = 'wheel-treat-burst';
        layer.setAttribute('aria-hidden', 'true');
        layer.setAttribute('inert', '');
        const shapes = [['i-pumpkin', '0 0 64 64'], ['i-halloween-candy', '0 0 64 48'], ['i-halloween-ghost', '0 0 64 72'], ['i-halloween-bat', '0 0 100 50']];
        for (let index = 0; index < 24; index++) {
            const piece = document.createElement('span');
            piece.className = 'wheel-treat-piece';
            const side = index % 2 ? 1 : -1;
            piece.style.cssText = `--treat-size:${16 + index % 4 * 5}px;--treat-x:${side * (48 + index * 17 % 180)}px;--treat-y:${100 + index * 43 % 330}px;--treat-turn:${side * (90 + index * 29)}deg;--treat-delay:${index % 6 * .025}s`;
            piece.append(symbol(...shapes[index % shapes.length]));
            layer.append(piece);
        }
        dialog.append(layer);
        setTimeout(() => layer.remove(), 2100);
    });
    dialog.addEventListener('close', () => {
        dialog.querySelector('.wheel-treat-burst')?.remove();
        stage.classList.remove('is-awarded');
        clearTimeout(awardTimer);
    });
})();
