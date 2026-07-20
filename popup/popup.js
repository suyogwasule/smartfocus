// ============================================================
// Smart Focus - Popup Controller (v3.0 — Forest-Style Rooms)
// Simplified group flow: Create Room → Join Room → Start → 
// If anyone cancels → session disrupted for ALL
// ============================================================

document.addEventListener('DOMContentLoaded', init);

// ---- STATE ----
let currentSession = null;
let tickInterval = null;
let activeGroupCode = null;   // currently viewed room
let currentUserName = '';     // persisted user identity
let groupPollInterval = null; // polls Firebase for real-time updates

// ---- INIT ----
async function init() {
    console.log('[SmartFocus] Popup init...');
    setupTabs();
    setupEventListeners();
    await restoreUserIdentity();
    await restoreMode();
    await loadState();

    // Listen for background messages
    chrome.runtime.onMessage.addListener(handleBackgroundMessage);

    // Refresh state every second when popup is open
    tickInterval = setInterval(loadState, 1000);
}

// ---- RESTORE USER IDENTITY ----
async function restoreUserIdentity() {
    return new Promise((resolve) => {
        chrome.storage.local.get('smartFocusUserName', (result) => {
            currentUserName = result.smartFocusUserName || '';
            console.log('[SmartFocus] Restored user:', currentUserName);
            resolve();
        });
    });
}

function saveUserIdentity(name) {
    currentUserName = name;
    chrome.storage.local.set({ smartFocusUserName: name });
    console.log('[SmartFocus] Saved user identity:', name);
}

// ---- MODE PERSISTENCE ----
async function restoreMode() {
    return new Promise((resolve) => {
        chrome.storage.local.get('selectedMode', (result) => {
            const mode = result.selectedMode || 'solo';
            const modeSelect = document.getElementById('sessionMode');
            if (modeSelect) modeSelect.value = mode;
            console.log('[SmartFocus] Restored mode:', mode);

            // If group mode was selected, switch to group tab
            if (mode === 'group') {
                switchToTab('group');
            }
            resolve();
        });
    });
}

function switchToTab(tabName) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const tabBtn = document.querySelector(`.tab[data-tab="${tabName}"]`);
    if (tabBtn) tabBtn.classList.add('active');
    const tabContent = document.getElementById('tab-' + tabName);
    if (tabContent) tabContent.classList.add('active');
}

// ---- TABS ----
function setupTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
        });
    });
}

// ---- EVENT LISTENERS ----
function setupEventListeners() {
    // Dashboard button
    document.getElementById('dashboardBtn').addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    // Mode change — persist and switch UI
    document.getElementById('sessionMode').addEventListener('change', (e) => {
        const mode = e.target.value;
        chrome.storage.local.set({ selectedMode: mode });
        console.log('[SmartFocus] Mode changed to:', mode);
        if (mode === 'group') {
            switchToTab('group');
        }
    });

    // Start session
    document.getElementById('startBtn').addEventListener('click', startFocusSession);

    // Timer controls
    document.getElementById('pauseBtn').addEventListener('click', togglePause);
    document.getElementById('stopBtn').addEventListener('click', endFocusSession);
    document.getElementById('breakBtn').addEventListener('click', takeBreak);

    // Block list
    document.getElementById('addBlockBtn').addEventListener('click', addBlockedSite);
    document.getElementById('newBlockSite').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addBlockedSite();
    });

    // Group Lobby
    document.getElementById('createGroupBtn').addEventListener('click', openCreateGroupModal);
    document.getElementById('joinGroupBtn').addEventListener('click', openJoinGroupModal);
    document.getElementById('confirmCreateGroup').addEventListener('click', createRoom);
    document.getElementById('confirmJoinGroup').addEventListener('click', joinRoom);
    document.getElementById('copyCodeBtn').addEventListener('click', copyGroupCode);

    // Join Room Modal
    document.getElementById('closeJoinGroupModal').addEventListener('click', closeJoinGroupModal);
    document.getElementById('cancelJoinGroup').addEventListener('click', closeJoinGroupModal);
    document.getElementById('joinGroupModal').addEventListener('click', (e) => {
        if (e.target.id === 'joinGroupModal') closeJoinGroupModal();
    });

    // Create Room Modal
    document.getElementById('closeCreateGroupModal').addEventListener('click', closeCreateGroupModal);
    document.getElementById('cancelCreateGroup').addEventListener('click', closeCreateGroupModal);
    document.getElementById('createGroupModal').addEventListener('click', (e) => {
        if (e.target.id === 'createGroupModal') closeCreateGroupModal();
    });

    // Room Detail View
    document.getElementById('backToLobby').addEventListener('click', exitGroupDetail);
    document.getElementById('startGroupSessionBtn').addEventListener('click', startGroupSession);
    document.getElementById('cancelRoomBtn').addEventListener('click', cancelRoom);
    document.getElementById('disruptSessionBtn').addEventListener('click', disruptSession);
    document.getElementById('leaveGroupBtn').addEventListener('click', leaveRoom);

    // Custom duration toggles
    document.getElementById('duration').addEventListener('change', (e) => {
        const customInput = document.getElementById('customDuration');
        if (e.target.value === 'custom') {
            customInput.classList.remove('hidden');
            customInput.focus();
        } else {
            customInput.classList.add('hidden');
        }
    });
    document.getElementById('createDuration').addEventListener('change', (e) => {
        const customInput = document.getElementById('createCustomDuration');
        if (e.target.value === 'custom') {
            customInput.classList.remove('hidden');
            customInput.focus();
        } else {
            customInput.classList.add('hidden');
        }
    });
}

