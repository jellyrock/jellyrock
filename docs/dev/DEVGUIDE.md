---
topic: devguide
related-files:
  - package.json
  - Makefile
  - .vscode/settings.json
last-reviewed: 2026-05-01
---

# Dev Guide

Follow the steps below to install the app on your personal Roku device. This will enable you to write code for the app, install the latest beta release, as well as provide app logs to the developers if you encounter a bug.

## Developer Mode

Put your Roku device in [developer mode](https://blog.roku.com/developer/2016/02/04/developer-setup-guide). Write down your Roku device IP and the password you created - you will need these!

## Clone the GitHub Repo

Navigate to where you'd like to install the app then copy the application files:

```bash
git clone https://github.com/jellyrock/jellyrock.git
```

Open up the new folder:

```bash
cd jellyrock
```

## Install Dependencies

You'll need [`node`](https://nodejs.org), version 16 at least.

Then, use `npm` to install dependencies

```bash
npm install
```

## Method 1: Visual Studio Code

We recommend using Visual Studio Code when working on this project. The [BrightScript Language extension](https://marketplace.visualstudio.com/items?itemName=RokuCommunity.brightscript) provides a rich debugging experience, including in-editor syntax checking, debugging/breakpoint support, variable inspection at runtime, auto-formatting, an integrated remote control mode, and [much more](https://rokucommunity.github.io/vscode-brightscript-language/features.html).

### Install VSCode

1. Download and install [Visual Studio Code](https://code.visualstudio.com/)
2. Install the **BrightScript Language** extension within VSCode in the _Extensions_ panel or by downloading it from the [VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=RokuCommunity.brightscript).

### Usage

1. Open the `jellyrock` folder in VSCode
2. Press `F5` on your keyboard or click `Run` -> `Start Debugging` from the VSCode menu. ![image](https://user-images.githubusercontent.com/2544493/170696233-8ba49bf4-bebb-4655-88f3-ac45150dda02.png)

3. Enter your Roku IP address and developer password when prompted

That's it! VSCode will auto-package the project, sideload it to the specified device, and the channel is up and running. (assuming you remembered to put your device in [developer mode](#developer-mode))

### Hardcoding Roku Information

Out of the box, the BrightScript extension will prompt you to pick a Roku device (from devices found on your local network) and enter a password on every launch. If you'd prefer to hardcode this information rather than entering it every time, you can set these values in your VSCode user settings:

```json
{
  "brightscript.debug.host": "YOUR_ROKU_HOST_HERE",
  "brightscript.debug.password": "YOUR_ROKU_DEV_PASSWORD_HERE"
}
```

Example:
![image](https://user-images.githubusercontent.com/2544493/170485209-0dbe6787-8026-47e7-9095-1df96cda8a0a.png)

## Method 2: Command Line

### Workflow

Modify code -> `make build-dev install` -> Use Roku remote to test changes -> `telnet ${ROKU_DEV_TARGET} 8085` -> `CTRL + ]` -> `quit + ENTER`

You will need to use telnet to see log statements, warnings, and error reports. You won't always need to telnet into your device but the workflow above is typical when you are new to BrightScript or are working on tricky code.

### Install Command Line Dependencies

You'll need [`make`](https://www.gnu.org/software/make) and [`curl`](https://curl.se).

Build the package

```bash
make build-dev
```

This will create a zip in `out/jellyrock.zip`, that you can upload on your Roku's device via your browser.
Or you can continue with the next steps to do it via the command line.

### Deploy

Run this command - replacing the IP and password with your Roku device IP and dev password from the first step:

```bash
export ROKU_DEV_TARGET=192.168.1.234
export ROKU_DEV_PASSWORD=password
```

Package up the application, send it to your Roku, and launch the channel:

```bash
make install
```

Note: You only have to run this command once if you are not a developer. The JellyRock channel will still be installed after rebooting your Roku device.

### Bug/Crash Reports

Did the app crash? Find a nasty bug? Use this command to view the error log and [report it to the developers](https://github.com/jellyrock/jellyrock/issues):

```bash
telnet ${ROKU_DEV_TARGET} 8085
```

To exit telnet: `CTRL + ]` and then type `quit + ENTER`

You can also take a screenshot of the app to augment the bug report.

```bash
make screenshot
```

## Committing

Before committing your code, please run:

```bash
npm run lint
```

And fix any encountered issue.
