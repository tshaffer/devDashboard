-- Launcher for Chatworthy, built by devDashboard/scripts/install-launchers.sh.
-- Chatworthy is a Chrome extension: this rebuilds it into dist/ on every change.
-- Reload the extension in chrome://extensions after each build.
try
	do shell script "$HOME/.local/bin/stop-dev-app '/Users/tedshaffer/Documents/Projects/chatorama/packages/chatworthy'"
end try

tell application "iTerm"
	activate
	set newWindow to (create window with default profile)
	tell current session of newWindow
		set name to "Chatworthy"
		write text "printf '\\033]0;Chatworthy\\007'; export NVM_DIR=\"$HOME/.nvm\" && source \"$NVM_DIR/nvm.sh\" && cd /Users/tedshaffer/Documents/Projects/chatorama/packages/chatworthy && npm run watch"
	end tell
end tell