// ---- LOAD STATE ----
async function loadState() {
    try {
        const [session, today, scoreData, goalProgress, blockList] = await Promise.all([
            sendMessage({ action: 'GET_SESSION' }),
            sendMessage({ action: 'GET_TODAY' }),
            sendMessage({ action: 'GET_FOCUS_SCORE' }),
            sendMessage({ action: 'GET_GOAL_PROGRESS' }),
            sendMessage({ action: 'GET_BLOCKLIST' }),
        ]);

        currentSession = session;
        updateTimerUI(session);
        updateStatsUI(today, scoreData, goalProgress);
        updateBlockListUI(blockList);

        // ---- CRITICAL: Check group session disruption from ANY tab ----
        // This ensures disruption is detected even when on Focus tab, not just Group detail
        if (session && (session.active || session.pausedAt) && session.type === 'group' && session.groupCode) {
            await checkGroupDisruption(session.groupCode);
        }

        // Load rooms from Firebase if configured, else from local
        await loadGroupsUI();
    } catch (e) {
        console.error('[SmartFocus] Failed to load state:', e);
    }
}

// ---- TIMER UI ----
function updateTimerUI(session) {
    const taskEntry = document.getElementById('taskEntry');
    const timerView = document.getElementById('timerView');

    const isSessionVisible = session && (session.active || (session.pausedAt && session.remaining > 0));

    if (isSessionVisible) {
        taskEntry.classList.add('hidden');
        timerView.classList.remove('hidden');

        const remaining = Math.max(0, Math.floor(session.remaining || 0));
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        document.getElementById('timerDisplay').textContent =
            `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

        const labelEl = document.getElementById('timerLabel');
        const progressEl = document.getElementById('timerProgress');

        if (!session.active && session.pausedAt) {
            labelEl.textContent = 'PAUSED';
            labelEl.classList.remove('break-mode');
            progressEl.classList.remove('break-mode');
        } else if (session.mode === 'break') {
            labelEl.textContent = 'BREAK';
            labelEl.classList.add('break-mode');
            progressEl.classList.add('break-mode');
        } else {
            labelEl.textContent = 'FOCUS';
            labelEl.classList.remove('break-mode');
            progressEl.classList.remove('break-mode');
        }

        document.getElementById('timerTask').textContent = session.taskName;

        const total = session.duration * 60;
        const progress = total > 0 ? 1 - (remaining / total) : 0;
        const circumference = 2 * Math.PI * 88;
        progressEl.style.strokeDashoffset = circumference * (1 - progress);

        const elapsed = Math.max(0, total - remaining);
        document.getElementById('sessionInfo').textContent =
            `${session.type === 'group' ? '👥 Group' : '🧍 Solo'} • ${formatTime(elapsed)} elapsed`;

        const badge = document.getElementById('hardModeBadge');
        if (session.hardMode) {
            badge.classList.remove('hidden');
            document.getElementById('pauseBtn').classList.add('hidden');
            document.getElementById('stopBtn').classList.add('hidden');
        } else {
            badge.classList.add('hidden');
            document.getElementById('pauseBtn').classList.remove('hidden');
            document.getElementById('stopBtn').classList.remove('hidden');
        }

        const pauseBtn = document.getElementById('pauseBtn');
        if (!session.active && session.pausedAt) {
            pauseBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
            pauseBtn.title = 'Resume';
        } else {
            pauseBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
            pauseBtn.title = 'Pause';
        }
    } else {
        taskEntry.classList.remove('hidden');
        timerView.classList.add('hidden');
    }
}

// ---- STATS UI ----
function updateStatsUI(today, scoreData, goalProgress) {
    document.getElementById('focusTimeStat').textContent = formatTimeShort(today.focusTime);
    document.getElementById('distractionTimeStat').textContent = formatTimeShort(today.distractionTime);
    document.getElementById('focusScoreStat').textContent = scoreData.score;

    const goals = goalProgress;
    document.getElementById('goalText').textContent =
        `${goals.dailyMinutes} / ${120} min`;
    document.getElementById('goalBarFill').style.width = `${goals.dailyProgress}%`;

    document.getElementById('totalSessions').textContent = today.sessions ? today.sessions.length : 0;
    document.getElementById('tabSwitches').textContent = today.tabSwitches || 0;

    updateTopSites(today.siteTimes);
}

function updateTopSites(siteTimes) {
    const list = document.getElementById('topSitesList');
    if (!siteTimes || Object.keys(siteTimes).length === 0) {
        list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-text">No site data yet. Start browsing!</div></div>';
        return;
    }

    const sorted = Object.entries(siteTimes).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const maxTime = sorted[0][1];

    list.innerHTML = sorted.map(([domain, seconds]) => `
    <div class="site-row">
      <span class="site-domain">${escapeHtml(domain)}</span>
      <div class="site-bar-wrapper">
        <div class="site-bar" style="width: ${(seconds / maxTime * 100)}%"></div>
      </div>
      <span class="site-time">${formatTimeShort(seconds)}</span>
    </div>
  `).join('');
}

// ---- BLOCK LIST UI ----
function updateBlockListUI(blockList) {
    document.getElementById('blockCount').textContent = blockList.length;
    const listEl = document.getElementById('blockListEl');

    if (blockList.length === 0) {
        listEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🛡️</div><div class="empty-state-text">No blocked sites yet</div></div>';
        return;
    }

    listEl.innerHTML = blockList.map(site => `
    <li class="block-item">
      <span class="block-item-domain">🚫 ${escapeHtml(site)}</span>
      <button class="block-item-remove" data-site="${escapeHtml(site)}" title="Remove">✕</button>
    </li>
  `).join('');

    listEl.querySelectorAll('.block-item-remove').forEach(btn => {
        btn.addEventListener('click', async () => {
            const result = await sendMessage({ action: 'REMOVE_BLOCK', site: btn.dataset.site });
            if (result.error) {
                showToast(result.error);
            } else {
                await loadState();
            }
        });
    });
}

// ============================================================
// FOREST-STYLE GROUP ROOMS
// Uses Firebase REST API for real-time cross-user sync
// Core mechanic: if anyone cancels → session disrupted for ALL
// ============================================================

function generateGroupCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

// ---- ROOMS LIST UI ----
async function loadGroupsUI() {
    let groups = {};

    if (typeof FirebaseDB !== 'undefined' && FirebaseDB.isConfigured()) {
        let myGroupCodes = await getMyGroupCodes();
        let codesToRemove = [];

        for (const code of myGroupCodes) {
            const group = await FirebaseDB.get(`groups/${code}`);
            if (group && !group.deleted) {
                // Auto-cleanup: If the room is permanently closed (ended/disrupted), remove it
                if (group.sessionState === 'ended' || group.sessionState === 'disrupted') {
                    codesToRemove.push(code);
                } else {
                    groups[code] = group;
                }
            } else if (!group || group.deleted) {
                codesToRemove.push(code); // Clean up broken/deleted refs too
            }
        }

        // Commit removals
        if (codesToRemove.length > 0) {
            for (const c of codesToRemove) {
                await removeMyGroupCode(c);
            }
        }

    } else {
        groups = await sendMessage({ action: 'GET_GROUPS' }) || {};
    }

    updateGroupsUI(groups);
}

async function getMyGroupCodes() {
    return new Promise((resolve) => {
        chrome.storage.local.get('myGroupCodes', (result) => {
            resolve(result.myGroupCodes || []);
        });
    });
}

async function addMyGroupCode(code) {
    const codes = await getMyGroupCodes();
    if (!codes.includes(code)) {
        codes.push(code);
        await new Promise((resolve) => {
            chrome.storage.local.set({ myGroupCodes: codes }, resolve);
        });
    }
}

async function removeMyGroupCode(code) {
    let codes = await getMyGroupCodes();
    codes = codes.filter(c => c !== code);
    await new Promise((resolve) => {
        chrome.storage.local.set({ myGroupCodes: codes }, resolve);
    });
}

function updateGroupsUI(groups) {
    const listEl = document.getElementById('groupsList');

    if (!groups || Object.keys(groups).length === 0) {
        listEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div><div class="empty-state-text">No rooms yet. Create or join one!</div></div>';
        return;
    }

    listEl.innerHTML = Object.entries(groups).map(([code, group]) => {
        const memberCount = group.members ? Object.keys(group.members).length : 0;
        const state = group.sessionState || 'waiting';
        let stateLabel = '⏳ Waiting';
        if (state === 'running') stateLabel = '🟢 In Session';
        else if (state === 'disrupted') stateLabel = '💥 Disrupted';
        else if (state === 'ended') stateLabel = '✅ Ended';

        return `
      <div class="group-card" data-code="${code}" onclick="openGroupDetail('${code}')">
        <div class="group-card-header">
          <span class="group-card-name">${escapeHtml(group.name)}</span>
          <span class="group-card-code">${code}</span>
        </div>
        <div class="group-card-meta">
          👤 ${memberCount} member${memberCount > 1 ? 's' : ''} • Admin: ${escapeHtml(group.admin)}
          <br>${stateLabel} • ${group.duration || 25} min
        </div>
      </div>
    `;
    }).join('');
}

// ---- CREATE ROOM MODAL ----
function openCreateGroupModal() {
    const modal = document.getElementById('createGroupModal');
    modal.classList.remove('hidden');
    document.getElementById('groupName').value = '';
    document.getElementById('adminName').value = currentUserName || '';
    document.getElementById('createDuration').value = '25';
    console.log('[SmartFocus] Create Room modal opened');
}

function closeCreateGroupModal() {
    document.getElementById('createGroupModal').classList.add('hidden');
}

// ---- CREATE ROOM (simplified Forest-style) ----
async function createRoom() {
    const name = document.getElementById('groupName').value.trim();
    const admin = document.getElementById('adminName').value.trim();
    let duration = parseInt(document.getElementById('createDuration').value);

    if (!name || !admin) {
        showToast('Please enter room name and your name');
        return;
    }

    // Handle custom duration
    if (isNaN(duration) || duration <= 0) {
        const customMin = parseInt(document.getElementById('createCustomDuration')?.value);
        if (isNaN(customMin) || customMin <= 0) {
            showToast('Please enter a valid custom duration');
            return;
        }
        duration = customMin;
    }

    saveUserIdentity(admin);
    const code = generateGroupCode();
    console.log('[SmartFocus] Creating room:', { code, name, admin, duration });

    const groupData = {
        name: name,
        admin: admin,
        duration: duration,
        members: {
            [admin]: { name: admin, joined: Date.now(), isAdmin: true, status: 'active' }
        },
        sessionState: 'waiting',  // waiting | running | disrupted | ended
        sessionActive: false,
        startedAt: null,
        disruptedBy: null,
        created: Date.now(),
        deleted: false,
    };

    if (typeof FirebaseDB !== 'undefined' && FirebaseDB.isConfigured()) {
        const result = await FirebaseDB.set(`groups/${code}`, groupData);
        if (result === null) {
            showToast('Failed to create room. Check Firebase config.');
            return;
        }
    }

    // Also store locally
    await sendMessage({ action: 'CREATE_GROUP', groupName: name, adminName: admin });
    await addMyGroupCode(code);

    closeCreateGroupModal();
    document.getElementById('groupCodeDisplay').classList.remove('hidden');
    document.getElementById('displayCode').textContent = code;
    showToast('✅ Room created! Share the code with friends.');
    await loadGroupsUI();

    // Auto-open the room detail
    openGroupDetail(code);
}

// ---- JOIN ROOM MODAL ----
function openJoinGroupModal() {
    try {
        console.log('[SmartFocus] Join Room button clicked');
        const modal = document.getElementById('joinGroupModal');
        if (!modal) {
            console.error('[SmartFocus] joinGroupModal not found');
            showToast('Error: Could not open Join Room dialog.');
            return;
        }
        modal.classList.remove('hidden');
        document.getElementById('joinCode').value = '';
        document.getElementById('memberName').value = currentUserName || '';
        console.log('[SmartFocus] Join Room modal opened');
    } catch (err) {
        console.error('[SmartFocus] Error opening Join Room modal:', err);
        showToast('Error opening Join Room dialog.');
    }
}

function closeJoinGroupModal() {
    const modal = document.getElementById('joinGroupModal');
    if (modal) modal.classList.add('hidden');
}

// ---- JOIN ROOM (Forest-style — only during 'waiting' state) ----
async function joinRoom() {
    const code = document.getElementById('joinCode').value.trim().toUpperCase();
    const name = document.getElementById('memberName').value.trim();
    if (!code || !name) {
        showToast('Please fill in all fields');
        return;
    }

    saveUserIdentity(name);
    console.log('[SmartFocus] Join attempt — code:', code, 'name:', name);

    try {
        if (typeof FirebaseDB !== 'undefined' && FirebaseDB.isConfigured()) {
            const group = await FirebaseDB.get(`groups/${code}`);
            if (!group) {
                showToast('❌ Invalid room code!');
                return;
            }
            if (group.deleted) {
                showToast('❌ This room has been deleted.');
                return;
            }
            if (group.sessionState === 'running') {
                showToast('🚫 Session already in progress. Cannot join now.');
                return;
            }
            if (group.sessionState === 'disrupted' || group.sessionState === 'ended') {
                showToast('🚫 This session has ended. Cannot join.');
                return;
            }

            // Add member to Firebase
            await FirebaseDB.set(`groups/${code}/members/${name}`, {
                name: name,
                joined: Date.now(),
                isAdmin: false,
                status: 'active',
            });

            await addMyGroupCode(code);
            closeJoinGroupModal();
            showToast(`✅ Joined room "${group.name}"!`);
            await loadGroupsUI();

            // Auto-open the room detail
            openGroupDetail(code);
        } else {
            // Fallback: local-only join
            const result = await sendMessage({ action: 'JOIN_GROUP', code, memberName: name });
            if (result.error) {
                showToast(result.error);
                return;
            }
            await addMyGroupCode(code);
            closeJoinGroupModal();
            showToast(`Joined room "${result.group.name}"!`);
            await loadGroupsUI();
        }
    } catch (err) {
        console.error('[SmartFocus] Join Room ERROR:', err);
        showToast('❌ Failed to join room.');
    }
}

// ---- ROOM DETAIL VIEW ----
window.openGroupDetail = async function (code) {
    console.log('[SmartFocus] Opening room detail:', code);
    activeGroupCode = code;

    document.getElementById('groupLobby').classList.add('hidden');
    document.getElementById('groupDetailView').classList.remove('hidden');
    document.getElementById('groupDeletedAlert').classList.add('hidden');
    document.getElementById('groupDisruptedAlert').classList.add('hidden');

    await renderGroupDetail(code);

    // Start polling Firebase for real-time updates (every 2s for responsiveness)
    if (groupPollInterval) clearInterval(groupPollInterval);
    groupPollInterval = setInterval(() => renderGroupDetail(code), 2000);
};

async function renderGroupDetail(code) {
    let group = null;

    if (typeof FirebaseDB !== 'undefined' && FirebaseDB.isConfigured()) {
        group = await FirebaseDB.get(`groups/${code}`);
    } else {
        const groups = await sendMessage({ action: 'GET_GROUPS' }) || {};
        group = groups[code];
    }

    if (!group || group.deleted) {
        document.getElementById('groupDeletedAlert').classList.remove('hidden');
        document.getElementById('detailGroupName').textContent = 'Room Closed';
        document.getElementById('detailGroupAdmin').textContent = '—';
        document.getElementById('membersList').innerHTML = '';
        document.getElementById('memberCount').textContent = '0';
        hideAllControls();
        return;
    }

    // Room Info
    document.getElementById('detailGroupName').textContent = group.name;
    document.getElementById('detailGroupCode').textContent = code;
    document.getElementById('detailGroupAdmin').textContent = group.admin;
    document.getElementById('detailSessionTime').textContent = `⏱ ${group.duration || 25} min session`;

    // Members
    const members = group.members || {};
    const memberKeys = Object.keys(members);
    document.getElementById('memberCount').textContent = memberKeys.length;

    const membersListEl = document.getElementById('membersList');
    membersListEl.innerHTML = memberKeys.map(key => {
        const m = members[key];
        const isAdmin = m.isAdmin;
        const statusClass = m.status === 'active' ? 'status-active' : 'status-idle';
        const joinedTime = m.joined ? timeAgo(m.joined) : '';
        return `
      <div class="member-row">
        <div class="member-info">
          <span class="member-status-dot ${statusClass}"></span>
          <span class="member-name">${escapeHtml(m.name)}</span>
          ${isAdmin ? '<span class="admin-badge">Admin</span>' : ''}
        </div>
        <div style="text-align:right;">
          <span class="member-status-label" style="color:var(--success); font-weight:600;">✓ Joined</span>
          <span class="member-status-label" style="display:block; font-size:9px; color:var(--text-muted);">${joinedTime}</span>
        </div>
      </div>
    `;
    }).join('');

    // Session state
    const sessionState = group.sessionState || 'waiting';
    const liveStatusEl = document.getElementById('liveStatusText');
    const sharedTimerEl = document.getElementById('groupSharedTimer');
    const liveDot = document.querySelector('.live-dot');
    const isAdmin = currentUserName === group.admin;

    // Hide all controls first, then show relevant ones
    hideAllControls();

    if (sessionState === 'waiting') {
        liveStatusEl.textContent = `⏳ Waiting for members... (${memberKeys.length} joined)`;
        if (liveDot) { liveDot.classList.remove('active'); liveDot.classList.remove('ended'); }
        sharedTimerEl.classList.add('hidden');
        document.getElementById('groupDisruptedAlert').classList.add('hidden');

        if (isAdmin) {
            document.getElementById('startGroupSessionBtn').style.display = 'inline-flex';
            document.getElementById('cancelRoomBtn').style.display = 'inline-flex';
        } else {
            document.getElementById('leaveGroupBtn').style.display = 'inline-flex';
        }

    } else if (sessionState === 'running') {
        liveStatusEl.textContent = '🟢 Session in progress — Stay focused!';
        if (liveDot) { liveDot.classList.add('active'); liveDot.classList.remove('ended'); }
        document.getElementById('groupDisruptedAlert').classList.add('hidden');

        // Show shared timer
        if (group.startedAt && group.duration) {
            sharedTimerEl.classList.remove('hidden');
            const startMs = group.startedAt;
            const endMs = startMs + (group.duration * 60 * 1000);
            const remaining = Math.max(0, Math.floor((endMs - Date.now()) / 1000));
            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;
            document.getElementById('sharedTimerDisplay').textContent =
                `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

            // Auto-end if timer ran out
            if (remaining <= 0 && isAdmin) {
                console.log('[SmartFocus] Room timer expired — auto-ending session');
                await FirebaseDB.update(`groups/${code}`, {
                    sessionActive: false,
                    sessionState: 'ended',
                });
                await sendMessage({ action: 'END_SESSION' });
                showToast('✅ Session completed! Great work everyone!');
                return;
            }
        }

        // Auto-start local timer for this user if not already running
        const localSession = await sendMessage({ action: 'GET_SESSION' });
        if (!localSession.active && !localSession.pausedAt) {
            const taskName = group.name || 'Group Focus';
            const startMs = group.startedAt || Date.now();
            const endMs = startMs + (group.duration * 60 * 1000);
            const remainingMin = Math.max(1, Math.ceil((endMs - Date.now()) / 60000));
            await sendMessage({
                action: 'START_SESSION',
                taskName: taskName,
                duration: remainingMin,
                type: 'group',
                groupCode: code,
                hardMode: false,
            });
            showToast('▶ Group session started — timer running!');
        }

        // ANYONE can cancel the session (Forest-style disruption!)
        document.getElementById('disruptSessionBtn').style.display = 'inline-flex';

    } else if (sessionState === 'disrupted') {
        const disruptedBy = group.disruptedBy || 'someone';
        liveStatusEl.textContent = '💥 Session disrupted!';
        if (liveDot) { liveDot.classList.remove('active'); liveDot.classList.add('ended'); }
        sharedTimerEl.classList.add('hidden');

        // Show disruption alert
        const alertEl = document.getElementById('groupDisruptedAlert');
        alertEl.classList.remove('hidden');
        document.getElementById('disruptedAlertText').textContent =
            `Session was disrupted by ${disruptedBy}! The room is closed.`;

        // End local session if still running
        const localSession2 = await sendMessage({ action: 'GET_SESSION' });
        if (localSession2.active || localSession2.pausedAt) {
            await sendMessage({ action: 'END_SESSION' });
            showToast(`💥 Session disrupted by ${disruptedBy}!`);
        }

    } else if (sessionState === 'ended') {
        liveStatusEl.textContent = '✅ Session completed!';
        if (liveDot) { liveDot.classList.remove('active'); liveDot.classList.add('ended'); }
        sharedTimerEl.classList.add('hidden');
        document.getElementById('groupDisruptedAlert').classList.add('hidden');
    }
}

