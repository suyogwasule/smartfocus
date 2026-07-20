// ============================================================
// Smart Focus - Background Service Worker (Core Engine)
// ALL storage utilities inlined to avoid importScripts issues
// ============================================================

// ===================== STORAGE HELPER (inlined) ====================
const DEFAULTS = {
  session: {
    active: false,
    taskName: '',
    duration: 25,
    remaining: 0,
    startTime: null,
    mode: 'focus',
    hardMode: false,
    type: 'solo',
    groupCode: null,
  },
  blockList: [
    'youtube.com',
    'instagram.com',
    'facebook.com',
    'twitter.com',
    'x.com',
    'reddit.com',
    'tiktok.com',
    'netflix.com',
    'twitch.tv',
  ],
  today: {
    date: new Date().toISOString().split('T')[0],
    focusTime: 0,
    distractionTime: 0,
    tabSwitches: 0,
    siteTimes: {},
    sessions: [],
  },
  goals: {
    dailyFocusMinutes: 120,
    weeklyFocusMinutes: 600,
  },
  history: [],
  groups: {},
  settings: {
    pomodoroWork: 25,
    pomodoroBreak: 5,
    pomodoroLongBreak: 15,
    pomodoroRounds: 4,
    showFloatingTimer: true,
    soundEnabled: true,
    tabSwitchThreshold: 10,
    breakReminder: true,
  },
};

async function storageGet(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      if (result[key] !== undefined) {
        resolve(result[key]);
      } else {
        resolve(DEFAULTS[key] !== undefined ? JSON.parse(JSON.stringify(DEFAULTS[key])) : null);
      }
    });
  });
}

async function storageSet(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

async function storageUpdate(key, updates) {
  const current = await storageGet(key);
  const updated = { ...current, ...updates };
  await storageSet(key, updated);
  return updated;
}

async function getTodayData() {
  const today = await storageGet('today');
  const currentDate = new Date().toISOString().split('T')[0];
  if (today.date !== currentDate) {
    const history = await storageGet('history');
    if (today.focusTime > 0 || today.distractionTime > 0) {
      history.push({ ...today });
      while (history.length > 30) history.shift();
      await storageSet('history', history);
    }
    const freshToday = JSON.parse(JSON.stringify(DEFAULTS.today));
    freshToday.date = currentDate;
    await storageSet('today', freshToday);
    return freshToday;
  }
  return today;
}

function generateGroupCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ===================== STATE ====================
let trackingInterval = null;
let currentTabDomain = null;
let lastActiveTime = Date.now();

// ===================== INITIALIZATION ====================
chrome.runtime.onInstalled.addListener(async () => {
  const session = await storageGet('session');
  if (!session || session.mode === undefined) {
    await storageSet('session', JSON.parse(JSON.stringify(DEFAULTS.session)));
  }
  await getTodayData();
  startTracking();
  chrome.idle.setDetectionInterval(30);
  console.log('[SmartFocus] Extension installed & initialized.');
});

chrome.runtime.onStartup.addListener(() => {
  startTracking();
  chrome.idle.setDetectionInterval(30);
  checkScheduledSessions();
});

// ===================== ACTIVITY TRACKING ====================
function startTracking() {
  if (trackingInterval) clearInterval(trackingInterval);
  trackingInterval = setInterval(async () => {
    await tickTracking();
  }, 1000);
  chrome.alarms.create('tracking-persist', { periodInMinutes: 1 });
}

async function tickTracking() {
  try {
    const today = await getTodayData();
    const session = await storageGet('session');

    // ALWAYS count focus/distraction time during active focus session
    // regardless of which page is open (fixes real-time stat updates)
    if (session.active && session.mode === 'focus') {
      const blockList = await storageGet('blockList');
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs && tabs[0];
      let isOnBlockedSite = false;

      if (activeTab && activeTab.url) {
        try {
          const url = new URL(activeTab.url);
          if (url.protocol !== 'chrome:' && url.protocol !== 'chrome-extension:' && url.protocol !== 'about:') {
            const domain = url.hostname.replace(/^www\./, '');
            currentTabDomain = domain;

            // Track site time
            if (!today.siteTimes) today.siteTimes = {};
            if (!today.siteTimes[domain]) today.siteTimes[domain] = 0;
            today.siteTimes[domain] += 1;

            isOnBlockedSite = blockList.some(site =>
              domain === site || domain.endsWith('.' + site)
            );
          }
        } catch (e) { /* invalid URL */ }
      }

      if (isOnBlockedSite) {
        today.distractionTime += 1;
      } else {
        today.focusTime += 1;
      }
      await storageSet('today', today);
      return;
    }

    // When no active session, still track site times for analytics
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || !tabs[0] || !tabs[0].url) return;
    const activeTab = tabs[0];

    let url;
    try { url = new URL(activeTab.url); } catch (e) { return; }
    if (url.protocol === 'chrome:' || url.protocol === 'chrome-extension:' || url.protocol === 'about:') return;

    const domain = url.hostname.replace(/^www\./, '');
    currentTabDomain = domain;

    if (!today.siteTimes) today.siteTimes = {};
    if (!today.siteTimes[domain]) today.siteTimes[domain] = 0;
    today.siteTimes[domain] += 1;

    await storageSet('today', today);
  } catch (e) {
    // Silently handle
  }
}

