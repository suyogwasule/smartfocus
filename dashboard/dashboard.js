// ============================================================
// Smart Focus - Dashboard Controller
// ============================================================

document.addEventListener('DOMContentLoaded', init);

async function init() {
    setupNavigation();
    setupEventListeners();
    await loadAllData();
}

// ---- NAVIGATION ----
function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            item.classList.add('active');
            document.getElementById('page-' + item.dataset.page).classList.add('active');
        });
    });
}

// ---- EVENT LISTENERS ----
function setupEventListeners() {
    // Block list
    document.getElementById('dashAddBlock').addEventListener('click', dashAddBlock);
    document.getElementById('dashNewBlock').addEventListener('keypress', e => {
        if (e.key === 'Enter') dashAddBlock();
    });

    // Groups
    document.getElementById('dashCreateGroup').addEventListener('click', () => {
        const form = document.getElementById('dashGroupForm');
        form.classList.toggle('hidden');
        document.getElementById('groupFormTitle').textContent = 'Create Group';
        document.getElementById('dashJoinCodeRow').classList.add('hidden');
        form.dataset.mode = 'create';
    });

    document.getElementById('dashJoinGroup').addEventListener('click', () => {
        const form = document.getElementById('dashGroupForm');
        form.classList.toggle('hidden');
        document.getElementById('groupFormTitle').textContent = 'Join Group';
        document.getElementById('dashJoinCodeRow').classList.remove('hidden');
        form.dataset.mode = 'join';
    });

    document.getElementById('dashConfirmGroup').addEventListener('click', dashConfirmGroup);

    // Goals
    document.getElementById('saveDailyGoal').addEventListener('click', async () => {
        const val = parseInt(document.getElementById('dailyGoalInput').value);
        if (val > 0) {
            await sendMessage({ action: 'UPDATE_GOALS', goals: { dailyFocusMinutes: val } });
            showToast('Daily goal saved!');
            await loadAllData();
        }
    });

    document.getElementById('saveWeeklyGoal').addEventListener('click', async () => {
        const val = parseInt(document.getElementById('weeklyGoalInput').value);
        if (val > 0) {
            await sendMessage({ action: 'UPDATE_GOALS', goals: { weeklyFocusMinutes: val } });
            showToast('Weekly goal saved!');
            await loadAllData();
        }
    });

    // Settings
    document.getElementById('saveSettings').addEventListener('click', saveSettings);
}

// ---- DATA LOADING ----
async function loadAllData() {
    const [today, history, scoreData, goalProgress, blockList, groups, settings, goals] = await Promise.all([
        sendMessage({ action: 'GET_TODAY' }),
        sendMessage({ action: 'GET_HISTORY' }),
        sendMessage({ action: 'GET_FOCUS_SCORE' }),
        sendMessage({ action: 'GET_GOAL_PROGRESS' }),
        sendMessage({ action: 'GET_BLOCKLIST' }),
        sendMessage({ action: 'GET_GROUPS' }),
        sendMessage({ action: 'GET_SETTINGS' }),
        sendMessage({ action: 'GET_GOALS' }),
    ]);

    renderOverview(today, scoreData, goalProgress);
    renderAnalytics(today, history);
    renderGoals(goalProgress, goals);
    renderBlockList(blockList);
    renderGroups(groups);
    renderHistory(today, history);
    renderSettings(settings);
}

// ---- OVERVIEW PAGE ----
function renderOverview(today, scoreData, goalProgress) {
    document.getElementById('dateDisplay').textContent = new Date().toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    document.getElementById('overFocusTime').textContent = formatTimeShort(today.focusTime || 0);
    document.getElementById('overDistTime').textContent = formatTimeShort(today.distractionTime || 0);
    document.getElementById('overScore').textContent = scoreData.score;
    document.getElementById('overSessions').textContent = today.sessions ? today.sessions.length : 0;

    renderTopSites(today.siteTimes || {});
}

function renderTopSites(siteTimes) {
    const container = document.getElementById('dashTopSites');
    const entries = Object.entries(siteTimes).sort((a, b) => b[1] - a[1]).slice(0, 8);

    if (entries.length === 0) {
        container.innerHTML = '<div class="empty-dash"><div class="empty-dash-icon">📊</div>No browsing data yet today</div>';
        return;
    }

    const maxTime = entries[0][1];
    container.innerHTML = entries.map(([domain, secs], i) => `
    <div class="top-site-item">
      <span class="top-site-rank">#${i + 1}</span>
      <span class="top-site-domain">${escapeHtml(domain)}</span>
      <div class="top-site-bar">
        <div class="top-site-bar-fill" style="width:${(secs / maxTime * 100).toFixed(1)}%"></div>
      </div>
      <span class="top-site-time">${formatTimeShort(secs)}</span>
    </div>
  `).join('');
}