function hideAllControls() {
    document.getElementById('startGroupSessionBtn').style.display = 'none';
    document.getElementById('cancelRoomBtn').style.display = 'none';
    document.getElementById('disruptSessionBtn').style.display = 'none';
    document.getElementById('leaveGroupBtn').style.display = 'none';
}

function exitGroupDetail() {
    if (groupPollInterval) {
        clearInterval(groupPollInterval);
        groupPollInterval = null;
    }
    activeGroupCode = null;
    document.getElementById('groupDetailView').classList.add('hidden');
    document.getElementById('groupLobby').classList.remove('hidden');
    loadGroupsUI();
}

// ---- CHECK GROUP DISRUPTION (runs from loadState every 1s) ----
// This is the KEY fix: detects disruption even from Focus tab
let lastDisruptionCheck = 0;
async function checkGroupDisruption(groupCode) {
    // Throttle to once every 2 seconds to avoid hammering Firebase
    const now = Date.now();
    if (now - lastDisruptionCheck < 2000) return;
    lastDisruptionCheck = now;

    if (typeof FirebaseDB === 'undefined' || !FirebaseDB.isConfigured()) return;

    try {
        const group = await FirebaseDB.get(`groups/${groupCode}`);
        if (!group) return;

        if (group.sessionState === 'disrupted') {
            const disruptedBy = group.disruptedBy || 'someone';
            console.log('[SmartFocus] DISRUPTION DETECTED from polling! By:', disruptedBy);

            // End local session immediately
            await sendMessage({ action: 'END_SESSION' });
            showToast(`💥 Session disrupted by ${disruptedBy}!`);

            // Switch to group tab and show disruption
            switchToTab('group');
            if (activeGroupCode === groupCode) {
                await renderGroupDetail(groupCode);
            }
        } else if (group.sessionState === 'ended') {
            // Session completed naturally
            const localSession = await sendMessage({ action: 'GET_SESSION' });
            if (localSession.active || localSession.pausedAt) {
                await sendMessage({ action: 'END_SESSION' });
                showToast('✅ Group session completed!');
            }
        }
    } catch (e) {
        console.error('[SmartFocus] Disruption check error:', e);
    }
}

