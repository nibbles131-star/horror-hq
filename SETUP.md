# Horror HQ: one-time setup

About five minutes, once. After this, Claude ships updates to your Drive and the app installs them by itself.

## 1. Open the script editor

1. Open the **Horror HQ Database** sheet in Google Sheets.
2. Click **Extensions ▸ Apps Script**. A new tab opens with an empty project.
3. Click the title "Untitled project" at the top and rename it **Horror HQ**.

## 2. Show the settings file

1. Click the **⚙️ gear (Project Settings)** in the left sidebar.
2. Tick **Show "appsscript.json" manifest file in editor**.
3. Click the **< > (Editor)** icon in the left sidebar to go back.

## 3. Paste two files

1. Click **appsscript.json** in the file list. Select everything in it and replace it with the contents of
   [`src/appsscript.json`](src/appsscript.json).
2. Click **Code.gs**. Select everything and replace it with the contents of [`src/Updater.gs`](src/Updater.gs).
3. Press **Ctrl+S** (or **Cmd+S**) to save.

## 4. Switch on the Apps Script API

1. Open <https://script.google.com/home/usersettings>.
2. Turn **Google Apps Script API** to **On**.

## 5. Run the installer

1. Back in the script editor, pick **installLatestUpdate** in the function dropdown next to **▷ Run**.
2. Click **▷ Run**. Google asks for permission:
   - **Review permissions** ▸ pick your account.
   - You'll see "Google hasn't verified this app". That's normal: it's your own script, not a published app.
     Click **Advanced ▸ Go to Horror HQ (unsafe) ▸ Allow**.
3. The execution log at the bottom should end with
   `Installed … Horror HQ lives at https://script.google.com/macros/s/…/exec`. That link is your app; bookmark it.

If it says to switch on the Apps Script API, wait a minute after step 4 and run it again.

## 6. Move the data in

1. Go back to the **Horror HQ Database** sheet and reload the page.
2. A **🎃 Horror HQ** menu appears. Click **Run migration from the old sheet** and approve if asked.
3. When it finishes, the **Migration Report** tab shows every count from the old sheet next to the migrated one.
   The old sheet is only read, never changed.

Then tell Claude it's done.
