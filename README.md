# Smart Focus

Smart Focus is a distraction-control Chrome Extension designed to help users maintain focus and build better digital habits. Rather than just blocking websites, Smart Focus introduces an accountability-based group study mode that synchronizes focus sessions among multiple users in real-time.

## Features

- **Solo Focus Mode**: A customizable timer with local network-level website blocking using Chrome Manifest V3 declarativeNetRequest APIs.
- **Group Study Mode**: Create or join synchronized study sessions using unique room codes. 
- **Accountability Disruption**: In group mode, if one user leaves or breaks the session early, the shared session state updates and terminates the session for everyone—increasing peer accountability.
- **Analytics Dashboard**: Tracks user activity, focus time, distraction time, and calculates a productivity score so you can see where your time actually goes.

## Technology Stack

- **Frontend**: HTML, CSS, JavaScript
- **Browser Platform**: Chrome Extension APIs (Manifest V3)
- **Backend**: Firebase Realtime Database (for Group Mode synchronization)
- **Local Storage**: `chrome.storage.local`

## Installation for Development

1. Clone this repository to your local machine.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle switch in the top right corner.
4. Click the **Load unpacked** button and select the root directory of this repository (where the `manifest.json` file is located).