// ---- START GROUP SESSION (Admin only) ----
async function startGroupSession() {
    if (!activeGroupCode) return;
    console.log('[SmartFocus] Starting group session:', activeGroupCode);

    if (typeof FirebaseDB !== 'undefined' && FirebaseDB.isConfigured()) {
        const group = await FirebaseDB.get(`groups/${activeGroupCode}`);
        if (!group) return;

        const duration = group.duration || 25;
        const taskName = group.name || 'Group Focus';

        await FirebaseDB.update(`groups/${activeGroupCode}`, {
            sessionActive: true,
            sessionState: 'running',
            startedAt: Date.now(),
        });

        // Start local session
        await sendMessage({
            action: 'START_SESSION',
            taskName: taskName,
            duration: duration,
            type: 'group',
            groupCode: activeGroupCode,
            hardMode: false,
        });

        showToast('▶ Session started for everyone!');
        console.log('[SmartFocus] Group session STARTED:', activeGroupCode);
        await renderGroupDetail(activeGroupCode);
    }
}

// ---- CANCEL ROOM (Admin, before session starts) ----
async function cancelRoom() {
    if (!activeGroupCode) return;
    if (!confirm('Cancel this room? All members will be removed.')) return;

    console.log('[SmartFocus] Cancelling room:', activeGroupCode);

    if (typeof FirebaseDB !== 'undefined' && FirebaseDB.isConfigured()) {
        await FirebaseDB.update(`groups/${activeGroupCode}`, { deleted: true });
        setTimeout(async () => {
            await FirebaseDB.remove(`groups/${activeGroupCode}`);
        }, 2000);
    }

    await sendMessage({ action: 'DELETE_GROUP', code: activeGroupCode });
    await removeMyGroupCode(activeGroupCode);

    showToast('🗑️ Room cancelled.');
    exitGroupDetail();
}