// ---- ANALYTICS PAGE ----
function renderAnalytics(today, history) {
    drawWeeklyChart('weeklyChart', today, history);
    drawWeeklyChart('analyticsChart', today, history);
    drawScoreChart('scoreChart', today, history);
}

function drawWeeklyChart(canvasId, today, history) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Get last 7 days data
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const label = i === 0 ? 'Today' : dayNames[date.getDay()];

        let focusMin = 0, distMin = 0;
        if (i === 0) {
            focusMin = (today.focusTime || 0) / 60;
            distMin = (today.distractionTime || 0) / 60;
        } else {
            const dayData = (history || []).find(h => h.date === dateStr);
            if (dayData) {
                focusMin = (dayData.focusTime || 0) / 60;
                distMin = (dayData.distractionTime || 0) / 60;
            }
        }
        days.push({ label, focus: focusMin, distraction: distMin });
    }

    const maxVal = Math.max(10, ...days.map(d => Math.max(d.focus, d.distraction)));
    const chartPadding = { top: 20, right: 20, bottom: 40, left: 50 };
    const chartW = W - chartPadding.left - chartPadding.right;
    const chartH = H - chartPadding.top - chartPadding.bottom;
    const barGroupWidth = chartW / days.length;
    const barWidth = barGroupWidth * 0.3;

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = chartPadding.top + (chartH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(chartPadding.left, y);
        ctx.lineTo(W - chartPadding.right, y);
        ctx.stroke();

        // Labels
        ctx.fillStyle = '#555577';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'right';
        const val = Math.round(maxVal - (maxVal / 4) * i);
        ctx.fillText(val + 'm', chartPadding.left - 8, y + 4);
    }

    // Bars
    days.forEach((day, i) => {
        const x = chartPadding.left + barGroupWidth * i + barGroupWidth * 0.15;
        const focusH = (day.focus / maxVal) * chartH;
        const distH = (day.distraction / maxVal) * chartH;

        // Focus bar
        const focusGrad = ctx.createLinearGradient(0, chartPadding.top + chartH - focusH, 0, chartPadding.top + chartH);
        focusGrad.addColorStop(0, '#10b981');
        focusGrad.addColorStop(1, 'rgba(16, 185, 129, 0.3)');
        ctx.fillStyle = focusGrad;
        roundRect(ctx, x, chartPadding.top + chartH - focusH, barWidth, focusH, 4);

        // Distraction bar
        const distGrad = ctx.createLinearGradient(0, chartPadding.top + chartH - distH, 0, chartPadding.top + chartH);
        distGrad.addColorStop(0, '#ef4444');
        distGrad.addColorStop(1, 'rgba(239, 68, 68, 0.3)');
        ctx.fillStyle = distGrad;
        roundRect(ctx, x + barWidth + 4, chartPadding.top + chartH - distH, barWidth, distH, 4);

        // Day label
        ctx.fillStyle = '#8888aa';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(day.label, x + barWidth, chartPadding.top + chartH + 20);
    });

    // Legend
    ctx.fillStyle = '#10b981';
    ctx.fillRect(W - 140, 8, 10, 10);
    ctx.fillStyle = '#8888aa';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Focus', W - 126, 17);

    ctx.fillStyle = '#ef4444';
    ctx.fillRect(W - 80, 8, 10, 10);
    ctx.fillStyle = '#8888aa';
    ctx.fillText('Distraction', W - 66, 17);
}

