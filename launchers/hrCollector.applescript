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

-- Poll until the web app is up on port 5100 (max ~2 min). Its Vite config uses strictPort, so it never moves.
repeat 60 times
	try
		do shell script "curl -s --max-time 1 http://localhost:5100 > /dev/null"
		exit repeat
	on error
		delay 2
	end try
end repeat

do shell script "open -a 'Google Chrome' http://localhost:5100"