// ---- DISRUPT SESSION (ANYONE, during running session — Forest-style!) ----
async function disruptSession() {
    if (!activeGroupCode) return;
    if (!confirm('⚠️ This will END the session for ALL members! Are you sure?')) return;

    console.log('[SmartFocus] DISRUPTING session:', activeGroupCode, 'by:', currentUserName);

    if (typeof FirebaseDB !== 'undefined' && FirebaseDB.isConfigured()) {
        await FirebaseDB.update(`groups/${activeGroupCode}`, {
            sessionActive: false,
            sessionState: 'disrupted',
            disruptedBy: currentUserName || 'Unknown',
        });
    }

    // End local session
    await sendMessage({ action: 'END_SESSION' });

    showToast('💥 Session disrupted! Room closed for everyone.');
    console.log('[SmartFocus] Session DISRUPTED by:', currentUserName);
    await renderGroupDetail(activeGroupCode);
}

// ---- LEAVE ROOM (Non-admin, before session starts) ----
async function leaveRoom() {
    if (!activeGroupCode || !currentUserName) return;
    if (!confirm('Leave this room?')) return;

    console.log('[SmartFocus] Leaving room:', activeGroupCode);

    if (typeof FirebaseDB !== 'undefined' && FirebaseDB.isConfigured()) {
        await FirebaseDB.remove(`groups/${activeGroupCode}/members/${currentUserName}`);
    }

    await removeMyGroupCode(activeGroupCode);
    showToast('👋 Left the room.');
    exitGroupDetail();
}