// Tab switch tracking (FIXED — Issue 7: debounce + same-tab filter)
let lastTrackedTabId = null;
let lastTabSwitchTime = 0;
const TAB_SWITCH_DEBOUNCE_MS = 1500; // Ignore rapid-fire events within 1.5s

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const now = Date.now();

    // Debounce: ignore if fired within 1.5s of last switch
    if (now - lastTabSwitchTime < TAB_SWITCH_DEBOUNCE_MS) {
      console.log('[SmartFocus] Tab switch DEBOUNCED (too fast)');
      return;
    }

    // Same-tab check: don't count if it's the same tab being re-focused
    if (activeInfo.tabId === lastTrackedTabId) {
      console.log('[SmartFocus] Tab switch IGNORED (same tab re-focused)');
      return;
    }

    // Validate the tab — ignore chrome:// and extension pages
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      if (!tab || !tab.url) return;
      const url = tab.url;
      if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
        console.log('[SmartFocus] Tab switch IGNORED (chrome/extension page)');
        return;
      }
    } catch (e) {
      // Tab might not exist yet
      return;
    }

    // Valid tab switch — record it
    lastTrackedTabId = activeInfo.tabId;
    lastTabSwitchTime = now;

    const today = await getTodayData();
    today.tabSwitches = (today.tabSwitches || 0) + 1;
    await storageSet('today', today);

    console.log('[SmartFocus] Tab switch COUNTED (#' + today.tabSwitches + ') tabId:', activeInfo.tabId);
    await checkTabSwitchFrequency(today);
  } catch (e) {
    console.error('[SmartFocus] Tab switch tracking error:', e);
  }
});

// Also track window focus changes — but only when LOSING focus (window = -1)
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // User left Chrome entirely — not a tab switch
    console.log('[SmartFocus] Window lost focus (not counted as tab switch)');
  }
});

// Idle detection
chrome.idle.onStateChanged.addListener((state) => {
  lastActiveTime = Date.now();
});

async function checkTabSwitchFrequency(today) {
  const settings = await storageGet('settings');
  const session = await storageGet('session');
  if (!session.active) return;

  const threshold = settings.tabSwitchThreshold || 10;
  if (today.tabSwitches > threshold) {
    try {
      chrome.notifications.create('tab-switch-warn-' + Date.now(), {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
        title: '⚠️ Stay Focused!',
        message: `You've switched tabs ${today.tabSwitches} times. You seem distracted — get back to "${session.taskName}"!`,
        priority: 2,
      });
    } catch (e) { /* notification permission may not be granted */ }
    broadcastMessage({ type: 'DISTRACTION_WARNING', tabSwitches: today.tabSwitches });
  }
}

async function updateBlockRules() {
  try {
    const blockList = await storageGet('blockList');
    const session = await storageGet('session');

    // Only block during active FOCUS session (not during break)
    if (!session.active || session.mode === 'break') {
      const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
      const removeIds = existingRules.map(r => r.id);
      if (removeIds.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: removeIds,
          addRules: [],
        });
      }
      return;
    }

    const rules = [];
    blockList.forEach((site, index) => {
      // Rule for *.site.com
      rules.push({
        id: (index * 2) + 1,
        priority: 1,
        action: {
          type: 'redirect',
          redirect: { extensionPath: '/blocked/blocked.html' },
        },
        condition: {
          urlFilter: `||${site}`,
          resourceTypes: ['main_frame'],
        },
      });
    });

    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const removeIds = existingRules.map(r => r.id);

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: removeIds,
      addRules: rules,
    });
  } catch (e) {
    console.error('[SmartFocus] Block rules error:', e);
  }
}

