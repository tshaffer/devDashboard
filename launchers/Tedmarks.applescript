-- Launcher for Tedmarks, built by devDashboard/scripts/install-launchers.sh.
-- Stop any copy already running, so launching never leaves two
try
	do shell script "$HOME/.local/bin/stop-dev-app '/Users/tedshaffer/src/tedmarks'"
end try

set nvmInit to "export NVM_DIR=\"$HOME/.nvm\" && source \"$NVM_DIR/nvm.sh\""

-- Open iTerm with two split panes
tell application "iTerm"
	activate
	set newWindow to (create window with default profile)
	tell current session of newWindow
		set name to "Tedmarks API"
		write text "printf '\\033]0;Tedmarks API\\007'; " & nvmInit & " && cd /Users/tedshaffer/src/tedmarks && pnpm --filter @tedmarks/shared build && pnpm dev:api"
		set newPane to (split vertically with default profile)
	end tell
	tell newPane
		set name to "Tedmarks web"
		write text "printf '\\033]0;Tedmarks web\\007'; " & nvmInit & " && cd /Users/tedshaffer/src/tedmarks && pnpm dev:web"
	end tell
end tell

-- Tedmarks wants 5173, but Vite moves to the next free port if something else has it, so ask where it started (max ~2 min)
set webPort to ""
repeat 60 times
	try
		set webPort to do shell script "$HOME/.local/bin/dev-app-port '/Users/tedshaffer/src/tedmarks/web'"
		do shell script "curl -s --max-time 1 http://localhost:" & webPort & " > /dev/null"
		exit repeat
	on error
		set webPort to ""
		delay 2
	end try
end repeat

if webPort is not "" then do shell script "open -a 'Google Chrome' http://localhost:" & webPort
