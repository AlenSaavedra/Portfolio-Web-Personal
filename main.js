/* Patrick Molina — Portfolio interactions */
(() => {
    'use strict';

    const root = document.documentElement;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

    /* ------------------------------------------------------------------
       Hero: WebGL particle name
       The h1 keeps the layout (text is transparent once this runs); the
       particles sample that exact text, assemble into it, scatter away from
       the pointer, and dissolve outward as the hero scrolls off.
    ------------------------------------------------------------------ */
    function initParticles() {
        const canvas = document.querySelector('[data-particles]');
        const hero = document.querySelector('[data-hero]');
        const nameEl = document.querySelector('[data-hero-name]');
        if (!canvas || !hero || !nameEl || reduceMotion) return;

        const gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: false });
        if (!gl) return;

        const vsSrc = `
            attribute vec4 a_p; // x, y, seed, speed
            uniform vec2 u_res;
            uniform float u_size;
            varying float v_seed;
            varying float v_speed;
            void main() {
                vec2 c = (a_p.xy / u_res) * 2.0 - 1.0;
                gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
                gl_PointSize = u_size * (0.75 + a_p.z * 0.5) * (1.0 + min(a_p.w * 0.05, 0.6));
                v_seed = a_p.z;
                v_speed = a_p.w;
            }`;
        const fsSrc = `
            precision mediump float;
            uniform float u_alpha;
            varying float v_seed;
            varying float v_speed;
            void main() {
                float d = length(gl_PointCoord - 0.5);
                float a = smoothstep(0.5, 0.05, d);
                vec3 ink = vec3(0.91, 0.94, 0.91);
                vec3 mint = vec3(0.25, 0.95, 0.75);
                float heat = clamp(v_speed * 0.12 + step(0.93, v_seed) * 0.8, 0.0, 1.0);
                gl_FragColor = vec4(mix(ink, mint, heat), a * u_alpha * (0.75 + v_seed * 0.25));
            }`;

        const compile = (type, src) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
        };
        const vs = compile(gl.VERTEX_SHADER, vsSrc);
        const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
        if (!vs || !fs) return;
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
        gl.useProgram(prog);

        const aP = gl.getAttribLocation(prog, 'a_p');
        const uRes = gl.getUniformLocation(prog, 'u_res');
        const uSize = gl.getUniformLocation(prog, 'u_size');
        const uAlpha = gl.getUniformLocation(prog, 'u_alpha');
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(aP);
        gl.vertexAttribPointer(aP, 4, gl.FLOAT, false, 16, 0);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

        let W = 0, H = 0, dpr = 1, n = 0, gap = 4;
        let data, tx, ty, vx, vy, sx, sy, delay;
        let lastWidth = 0;
        const pointer = { x: -9999, y: -9999, active: false };
        let start = 0;
        let running = false;
        let visible = true;
        let scrollP = 0;

        function sampleTargets() {
            const rect = canvas.getBoundingClientRect();
            W = rect.width;
            H = rect.height;
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.round(W * dpr);
            canvas.height = Math.round(H * dpr);
            gl.viewport(0, 0, canvas.width, canvas.height);

            const off = document.createElement('canvas');
            off.width = Math.ceil(W);
            off.height = Math.ceil(H);
            const ctx = off.getContext('2d', { willReadFrequently: true });
            const cs = getComputedStyle(nameEl);
            const size = parseFloat(cs.fontSize);
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `${cs.fontWeight} ${size}px ${cs.fontFamily}`;
            if ('letterSpacing' in ctx) ctx.letterSpacing = cs.letterSpacing;

            nameEl.querySelectorAll('span').forEach((span) => {
                const r = span.getBoundingClientRect();
                const word = span.textContent.trim().toUpperCase();
                // Draw at the span's own box so particles land exactly on the DOM text.
                ctx.fillText(word, r.left - rect.left + r.width / 2, r.top - rect.top + r.height / 2 + size * 0.04);
            });

            gap = clamp(Math.round(size / 26), 3, 7);
            let pts;
            const img = ctx.getImageData(0, 0, off.width, off.height).data;
            for (; ;) {
                pts = [];
                for (let y = 0; y < off.height; y += gap) {
                    for (let x = 0; x < off.width; x += gap) {
                        if (img[(y * off.width + x) * 4 + 3] > 140) pts.push(x, y);
                    }
                }
                if (pts.length / 2 <= 11000) break;
                gap += 1;
            }
            return pts;
        }

        function build(keepPositions) {
            const pts = sampleTargets();
            const old = data;
            const oldN = n;
            n = pts.length / 2;
            data = new Float32Array(n * 4);
            tx = new Float32Array(n);
            ty = new Float32Array(n);
            vx = new Float32Array(n);
            vy = new Float32Array(n);
            sx = new Float32Array(n);
            sy = new Float32Array(n);
            delay = new Float32Array(n);
            const cx = W / 2, cy = H / 2;
            for (let i = 0; i < n; i++) {
                // slight jitter so the grid reads as phosphor, not a dot-matrix
                tx[i] = pts[i * 2] + (Math.random() - 0.5) * gap * 0.5;
                ty[i] = pts[i * 2 + 1] + (Math.random() - 0.5) * gap * 0.5;
                const seed = Math.random();
                // scatter vector for the scroll dissolve: outward from centre, with spread
                const ang = Math.atan2(ty[i] - cy, tx[i] - cx) + (Math.random() - 0.5) * 1.6;
                const mag = (0.4 + Math.random() * 0.9) * Math.max(W, H) * 0.7;
                sx[i] = Math.cos(ang) * mag;
                sy[i] = Math.sin(ang) * mag - H * 0.25 * Math.random();
                // assembly sweeps left to right with jitter
                delay[i] = (tx[i] / W) * 650 + Math.random() * 450;
                const o = i * 4;
                if (keepPositions && old && i < oldN) {
                    data[o] = old[i * 4];
                    data[o + 1] = old[i * 4 + 1];
                } else {
                    // start as a loose field of dust across the hero
                    data[o] = Math.random() * W;
                    data[o + 1] = Math.random() * H;
                }
                data[o + 2] = seed;
                data[o + 3] = 0;
            }
            gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
            gl.uniform2f(uRes, W, H);
            gl.uniform1f(uSize, clamp(gap * 0.9, 2.4, 6.5) * dpr);
        }

        function frame(now) {
            if (!running) return;
            const t = now - start;
            const R = clamp(W * 0.09, 70, 150);
            const R2 = R * R;
            const s = scrollP * scrollP * (3 - 2 * scrollP); // smoothstep
            const px = pointer.x, py = pointer.y;
            const time = now * 0.001;

            for (let i = 0; i < n; i++) {
                const o = i * 4;
                let x = data[o], y = data[o + 1];
                const seed = data[o + 2];
                const k = t < delay[i] ? 0.004 : 0.06;
                const gx = tx[i] + sx[i] * s + Math.sin(time * 1.1 + seed * 40) * 0.6;
                const gy = ty[i] + sy[i] * s + Math.cos(time * 0.9 + seed * 30) * 0.6;
                let ax = (gx - x) * k;
                let ay = (gy - y) * k;

                const dx = x - px, dy = y - py;
                const d2 = dx * dx + dy * dy;
                if (d2 < R2 && d2 > 0.01) {
                    const d = Math.sqrt(d2);
                    const f = (1 - d / R) * 3.2;
                    // radial push plus a slight swirl
                    ax += (dx / d) * f - (dy / d) * f * 0.35;
                    ay += (dy / d) * f + (dx / d) * f * 0.35;
                }

                vx[i] = (vx[i] + ax) * 0.84;
                vy[i] = (vy[i] + ay) * 0.84;
                x += vx[i];
                y += vy[i];
                data[o] = x;
                data[o + 1] = y;
                data[o + 3] = Math.abs(vx[i]) + Math.abs(vy[i]);
            }

            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.uniform1f(uAlpha, 1 - s * 0.85);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
            gl.drawArrays(gl.POINTS, 0, n);
            requestAnimationFrame(frame);
        }

        function play() {
            if (running || !n || !visible || document.hidden) return;
            running = true;
            requestAnimationFrame(frame);
        }

        function pause() {
            running = false;
        }

        function setPointer(e) {
            const r = canvas.getBoundingClientRect();
            pointer.x = e.clientX - r.left;
            pointer.y = e.clientY - r.top;
            if (!pointer.active) {
                pointer.active = true;
                hint && hint.classList.remove('is-visible');
            }
        }

        const clearPointer = () => {
            pointer.x = pointer.y = -9999;
        };

        hero.addEventListener('pointermove', setPointer, { passive: true });
        hero.addEventListener('pointerdown', setPointer, { passive: true });
        hero.addEventListener('pointerleave', clearPointer);
        hero.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') clearPointer(); });
        hero.addEventListener('pointercancel', clearPointer);

        const onScroll = () => {
            scrollP = clamp(window.scrollY / (hero.offsetHeight * 0.85), 0, 1);
        };
        window.addEventListener('scroll', onScroll, { passive: true });

        new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            visible ? play() : pause();
        }).observe(hero);

        document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));

        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                const w = canvas.getBoundingClientRect().width;
                // ignore height-only changes (mobile URL bar showing/hiding)
                if (Math.abs(w - lastWidth) < 2) return;
                lastWidth = w;
                build(true);
            }, 180);
        });

        const hint = document.querySelector('[data-hint]');
        if (hint && !finePointer) hint.textContent = 'Touch the name to scatter it';

        const fontReady = document.fonts && document.fonts.load
            ? Promise.race([
                document.fonts.load(`800 100px "Bricolage Grotesque"`),
                new Promise((r) => setTimeout(r, 2500)),
            ])
            : Promise.resolve();

        fontReady.then(() => {
            build(false);
            lastWidth = W;
            if (!n) return;
            root.classList.add('fx-on');
            onScroll();
            start = performance.now();
            play();
            setTimeout(() => hint && !pointer.active && hint.classList.add('is-visible'), 2400);
        });
    }

    /* ------------------------------------------------------------------
       Navigation: scrolled state, hide on scroll down, active section
    ------------------------------------------------------------------ */
    function initNav() {
        const nav = document.querySelector('[data-nav]');
        if (!nav) return;
        let lastY = window.scrollY;
        let ticking = false;
        const update = () => {
            const y = window.scrollY;
            nav.classList.toggle('is-scrolled', y > 40);
            const goingDown = y > lastY + 4;
            const goingUp = y < lastY - 4;
            if (goingDown && y > window.innerHeight * 0.9 && !document.body.classList.contains('menu-open')) {
                nav.classList.add('is-hidden');
            } else if (goingUp || y < 80) {
                nav.classList.remove('is-hidden');
            }
            if (goingDown || goingUp) lastY = y;
            ticking = false;
        };
        window.addEventListener('scroll', () => {
            if (!ticking) {
                ticking = true;
                requestAnimationFrame(update);
            }
        }, { passive: true });
        nav.addEventListener('focusin', () => nav.classList.remove('is-hidden'));
        update();

        const links = [...document.querySelectorAll('.nav__links a')];
        const sections = links.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);
        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                links.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === `#${entry.target.id}`));
            });
        }, { rootMargin: '-45% 0px -50% 0px' });
        sections.forEach((s) => io.observe(s));
    }

    /* ------------------------------------------------------------------
       Mobile menu
    ------------------------------------------------------------------ */
    function initMenu() {
        const toggle = document.querySelector('[data-menu-toggle]');
        const menu = document.querySelector('[data-menu]');
        if (!toggle || !menu) return;
        const label = toggle.querySelector('.nav__toggle-label');
        menu.hidden = false;
        menu.setAttribute('aria-hidden', 'true');
        menu.inert = true;

        const set = (open) => {
            toggle.setAttribute('aria-expanded', String(open));
            menu.classList.toggle('is-open', open);
            menu.setAttribute('aria-hidden', String(!open));
            menu.inert = !open;
            document.body.classList.toggle('menu-open', open);
            if (open) document.querySelector('[data-nav]').classList.remove('is-hidden');
            label.textContent = open ? 'Close' : 'Menu';
            if (open) menu.querySelector('a').focus({ preventScroll: true });
        };

        toggle.addEventListener('click', () => set(toggle.getAttribute('aria-expanded') !== 'true'));
        menu.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && menu.classList.contains('is-open')) {
                set(false);
                toggle.focus();
            }
        });
        window.matchMedia('(min-width: 901px)').addEventListener('change', (e) => { if (e.matches) set(false); });
    }

    /* ------------------------------------------------------------------
       About: word-by-word light-up (CSS scroll timeline does the work)
    ------------------------------------------------------------------ */
    function initWords() {
        document.querySelectorAll('[data-words]').forEach((el) => {
            const words = el.textContent.trim().split(/\s+/);
            el.textContent = '';
            words.forEach((w, i) => {
                const span = document.createElement('span');
                span.className = 'w';
                span.style.setProperty('--wi', i);
                span.textContent = w;
                el.append(span, i < words.length - 1 ? ' ' : '');
            });
        });
    }

    /* ------------------------------------------------------------------
       Reveals
    ------------------------------------------------------------------ */
    function initReveals() {
        const groups = [
            ['.about__avatar', '.about__title', '.about__body', '.about__actions'],
            ['.stack__title'],
            ['.work__title', '.work__sub'],
            ['.project'],
            ['.contact__title', '.contact__details', '.form'],
        ];
        const els = [];
        groups.forEach((g) => {
            let i = 0;
            g.forEach((sel) => document.querySelectorAll(sel).forEach((el) => {
                el.setAttribute('data-reveal', '');
                el.style.setProperty('--d', `${i++ * 90}ms`);
                els.push(el);
            }));
        });
        if (reduceMotion || !('IntersectionObserver' in window)) {
            els.forEach((el) => el.classList.add('is-in'));
            return;
        }
        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-in');
                    io.unobserve(entry.target);
                }
            });
        }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });
        els.forEach((el) => io.observe(el));
    }

    /* ------------------------------------------------------------------
       Stack marquee: duplicate the track for a seamless loop
    ------------------------------------------------------------------ */
    function initMarquee() {
        document.querySelectorAll('[data-marquee]').forEach((m) => {
            const track = m.querySelector('.marquee__track');
            const clone = track.cloneNode(true);
            clone.setAttribute('aria-hidden', 'true');
            m.append(clone);
        });
    }

    /* ------------------------------------------------------------------
       Projects: accordion + floating cursor preview
    ------------------------------------------------------------------ */
    function initProjects() {
        const items = [...document.querySelectorAll('[data-project]')];
        if (!items.length) return;
        const fig = document.querySelector('[data-preview-float]');
        const img = document.querySelector('[data-preview-img]');
        let x = 0, y = 0, cx = 0, cy = 0, r = 0, raf = 0, shown = false;

        function hidePreview() {
            shown = false;
            if (fig) fig.classList.remove('is-visible');
        }

        const setOpen = (item, open) => {
            item.classList.toggle('is-open', open);
            item.querySelector('.project__head').setAttribute('aria-expanded', String(open));
        };

        items.forEach((item) => {
            const head = item.querySelector('.project__head');
            head.addEventListener('click', () => {
                const open = !item.classList.contains('is-open');
                items.forEach((other) => other !== item && setOpen(other, false));
                setOpen(item, open);
                hidePreview();
                if (open) {
                    // after the previous panel collapses, keep the opened row in view
                    setTimeout(() => {
                        const r = item.getBoundingClientRect();
                        if (r.top < 70 || r.top > window.innerHeight * 0.55) {
                            window.scrollTo({
                                top: window.scrollY + r.top - 90,
                                behavior: reduceMotion ? 'auto' : 'smooth',
                            });
                        }
                    }, 380);
                }
            });
        });

        // Floating preview
        if (!fig || !img || !finePointer) return;

        items.forEach((item) => { const p = new Image(); p.src = item.dataset.preview; });

        const loop = () => {
            const nx = cx + (x - cx) * 0.16;
            const ny = cy + (y - cy) * 0.16;
            r += (clamp((nx - cx) * 0.6, -10, 10) - r) * 0.12;
            cx = nx;
            cy = ny;
            fig.style.setProperty('--px', `${cx}px`);
            fig.style.setProperty('--py', `${cy}px`);
            fig.style.setProperty('--pr', `${r}deg`);
            if (shown || Math.abs(r) > 0.05) raf = requestAnimationFrame(loop);
            else raf = 0;
        };
        const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };

        items.forEach((item) => {
            const head = item.querySelector('.project__head');
            head.addEventListener('pointerenter', (e) => {
                if (item.classList.contains('is-open')) return;
                if (!shown) { cx = e.clientX; cy = e.clientY; }
                img.src = item.dataset.preview;
                shown = true;
                fig.classList.add('is-visible');
                kick();
            });
            head.addEventListener('pointermove', (e) => {
                x = e.clientX + 24;
                y = e.clientY;
                if (item.classList.contains('is-open')) hidePreview();
                kick();
            });
            head.addEventListener('pointerleave', hidePreview);
        });
        window.addEventListener('scroll', hidePreview, { passive: true });
    }

    /* ------------------------------------------------------------------
       Avatar tilt with a spring
    ------------------------------------------------------------------ */
    function initTilt() {
        const fig = document.querySelector('[data-tilt]');
        if (!fig || !finePointer || reduceMotion) return;
        const inner = fig.querySelector('.about__avatar-inner');
        let tx = 0, ty = 0, rx = 0, ry = 0, vx = 0, vy = 0, raf = 0;
        const step = () => {
            // critically-ish damped spring
            vx = (vx + (tx - rx) * 0.08) * 0.78;
            vy = (vy + (ty - ry) * 0.08) * 0.78;
            rx += vx;
            ry += vy;
            inner.style.setProperty('--rx', `${rx.toFixed(2)}deg`);
            inner.style.setProperty('--ry', `${ry.toFixed(2)}deg`);
            inner.style.setProperty('--gx', `${50 + ry * 3}%`);
            inner.style.setProperty('--gy', `${30 - rx * 3}%`);
            if (Math.abs(tx - rx) + Math.abs(ty - ry) + Math.abs(vx) + Math.abs(vy) > 0.01) raf = requestAnimationFrame(step);
            else raf = 0;
        };
        fig.addEventListener('pointermove', (e) => {
            const r = fig.getBoundingClientRect();
            const px = (e.clientX - r.left) / r.width - 0.5;
            const py = (e.clientY - r.top) / r.height - 0.5;
            tx = -py * 12;
            ty = px * 14;
            if (!raf) raf = requestAnimationFrame(step);
        });
        fig.addEventListener('pointerleave', () => {
            tx = ty = 0;
            if (!raf) raf = requestAnimationFrame(step);
        });
    }

    /* ------------------------------------------------------------------
       Contact form: inline validation + async submit to Formspree
    ------------------------------------------------------------------ */
    function initForm() {
        const form = document.querySelector('[data-form]');
        if (!form) return;
        const btn = form.querySelector('[data-submit]');
        const label = btn.querySelector('.btn__label');
        const status = form.querySelector('[data-status]');

        const messages = {
            name: 'Please tell me your name.',
            lastname: 'Please add your last name.',
            email: 'Enter an email like name@example.com so I can reply.',
            message: 'Write a short message about what you need.',
        };

        const check = (input) => {
            const field = input.closest('.field');
            const err = field.querySelector('.field__error');
            const value = input.value.trim();
            let ok = value.length > 0;
            if (ok && input.type === 'email') ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
            field.classList.toggle('is-invalid', !ok);
            input.setAttribute('aria-invalid', String(!ok));
            if (err.id) input.setAttribute('aria-describedby', err.id);
            err.textContent = ok ? '' : messages[input.name];
            return ok;
        };

        const inputs = [...form.querySelectorAll('input, textarea')];
        inputs.forEach((input) => {
            input.addEventListener('blur', () => { if (input.value) check(input); });
            input.addEventListener('input', () => {
                if (input.closest('.field').classList.contains('is-invalid')) check(input);
            });
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const results = inputs.map(check);
            if (results.includes(false)) {
                inputs[results.indexOf(false)].focus();
                status.className = 'form__status is-err';
                status.textContent = 'A few fields need your attention.';
                return;
            }
            btn.disabled = true;
            btn.classList.add('is-sending');
            label.textContent = 'Sending…';
            status.className = 'form__status';
            status.textContent = '';
            try {
                const res = await fetch(form.action, {
                    method: 'POST',
                    body: new FormData(form),
                    headers: { Accept: 'application/json' },
                });
                if (!res.ok) throw new Error(String(res.status));
                form.reset();
                status.className = 'form__status is-ok';
                status.textContent = 'Message sent. Thanks, I will get back to you soon.';
                label.textContent = 'Sent';
                setTimeout(() => { label.textContent = 'Send message'; }, 3000);
            } catch {
                status.className = 'form__status is-err';
                status.textContent = 'The message could not be sent. Check your connection and try again, or reach me on LinkedIn.';
                label.textContent = 'Send message';
            } finally {
                btn.disabled = false;
                btn.classList.remove('is-sending');
            }
        });
    }

    const year = document.querySelector('[data-year]');
    if (year) year.textContent = new Date().getFullYear();

    initWords();
    initMarquee();
    initNav();
    initMenu();
    initReveals();
    initProjects();
    initTilt();
    initForm();
    initParticles();
})();