// ---- SOLO ACTIONS ----
async function startFocusSession() {
    const taskName = document.getElementById('taskName').value.trim();
    let duration = parseInt(document.getElementById('duration').value);
    const mode = document.getElementById('sessionMode').value;
    const hardMode = document.getElementById('hardMode').checked;

    if (!taskName) {
        showToast('Please enter a task name');
        document.getElementById('taskName').focus();
        return;
    }

    // Handle custom duration
    if (isNaN(duration) || duration <= 0) {
        const customMin = parseInt(document.getElementById('customDuration')?.value);
        if (isNaN(customMin) || customMin <= 0) {
            showToast('Please enter a valid custom duration');
            return;
        }
        duration = customMin;
    }

    const result = await sendMessage({
        action: 'START_SESSION',
        taskName,
        duration,
        type: mode,
        hardMode,
    });

    if (result.error) {
        showToast(result.error);
    } else {
        showToast('🎯 Focus session started!');
        await loadState();
    }
}

async function togglePause() {
    if (!currentSession) return;

    if (currentSession.active) {
        const result = await sendMessage({ action: 'PAUSE_SESSION' });
        if (result.error) {
            showToast(result.error);
        } else {
            showToast('⏸️ Session paused');
        }
    } else if (currentSession.pausedAt) {
        await sendMessage({ action: 'RESUME_SESSION' });
        showToast('▶️ Session resumed');
    }
    await loadState();
}

