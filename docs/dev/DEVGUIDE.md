---
topic: devguide
related-files:
  - package.json
  - Makefile
  - .vscode/settings.json
last-reviewed: 2026-10-09
---

# Dev guide

This guide gets JellyRock's source code running on your own Roku. With it set up, you can change the code, try a build before it is released, and send the developers logs when you hit a bug.

## Developer mode

Put your Roku in [developer mode](developer-mode.md). Write down your Roku's IP address and the password you create, because the steps below ask for both.

## Get the code

Clone the repository, then open its folder:

```bash
git clone https://github.com/jellyrock/jellyrock.git
cd jellyrock
```

## Install dependencies

You need [`node`](https://nodejs.org) 22 (22.22.1 or later), 24, or 26 and later. Then install the dependencies:

```bash
npm install
```

## Method 1: Visual Studio Code

We recommend Visual Studio Code for this project. Its [BrightScript Language extension](https://marketplace.visualstudio.com/items?itemName=RokuCommunity.brightscript) checks your code as you type, and lets you set breakpoints, inspect variables while the app runs, format code and drive the Roku from the editor. See its [feature list](https://rokucommunity.github.io/vscode-brightscript-language/features.html) for more.

### Set up Visual Studio Code

1. Install [Visual Studio Code](https://code.visualstudio.com/).
2. Install the **BrightScript Language** extension from the **Extensions** panel, or from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=RokuCommunity.brightscript).
3. Install the other extensions the workspace recommends (listed in `.vscode/extensions.json`). If you edit JavaScript or JSON, **Prettier** and **ESLint** matter most: the workspace formats those files with Prettier on save, as the pre-commit hook does.

### Run the app

1. Open the `jellyrock` folder in Visual Studio Code.
2. Press `F5`, or choose **Run → Start Debugging**. ![The Run menu with Start Debugging highlighted](https://user-images.githubusercontent.com/2544493/170696233-8ba49bf4-bebb-4655-88f3-ac45150dda02.png)
3. When asked, enter your Roku's IP address and developer password.

Visual Studio Code builds the app, installs it on your Roku and starts it.

### Save your Roku's address and password

By default the extension asks for the Roku and its password on every run. To skip that, set them in your Visual Studio Code user settings:

```json
{
  "brightscript.debug.host": "YOUR_ROKU_HOST_HERE",
  "brightscript.debug.password": "YOUR_ROKU_DEV_PASSWORD_HERE"
}
```

![The two settings in a user settings file](https://user-images.githubusercontent.com/2544493/170485209-0dbe6787-8026-47e7-9095-1df96cda8a0a.png)

Put them in your user settings, not in `.vscode/launch.json`, so your password stays out of the repository.

## Method 2: Command line

You need [`make`](https://www.gnu.org/software/make) and [`curl`](https://curl.se).

### Install on your Roku

Tell `make` which Roku to use, with the IP address and password from [developer mode](#developer-mode):

```bash
export ROKU_DEV_TARGET=192.168.1.234
export ROKU_DEV_PASSWORD=password
```

Then build the app, install it and start it:

```bash
make build-dev install
```

Run this after every change. Plain `make install` installs whatever is already in `out/jellyrock.zip`, so it skips your latest changes once a build exists.

If you only want to run the latest code, not change it, you need to install once. The app stays on your Roku after a restart.

### Bug/crash reports

When the app crashes or misbehaves, open the Roku's debug log to see what went wrong:

```bash
telnet ${ROKU_DEV_TARGET} 8085
```

To leave telnet, press `Ctrl + ]`, then type `quit` and press Enter.

To add a picture of the screen to your report, take a screenshot. It is saved as `screenshot.jpg` in the project folder:

```bash
make screenshot
```

Then [open an issue](https://github.com/jellyrock/jellyrock/issues) with the log and the screenshot.

## Committing

Git hooks check your work, so you rarely need to run the linters yourself. Before each commit, the pre-commit hook formats, lints and spell-checks the files you staged. Before each push, the pre-push hook runs the checks that need the whole project (the BrighterScript compile and lint, the docs checks and the script tests) for the files in the push. It also regenerates the translation keys and the index of these dev guides, and commits them for you. CI runs the same checks on every pull request.

To debug one failure before you push, run that check's script, for example `npm run lint:translations`, rather than the whole `npm run lint`.