function drawScoreChart(canvasId, today, history) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const days = [];
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const label = i === 0 ? 'Today' : dayNames[date.getDay()];

        let score = 100;
        if (i === 0) {
            const total = (today.focusTime || 0) + (today.distractionTime || 0);
            score = total > 0 ? Math.round(((today.focusTime || 0) / total) * 100) : 100;
        } else {
            const dayData = (history || []).find(h => h.date === dateStr);
            if (dayData) {
                const total = (dayData.focusTime || 0) + (dayData.distractionTime || 0);
                score = total > 0 ? Math.round(((dayData.focusTime || 0) / total) * 100) : 100;
            }
        }
        days.push({ label, score });
    }

    const padding = { top: 20, right: 20, bottom: 40, left: 50 };
    const chartW = W - padding.left - padding.right;
    const chartH = H - padding.top - padding.bottom;

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i <= 4; i++) {
        const y = padding.top + (chartH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(W - padding.right, y);
        ctx.stroke();
        ctx.fillStyle = '#555577';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(Math.round(100 - 25 * i), padding.left - 8, y + 4);
    }

    // Line
    ctx.beginPath();
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';

    const points = days.map((d, i) => ({
        x: padding.left + (chartW / (days.length - 1)) * i,
        y: padding.top + chartH - (d.score / 100) * chartH,
    }));

    points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    // Fill under line
    ctx.lineTo(points[points.length - 1].x, padding.top + chartH);
    ctx.lineTo(points[0].x, padding.top + chartH);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
    grad.addColorStop(0, 'rgba(99, 102, 241, 0.2)');
    grad.addColorStop(1, 'rgba(99, 102, 241, 0)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Points and labels
    points.forEach((p, i) => {
        ctx.fillStyle = '#6366f1';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#8888aa';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(days[i].label, p.x, padding.top + chartH + 20);
    });
}

function roundRect(ctx, x, y, w, h, r) {
    if (h < 1) return;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
}

// ---- GOALS PAGE ----
function renderGoals(goalProgress, goals) {
    const circumference = 2 * Math.PI * 52;

    // Daily
    document.getElementById('dailyGoalPercent').textContent = goalProgress.dailyProgress + '%';
    document.getElementById('dailyGoalText').textContent = `${goalProgress.dailyMinutes} / ${goals.dailyFocusMinutes} min`;
    document.getElementById('dailyGoalRing').style.strokeDashoffset = circumference * (1 - goalProgress.dailyProgress / 100);
    document.getElementById('dailyGoalInput').value = goals.dailyFocusMinutes;

    // Weekly
    document.getElementById('weeklyGoalPercent').textContent = goalProgress.weeklyProgress + '%';
    document.getElementById('weeklyGoalText').textContent = `${goalProgress.weeklyMinutes} / ${goals.weeklyFocusMinutes} min`;
    document.getElementById('weeklyGoalRing').style.strokeDashoffset = circumference * (1 - goalProgress.weeklyProgress / 100);
    document.getElementById('weeklyGoalInput').value = goals.weeklyFocusMinutes;
}

// ---- BLOCK LIST PAGE ----
function renderBlockList(blockList) {
    document.getElementById('dashBlockCount').textContent = blockList.length;
    const container = document.getElementById('dashBlockList');

    if (blockList.length === 0) {
        container.innerHTML = '<div class="empty-dash"><div class="empty-dash-icon">🛡️</div>No blocked sites. Add some to stay focused!</div>';
        return;
    }

    container.innerHTML = blockList.map(site => `
    <div class="block-card">
      <span class="block-card-domain">🚫 ${escapeHtml(site)}</span>
      <button class="block-card-remove" data-site="${escapeHtml(site)}">✕</button>
    </div>
  `).join('');

    container.querySelectorAll('.block-card-remove').forEach(btn => {
        btn.addEventListener('click', async () => {
            const result = await sendMessage({ action: 'REMOVE_BLOCK', site: btn.dataset.site });
            if (result.error) showToast(result.error);
            else { showToast('Site removed!'); await loadAllData(); }
        });
    });
}

async function dashAddBlock() {
    const input = document.getElementById('dashNewBlock');
    const site = input.value.trim();
    if (!site) return;
    await sendMessage({ action: 'ADD_BLOCK', site });
    input.value = '';
    showToast(`🚫 ${site} blocked!`);
    await loadAllData();
}

// ---- GROUPS PAGE ----
function renderGroups(groups) {
    const container = document.getElementById('dashGroupsList');

    if (!groups || Object.keys(groups).length === 0) {
        container.innerHTML = '<div class="empty-dash"><div class="empty-dash-icon">👥</div>No groups yet. Create or join one to start collaborative focus!</div>';
        return;
    }

    container.innerHTML = Object.entries(groups).map(([code, group]) => {
        const membersHtml = group.members.map(m =>
            `<span class="member-tag ${m.isAdmin ? 'admin' : ''}">${m.isAdmin ? '👑 ' : ''}${escapeHtml(m.name)}</span>`
        ).join('');

        const sessionsHtml = (group.scheduledSessions || []).map(s => {
            const statusClass = s.status === 'active' ? 'active' : (s.status === 'completed' ? 'completed' : 'upcoming');
            return `
        <div class="scheduled-item">
          <span class="scheduled-item-task">${escapeHtml(s.taskName)}</span>
          <span class="scheduled-item-time">${new Date(s.scheduledTime).toLocaleString()}</span>
          <span class="scheduled-item-status ${statusClass}">${s.status}</span>
        </div>
      `;
        }).join('');

        return `
      <div class="dash-group-card">
        <div class="dash-group-header">
          <span class="dash-group-name">${escapeHtml(group.name)}</span>
          <span class="dash-group-code">${code}</span>
        </div>
        <div class="dash-group-meta">Admin: ${escapeHtml(group.admin)} • Created ${new Date(group.created).toLocaleDateString()}</div>
        <div class="dash-group-members">${membersHtml}</div>
        ${sessionsHtml ? `<div class="dash-group-sessions"><h5>Scheduled Sessions</h5>${sessionsHtml}</div>` : ''}
        <div class="dash-group-actions">
          <button onclick="dashScheduleSession('${code}')">📅 Schedule Session</button>
          <button onclick="navigator.clipboard.writeText('${code}');showToast('Code copied!')">📋 Copy Code</button>
        </div>
      </div>
    `;
    }).join('');
}

async function dashConfirmGroup() {
    const form = document.getElementById('dashGroupForm');
    const mode = form.dataset.mode;
    const name = document.getElementById('dashGroupName').value.trim();
    const userName = document.getElementById('dashUserName').value.trim();

    if (!userName) { showToast('Please enter your name'); return; }

    if (mode === 'create') {
        if (!name) { showToast('Please enter a group name'); return; }
        const result = await sendMessage({ action: 'CREATE_GROUP', groupName: name, adminName: userName });
        if (result.error) { showToast(result.error); return; }
        showToast(`Group created! Code: ${result.code}`);
    } else {
        const code = document.getElementById('dashJoinCode').value.trim().toUpperCase();
        if (!code) { showToast('Please enter the group code'); return; }
        const result = await sendMessage({ action: 'JOIN_GROUP', code, memberName: userName });
        if (result.error) { showToast(result.error); return; }
        showToast(`Joined group "${result.group.name}"!`);
    }

    form.classList.add('hidden');
    await loadAllData();
}

window.dashScheduleSession = function (code) {
    const taskName = prompt('Task name for this session:');
    if (!taskName) return;
    const timeStr = prompt('Session time (e.g., 2026-03-20T20:00):');
    if (!timeStr) return;
    const duration = parseInt(prompt('Duration in minutes (e.g., 45):') || '45');

    sendMessage({
        action: 'SCHEDULE_GROUP_SESSION',
        code,
        taskName,
        scheduledTime: new Date(timeStr).toISOString(),
        duration,
    }).then(result => {
        if (result.error) showToast(result.error);
        else { showToast('📅 Session scheduled!'); loadAllData(); }
    });
};

// ---- HISTORY PAGE ----
function renderHistory(today, history) {
    const body = document.getElementById('historyBody');
    const allSessions = [];

    // Today's sessions
    if (today.sessions) {
        today.sessions.forEach(s => {
            allSessions.push({ ...s, date: today.date });
        });
    }

    // Historical sessions
    if (history) {
        history.forEach(day => {
            if (day.sessions) {
                day.sessions.forEach(s => {
                    allSessions.push({ ...s, date: day.date });
                });
            }
        });
    }

    if (allSessions.length === 0) {
        body.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:#555577">No sessions recorded yet</td></tr>';
        return;
    }

    allSessions.sort((a, b) => new Date(b.completedAt || b.date) - new Date(a.completedAt || a.date));

    body.innerHTML = allSessions.slice(0, 50).map(s => `
    <tr>
      <td>${s.completedAt ? new Date(s.completedAt).toLocaleString() : s.date}</td>
      <td>${escapeHtml(s.task || 'Untitled')}</td>
      <td>${s.duration} min</td>
      <td>${s.type === 'group' ? '👥 Group' : '🧍 Solo'}</td>
    </tr>
  `).join('');
}

// ---- SETTINGS ----
async function renderSettings(settings) {
    document.getElementById('setPomWork').value = settings.pomodoroWork || 25;
    document.getElementById('setPomBreak').value = settings.pomodoroBreak || 5;
    document.getElementById('setPomLong').value = settings.pomodoroLongBreak || 15;
    document.getElementById('setTabThreshold').value = settings.tabSwitchThreshold || 10;
    document.getElementById('setSound').checked = settings.soundEnabled !== false;
    document.getElementById('setBreakReminder').checked = settings.breakReminder !== false;
}

async function saveSettings() {
    const settings = {
        pomodoroWork: parseInt(document.getElementById('setPomWork').value),
        pomodoroBreak: parseInt(document.getElementById('setPomBreak').value),
        pomodoroLongBreak: parseInt(document.getElementById('setPomLong').value),
        tabSwitchThreshold: parseInt(document.getElementById('setTabThreshold').value),
        soundEnabled: document.getElementById('setSound').checked,
        breakReminder: document.getElementById('setBreakReminder').checked,
    };
    await sendMessage({ action: 'UPDATE_SETTINGS', settings });
    showToast('Settings saved!');
}

// ---- HELPERS ----
function sendMessage(msg) {
    return new Promise(resolve => {
        chrome.runtime.sendMessage(msg, response => resolve(response || {}));
    });
}

function formatTimeShort(seconds) {
    if (!seconds || seconds < 60) return `${seconds || 0}s`;
    const m = Math.floor(seconds / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function showToast(message) {
    let toast = document.querySelector('.toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
}
