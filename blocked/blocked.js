// ============================================================
// Smart Focus - Blocked Page Controller
// ============================================================

const quotes = [
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Focus on being productive instead of busy.", author: "Tim Ferriss" },
  { text: "It's not that I'm so smart, it's just that I stay with problems longer.", author: "Albert Einstein" },
  { text: "The successful warrior is the average man, with laser-like focus.", author: "Bruce Lee" },
  { text: "Concentrate all your thoughts upon the work at hand.", author: "Alexander Graham Bell" },
  { text: "Do what you have to do until you can do what you want to do.", author: "Oprah Winfrey" },
  { text: "You don't have to be great to start, but you have to start to be great.", author: "Zig Ziglar" },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Your future is created by what you do today, not tomorrow.", author: "Robert Kiyosaki" },
  { text: "Discipline is the bridge between goals and accomplishment.", author: "Jim Rohn" },
  { text: "Success is the sum of small efforts repeated day in and day out.", author: "Robert Collier" },
  { text: "Don't wish it were easier. Wish you were better.", author: "Jim Rohn" },
];

document.addEventListener('DOMContentLoaded', async () => {
  // Set random quote
  const q = quotes[Math.floor(Math.random() * quotes.length)];
  document.getElementById('motivQuote').textContent = `"${q.text}"`;
  document.getElementById('motivAuthor').textContent = `— ${q.author}`;

  // Create floating particles
  createParticles();

  // Load session info
  await loadSessionInfo();

  // Go back button — navigate to a new tab page safely
  document.getElementById('goBackBtn').addEventListener('click', () => {
    // Use multiple approaches for reliability
    try {
      // Try to go to a productive page
      window.location.href = 'https://www.google.com';
    } catch (e) {
      window.history.back();
    }
  });

  // Refresh timer every second
  setInterval(loadSessionInfo, 1000);
});

async function loadSessionInfo() {
  try {
    const session = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'GET_SESSION' }, (response) => {
        resolve(response || {});
      });
    });

    if (session && session.active) {
      document.getElementById('blockedTask').textContent = session.taskName || 'Focus Session';

      const mins = Math.floor((session.remaining || 0) / 60);
      const secs = (session.remaining || 0) % 60;
      document.getElementById('blockedTimer').textContent =
        `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

      if (session.hardMode) {
        document.getElementById('hardModeNotice').classList.remove('hidden');
      }
    } else {
      document.getElementById('blockedTask').textContent = 'No active session';
      document.getElementById('blockedTimer').textContent = '--:--';
    }
  } catch (e) {
    // Extension context might be invalidated
  }
}

function createParticles() {
  const container = document.getElementById('particles');
  for (let i = 0; i < 20; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.style.left = Math.random() * 100 + '%';
    particle.style.animationDuration = (Math.random() * 10 + 8) + 's';
    particle.style.animationDelay = (Math.random() * 5) + 's';
    particle.style.width = (Math.random() * 4 + 2) + 'px';
    particle.style.height = particle.style.width;
    particle.style.opacity = Math.random() * 0.5 + 0.2;
    container.appendChild(particle);
  }
}