async function endFocusSession() {
    if (currentSession?.hardMode) {
        showToast('🔐 Cannot end session in Hard Mode!');
        return;
    }

    if (confirm('End this focus session early?')) {
        // ---- CRITICAL: If this is a group session, disrupting it here must sync to Firebase ----
        if (currentSession?.type === 'group' && currentSession?.groupCode) {
            console.log('[SmartFocus] Manually ending group session from focus tab:', currentSession.groupCode);
            if (typeof FirebaseDB !== 'undefined' && FirebaseDB.isConfigured()) {
                await FirebaseDB.update(`groups/${currentSession.groupCode}`, {
                    sessionActive: false,
                    sessionState: 'disrupted',
                    disruptedBy: currentUserName || 'Unknown',
                });
            }
        }

        await sendMessage({ action: 'END_SESSION' });
        showToast('Session ended.');
        await loadState();
    }
}

async function takeBreak() {
    await sendMessage({ action: 'START_BREAK', duration: 5 });
    showToast('☕ Break time!');
    await loadState();
}

async function addBlockedSite() {
    const input = document.getElementById('newBlockSite');
    const site = input.value.trim();
    if (!site) return;

    await sendMessage({ action: 'ADD_BLOCK', site });
    input.value = '';
    showToast(`🚫 ${site} blocked!`);
    await loadState();
}

function copyGroupCode() {
    const code = document.getElementById('displayCode').textContent;
    navigator.clipboard.writeText(code);
    showToast('Code copied!');
}

// ---- HELPERS ----
function sendMessage(msg) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage(msg, (response) => {
            resolve(response || {});
        });
    });
}

function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${s}s`;
}

function formatTimeShort(seconds) {
    if (seconds < 60) return `${seconds}s`;
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

function timeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
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

function handleBackgroundMessage(msg) {
    if (msg.type === 'SESSION_STARTED' || msg.type === 'SESSION_ENDED' ||
        msg.type === 'TIMER_TICK' || msg.type === 'SESSION_PAUSED' ||
        msg.type === 'SESSION_RESUMED' || msg.type === 'BREAK_STARTED') {
        loadState();
    }
    // Handle group deletion notification
    if (msg.type === 'GROUP_DELETED' && msg.code === activeGroupCode) {
        document.getElementById('groupDeletedAlert').classList.remove('hidden');
        showToast('⚠️ This room has been closed by the admin.');
    }
}

// Cleanup
window.addEventListener('unload', () => {
    if (tickInterval) clearInterval(tickInterval);
    if (groupPollInterval) clearInterval(groupPollInterval);
});