// ===================== TIMER ENGINE ====================
// Timer uses time-based calculation (not per-second alarms)
// Session stores startTime + duration; remaining is calculated live
// A single alarm fires when the session should end

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'session-end') {
    await endSession(true);
  } else if (alarm.name === 'tracking-persist') {
    await checkSessionEnd();
  } else if (alarm.name.startsWith('group-session-')) {
    const groupCode = alarm.name.replace('group-session-', '').split('-')[0];
    await autoStartGroupSession(groupCode);
  }
});

async function checkSessionEnd() {
  const session = await storageGet('session');
  if (!session.active) return;
  const remaining = getRemaining(session);
  if (remaining <= 0) {
    await endSession(true);
  }
}

function getRemaining(session) {
  if (!session.active || !session.startTime) return session.remaining || 0;
  const elapsed = (Date.now() - session.startTime) / 1000;
  const totalSeconds = session.duration * 60;
  return Math.max(0, Math.ceil(totalSeconds - elapsed));
}

async function startSession(taskName, durationMinutes, type, groupCode, hardMode) {
  const session = {
    active: true,
    taskName: taskName || 'Focus Session',
    duration: durationMinutes,
    remaining: durationMinutes * 60,
    startTime: Date.now(),
    mode: 'focus',
    hardMode: !!hardMode,
    type: type || 'solo',
    groupCode: groupCode || null,
  };

  await storageSet('session', session);
  await updateBlockRules();

  // Single alarm for session end
  chrome.alarms.create('session-end', { delayInMinutes: durationMinutes });

  try {
    chrome.notifications.create('session-start', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
      title: '🎯 Focus Session Started!',
      message: `Task: ${session.taskName} | Duration: ${durationMinutes} min`,
      priority: 2,
    });
  } catch (e) { /* ignore */ }

  broadcastMessage({ type: 'SESSION_STARTED', session });
  return session;
}

async function endSession(completed) {
  const session = await storageGet('session');

  if (completed && session.taskName) {
    const today = await getTodayData();
    if (!today.sessions) today.sessions = [];
    today.sessions.push({
      task: session.taskName,
      duration: session.duration,
      completedAt: new Date().toISOString(),
      type: session.type || 'solo',
    });
    await storageSet('today', today);

    try {
      chrome.notifications.create('session-end', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
        title: '✅ Session Complete!',
        message: `Great job! You focused on "${session.taskName}" for ${session.duration} minutes.`,
        priority: 2,
      });
    } catch (e) { /* ignore */ }
  }

  await storageSet('session', JSON.parse(JSON.stringify(DEFAULTS.session)));
  chrome.alarms.clear('session-end');
  await updateBlockRules();
  broadcastMessage({ type: 'SESSION_ENDED', completed: !!completed });
}

async function pauseSession() {
  const session = await storageGet('session');
  if (session.hardMode) return { error: 'Cannot pause in Hard Mode!' };
  session.remaining = getRemaining(session);
  session.active = false;
  session.pausedAt = Date.now();
  await storageSet('session', session);
  chrome.alarms.clear('session-end');
  broadcastMessage({ type: 'SESSION_PAUSED', session });
  return session;
}

async function resumeSession() {
  const session = await storageGet('session');
  if (!session.remaining || session.remaining <= 0) return { error: 'No time remaining' };
  session.startTime = Date.now();
  session.duration = session.remaining / 60;
  session.active = true;
  delete session.pausedAt;
  await storageSet('session', session);
  chrome.alarms.create('session-end', { delayInMinutes: session.duration });
  await updateBlockRules();
  broadcastMessage({ type: 'SESSION_RESUMED', session });
  return session;
}

async function startBreak(durationMinutes) {
  const session = await storageGet('session');
  session.mode = 'break';
  session.startTime = Date.now();
  session.duration = durationMinutes;
  session.remaining = durationMinutes * 60;
  session.active = true;
  await storageSet('session', session);

  chrome.alarms.clear('session-end');
  chrome.alarms.create('session-end', { delayInMinutes: durationMinutes });
  await updateBlockRules(); // removes blocking during break

  try {
    chrome.notifications.create('break-start', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
      title: '☕ Break Time!',
      message: `Take a ${durationMinutes} minute break. You've earned it!`,
      priority: 1,
    });
  } catch (e) { /* ignore */ }

  broadcastMessage({ type: 'BREAK_STARTED', session });
}

