# Running the Assignment Lab

You are helping a faculty member run the Assignment Lab, a small web app for a workshop on assignments and AI. Most people who open this folder are not programmers. Use plain words, run the commands yourself, and ask only what you need to know.

## What people do in the room

1. People scan a QR code and answer on their phones: which assignments they give, and how they use AI on each.
2. The host presses Make groups on the Find your group screen. Each phone shows its table and group, and the room map shows every name at every table.
3. One person at each table opens the toolkit form. The table names one assignment, lists its parts, and marks each part Only the student, Student + AI, or Agentic AI with Supervision.
4. The toolkit screen shows every table's parts in three columns.

The lab runs on this computer. `start.js` starts the web server and asks Cloudflare for a free quick link, so phones on any network can reach it. Nobody needs a Cloudflare account for the link, and the link changes each time the lab starts.

## Start the lab

Do these steps when the person asks to start the lab, try it, or run a session.

1. Check Node with `node -v`. The lab needs version 18 or newer.
   - On a Mac with Homebrew (`brew -v` works), run `brew install node`.
   - On a Mac without Homebrew, ask the person to install the LTS version from https://nodejs.org, then check again.
   - On Windows, run `winget install OpenJS.NodeJS.LTS`, then open a new terminal.
2. Check cloudflared with `cloudflared --version`, or `bin/cloudflared --version` in this folder.
   - On a Mac with Homebrew, run `brew install cloudflared`.
   - On a Mac without Homebrew, put Cloudflare's own release in `bin/`. Use `uname -m` to pick the file: `arm64` gets `cloudflared-darwin-arm64.tgz`, and `x86_64` gets `cloudflared-darwin-amd64.tgz`.
     ```
     mkdir -p bin && curl -fsSL -o bin/cf.tgz https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz && tar -xzf bin/cf.tgz -C bin && rm bin/cf.tgz
     ```
   - On Windows, run `winget install --id Cloudflare.cloudflared`, then open a new terminal.
   - If the person would rather not install it, start the lab with `--wifi`. Tell them that only phones on the same Wi-Fi as this computer can join, and that many campus networks block that.
3. The first time, `settings.json` has `"hostName": ""`. Ask these questions in one message, then edit `settings.json`:
   - What name should the phones show for the host? For example, "Dr. Lee" or "Dana".
   - How many tables are in the room, how many seats are at each table, and how many tables are in each row from the front?
   - Do the ten kinds of assignment fit the group? Show the list and ask what to add, cut, or rename.
   - Should the form ask each person's department? If yes, ask for the list.
4. Start the lab in the background with `node start.js`, because it keeps running for the whole session. Add `--demo` when the person wants to try it with sample people first. The demo keeps its sample answers apart from real ones.
5. Wait for the line that says the lab is running, or read `data/links.json`. Give the person both links:
   - `start.js` opens the host screen in their browser. The host screen has the host's buttons, and they work only in a browser on this computer.
   - The link for phones is the one to share. The host screen also shows it as a QR code.
6. Leave the lab running until the person asks you to stop it.

## Help during the session

- To make groups, the person opens Find your group from the host screen, moves the pointer to the bottom of that screen, and presses Make groups. Keys 1 to 4 switch the views, and 4 shows the room map.
- When people answer after the groups are made, the person presses Add new answers to groups. Nobody else moves.
- The toolkit screen shows its own QR code. The x beside a list takes that list off the screen, for example a test entry.
- The buttons work only in a browser on this computer. Anyone else who opens the screens sees them and can't change anything.
- If the Cloudflare link stops, `start.js` gets a new one and prints it. Tell the person to reload both screens, because the QR codes change.

## After the session

- The host screen has buttons to download the toolkit lists and the groups as CSV files.
- If the person asks for a summary, read `data/state.json` and write one. The toolkit is in the `ideas` list. Each part's `level` is 0, 1, or 2, in the order of `toolkitChoices` in `settings.json`.
- To stop the lab, stop the background process. The answers stay in `data/state.json`.
- To delete the answers, use the Delete all answers and lists button on the host screen. With the lab stopped, you can delete `data/state.json` instead, after the person says yes.

## If something goes wrong

- If the phones can't open the link, wait a minute, because a new Cloudflare link can be slow at first. If it still fails, restart the lab and share the new link.
- If the output says Cloudflare did not give the lab a link, read the message it prints. Check that this computer is online. If the network blocks Cloudflare, use `--wifi`.
- If `settings.json` has a mistake, `start.js` says where. Fix the file and start again.
- If the port is busy, `start.js` tries the next 19 ports by itself.

## Rules for you

- The answers in the `data` folder include real people's names. Keep it on this computer. Don't paste it into other tools or upload it unless the person asks.
- Change `server.js` or the pages only when the person asks for a change to how the lab works.
- Don't put the lab on any public address other than the Cloudflare quick link without asking the person first.
