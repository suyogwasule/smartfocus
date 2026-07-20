// ============================================================
// Smart Focus - Content Script
// Injected into all pages for warnings and overlays
// ============================================================

(function () {
    'use strict';

    let warningOverlay = null;
    let floatingTimer = null;

    // Listen for messages from background
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'DISTRACTION_WARNING') {
            showDistractionWarning(msg.tabSwitches);
        }
        if (msg.type === 'SESSION_STARTED') {
            showSessionNotice('🎯 Focus session started: ' + (msg.session?.taskName || ''));
        }
        if (msg.type === 'SESSION_ENDED') {
            showSessionNotice(msg.completed ? '✅ Session complete! Great work!' : '⏹️ Session ended.');
            removeFloatingTimer();
        }
        if (msg.type === 'BREAK_STARTED') {
            showSessionNotice('☕ Break time! Relax for a few minutes.');
        }
        if (msg.type === 'TIMER_TICK' && msg.session) {
            updateFloatingTimer(msg.session);
        }
    });

    // Distraction warning overlay
    function showDistractionWarning(tabSwitches) {
        if (warningOverlay) return; // Don't stack warnings

        warningOverlay = document.createElement('div');
        warningOverlay.id = 'sf-distraction-overlay';
        warningOverlay.innerHTML = `
      <div class="sf-warning-card">
        <div class="sf-warning-icon">⚠️</div>
        <h3 class="sf-warning-title">You seem distracted!</h3>
        <p class="sf-warning-text">You've switched tabs ${tabSwitches} times. Try to stay focused on your task.</p>
        <button class="sf-warning-btn" id="sf-dismiss-warning">Got it, I'll focus!</button>
      </div>
    `;
        document.body.appendChild(warningOverlay);

        // Auto-dismiss after 8 seconds
        const timer = setTimeout(() => {
            dismissWarning();
        }, 8000);

        warningOverlay.querySelector('#sf-dismiss-warning').addEventListener('click', () => {
            clearTimeout(timer);
            dismissWarning();
        });
    }

    function dismissWarning() {
        if (warningOverlay) {
            warningOverlay.classList.add('sf-hiding');
            setTimeout(() => {
                warningOverlay?.remove();
                warningOverlay = null;
            }, 300);
        }
    }

    // Session notice toast
    function showSessionNotice(message) {
        const notice = document.createElement('div');
        notice.className = 'sf-session-notice';
        notice.textContent = message;
        document.body.appendChild(notice);

        requestAnimationFrame(() => {
            notice.classList.add('sf-show');
        });

        setTimeout(() => {
            notice.classList.remove('sf-show');
            setTimeout(() => notice.remove(), 300);
        }, 4000);
    }

    // Floating mini timer
    function updateFloatingTimer(session) {
        if (!session.active) {
            removeFloatingTimer();
            return;
        }

        if (!floatingTimer) {
            floatingTimer = document.createElement('div');
            floatingTimer.id = 'sf-floating-timer';
            floatingTimer.innerHTML = `
        <span class="sf-ft-icon">🎯</span>
        <span class="sf-ft-time" id="sf-ft-time">--:--</span>
        <span class="sf-ft-task" id="sf-ft-task"></span>
      `;
            document.body.appendChild(floatingTimer);

            // Make draggable
            makeDraggable(floatingTimer);
        }

        const mins = Math.floor(session.remaining / 60);
        const secs = session.remaining % 60;
        const timeEl = floatingTimer.querySelector('#sf-ft-time');
        const taskEl = floatingTimer.querySelector('#sf-ft-task');

        if (timeEl) timeEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        if (taskEl) taskEl.textContent = session.taskName;

        // Color change when low time
        if (session.remaining < 60) {
            floatingTimer.classList.add('sf-ft-urgent');
        } else {
            floatingTimer.classList.remove('sf-ft-urgent');
        }
    }

    function removeFloatingTimer() {
        if (floatingTimer) {
            floatingTimer.remove();
            floatingTimer = null;
        }
    }

    function makeDraggable(el) {
        let isDragging = false;
        let offsetX, offsetY;

        el.addEventListener('mousedown', (e) => {
            isDragging = true;
            offsetX = e.clientX - el.getBoundingClientRect().left;
            offsetY = e.clientY - el.getBoundingClientRect().top;
            el.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            el.style.left = (e.clientX - offsetX) + 'px';
            el.style.top = (e.clientY - offsetY) + 'px';
            el.style.right = 'auto';
            el.style.bottom = 'auto';
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
            if (el) el.style.cursor = 'grab';
        });
    }

    // Check current session on load
    try {
        chrome.runtime.sendMessage({ action: 'GET_SESSION' }, (session) => {
            if (session && session.active) {
                updateFloatingTimer(session);
            }
        });
    } catch (e) {
        // Extension context may be invalidated
    }
})();