// ===================== GROUP / LIVE SESSIONS ====================
async function createGroup(groupName, adminName) {
  const code = generateGroupCode();
  const groups = await storageGet('groups');
  groups[code] = {
    name: groupName,
    admin: adminName,
    members: [{ name: adminName, joined: Date.now(), isAdmin: true }],
    scheduledSessions: [],
    created: Date.now(),
  };
  await storageSet('groups', groups);
  return { code, group: groups[code] };
}

async function joinGroup(code, memberName) {
  const groups = await storageGet('groups');
  if (!groups[code]) return { error: 'Invalid group code!' };
  const existing = groups[code].members.find(m => m.name === memberName);
  if (!existing) {
    groups[code].members.push({ name: memberName, joined: Date.now(), isAdmin: false });
    await storageSet('groups', groups);
  }
  return { code, group: groups[code] };
}

async function scheduleGroupSession(code, taskName, scheduledTime, durationMinutes) {
  const groups = await storageGet('groups');
  if (!groups[code]) return { error: 'Invalid group code!' };

  const sessionInfo = {
    id: Date.now().toString(36),
    taskName,
    scheduledTime,
    duration: durationMinutes,
    status: 'scheduled',
  };

  groups[code].scheduledSessions.push(sessionInfo);
  await storageSet('groups', groups);

  const delayMs = new Date(scheduledTime).getTime() - Date.now();
  if (delayMs > 0) {
    chrome.alarms.create(`group-session-${code}-${sessionInfo.id}`, {
      when: new Date(scheduledTime).getTime(),
    });
  }
  return sessionInfo;
}

