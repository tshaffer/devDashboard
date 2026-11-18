-- Launcher for hrCollector, built by devDashboard/scripts/install-launchers.sh.
-- Stop any copy already running, so launching never leaves two
try
	do shell script "$HOME/.local/bin/stop-dev-app '/Users/tedshaffer/src/hrCollector'"
end try

set nvmInit to "export NVM_DIR=\"$HOME/.nvm\" && source \"$NVM_DIR/nvm.sh\""

-- Open iTerm with two split panes
tell application "iTerm"
	activate
	set newWindow to (create window with default profile)
	tell current session of newWindow
		set name to "hrCollector server"
		write text "printf '\\033]0;hrCollector server\\007'; " & nvmInit & " && cd /Users/tedshaffer/src/hrCollector/server && npm run dev"
		set newPane to (split vertically with default profile)
	end tell
	tell newPane
		set name to "hrCollector web"
		write text "printf '\\033]0;hrCollector web\\007'; " & nvmInit & " && cd /Users/tedshaffer/src/hrCollector/web && npm run dev"
	end tell
end tell

-- Vite moves to the next free port when its usual one is taken, so ask where it started (max ~2 min)
set webPort to ""
repeat 60 times
	try
		set webPort to do shell script "$HOME/.local/bin/dev-app-port '/Users/tedshaffer/src/hrCollector/web'"
		do shell script "curl -s --max-time 1 http://localhost:" & webPort & " > /dev/null"
		exit repeat
	on error
		set webPort to ""
		delay 2
	end try
end repeat

if webPort is not "" then do shell script "open -a 'Google Chrome' http://localhost:" & webPort