async function autoStartGroupSession(groupCode) {
  const groups = await storageGet('groups');
  const group = groups[groupCode];
  if (!group) return;

  const now = Date.now();
  const scheduledSession = (group.scheduledSessions || []).find(
    s => s.status === 'scheduled' && Math.abs(new Date(s.scheduledTime).getTime() - now) < 120000
  );

  if (scheduledSession) {
    scheduledSession.status = 'active';
    await storageSet('groups', groups);
    await startSession(scheduledSession.taskName, scheduledSession.duration, 'group', groupCode, true);

    // Update Firebase to sync sessionState for all users (Issue 5)
    try {
      const firebaseUrl = 'https://smart-focus-group-default-rtdb.asia-southeast1.firebasedatabase.app';
      const updateData = {
        sessionActive: true,
        sessionState: 'running',
      };
      const res = await fetch(`${firebaseUrl}/groups/${groupCode}.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      });
      if (res.ok) {
        console.log('[SmartFocus] Firebase updated: group session auto-started for', groupCode);
      } else {
        console.error('[SmartFocus] Firebase update failed:', res.status, res.statusText);
      }
    } catch (e) {
      console.error('[SmartFocus] Firebase auto-start sync error:', e);
    }

    try {
      chrome.notifications.create('group-auto-start', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
        title: '👥 Group Session Auto-Started!',
        message: `"${scheduledSession.taskName}" with group "${group.name}" has begun!`,
        priority: 2,
      });
    } catch (e) { /* ignore */ }
  }
}

// ===================== BLOCKLIST MANAGEMENT ====================
async function addToBlockList(site) {
  const blockList = await storageGet('blockList');
  const domain = site.replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/.*$/, '').toLowerCase();
  if (domain && !blockList.includes(domain)) {
    blockList.push(domain);
    await storageSet('blockList', blockList);
    await updateBlockRules();
  }
  return blockList;
}

async function removeFromBlockList(site) {
  const session = await storageGet('session');
  if (session.active && session.hardMode) {
    return { error: 'Cannot modify block list in Hard Mode during a session!' };
  }
  let blockList = await storageGet('blockList');
  blockList = blockList.filter(s => s !== site);
  await storageSet('blockList', blockList);
  await updateBlockRules();
  return blockList;
}

// ===================== FOCUS SCORE ====================
async function calculateFocusScore() {
  const today = await getTodayData();
  const total = (today.focusTime || 0) + (today.distractionTime || 0);
  if (total === 0) return 100;
  return Math.round((today.focusTime / total) * 100);
}

// ===================== GOAL TRACKING ====================
async function getGoalProgress() {
  const today = await getTodayData();
  const goals = await storageGet('goals');
  const history = await storageGet('history');

  const dailyMinutes = Math.round((today.focusTime || 0) / 60);
  const dailyProgress = Math.min(100, Math.round((dailyMinutes / goals.dailyFocusMinutes) * 100));

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekStartStr = weekStart.toISOString().split('T')[0];

  let weeklyMinutes = dailyMinutes;
  for (const day of (history || [])) {
    if (day.date >= weekStartStr) {
      weeklyMinutes += Math.round((day.focusTime || 0) / 60);
    }
  }
  const weeklyProgress = Math.min(100, Math.round((weeklyMinutes / goals.weeklyFocusMinutes) * 100));

  return { dailyProgress, weeklyProgress, dailyMinutes, weeklyMinutes };
}

// ===================== MESSAGE HANDLER ====================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(err => {
    console.error('[SmartFocus] Message handler error:', err);
    sendResponse({ error: err.message });
  });
  return true; // keep channel open for async response
});

async function handleMessage(msg) {
  switch (msg.action) {
    case 'START_SESSION':
      return await startSession(msg.taskName, msg.duration, msg.type, msg.groupCode, msg.hardMode);

    case 'END_SESSION':
      await endSession(false);
      return { success: true };

    case 'PAUSE_SESSION':
      return await pauseSession();

    case 'RESUME_SESSION':
      return await resumeSession();

    case 'START_BREAK':
      await startBreak(msg.duration || 5);
      return { success: true };

    case 'GET_SESSION': {
      const sess = await storageGet('session');
      if (sess.active) {
        sess.remaining = getRemaining(sess);
      }
      return sess;
    }

    case 'GET_TODAY':
      return await getTodayData();

    case 'GET_FOCUS_SCORE':
      return { score: await calculateFocusScore() };

    case 'GET_GOAL_PROGRESS':
      return await getGoalProgress();

    case 'GET_BLOCKLIST':
      return await storageGet('blockList');

    case 'ADD_BLOCK':
      return await addToBlockList(msg.site);

    case 'REMOVE_BLOCK':
      return await removeFromBlockList(msg.site);

    case 'GET_SETTINGS':
      return await storageGet('settings');

    case 'UPDATE_SETTINGS':
      return await storageUpdate('settings', msg.settings);

    case 'GET_GOALS':
      return await storageGet('goals');

    case 'UPDATE_GOALS':
      return await storageUpdate('goals', msg.goals);

    case 'GET_HISTORY':
      return await storageGet('history');

    case 'GET_GROUPS':
      return await storageGet('groups');

    case 'CREATE_GROUP':
      return await createGroup(msg.groupName, msg.adminName);

    case 'JOIN_GROUP':
      return await joinGroup(msg.code, msg.memberName);

    case 'SCHEDULE_GROUP_SESSION':
      return await scheduleGroupSession(msg.code, msg.taskName, msg.scheduledTime, msg.duration);

    case 'DELETE_GROUP': {
      const groups = await storageGet('groups');
      if (groups[msg.code]) {
        delete groups[msg.code];
        await storageSet('groups', groups);
        // Clear any scheduled alarms for this group
        const alarms = await chrome.alarms.getAll();
        for (const alarm of alarms) {
          if (alarm.name.startsWith(`group-session-${msg.code}`)) {
            await chrome.alarms.clear(alarm.name);
          }
        }
        broadcastMessage({ type: 'GROUP_DELETED', code: msg.code });
        console.log('[SmartFocus] Group deleted from local storage:', msg.code);
      }
      return { success: true };
    }

    case 'CHECK_HARD_MODE': {
      const s = await storageGet('session');
      return { hardMode: s.active && s.hardMode };
    }

    default:
      return { error: 'Unknown action: ' + msg.action };
  }
}

// ===================== BROADCAST ====================
function broadcastMessage(msg) {
  chrome.runtime.sendMessage(msg).catch(() => { });
  chrome.tabs.query({}, (tabs) => {
    if (tabs) {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, msg).catch(() => { });
        }
      }
    }
  });
}

// ===================== SCHEDULED SESSION CHECKER ====================
async function checkScheduledSessions() {
  try {
    const groups = await storageGet('groups');
    const now = Date.now();
    for (const [code, group] of Object.entries(groups || {})) {
      for (const scheduled of (group.scheduledSessions || [])) {
        if (scheduled.status === 'scheduled') {
          const scheduledMs = new Date(scheduled.scheduledTime).getTime();
          if (scheduledMs > now) {
            chrome.alarms.create(`group-session-${code}-${scheduled.id}`, { when: scheduledMs });
          }
        }
      }
    }
  } catch (e) { /* ignore on first load */ }
}

// ===================== STARTUP ====================
checkScheduledSessions();
startTracking();
console.log('[SmartFocus] Service worker loaded successfully.');
