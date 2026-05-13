# GrooveDropper

   Welcome to GrooveDropper, a random "needle drop" sample picker. 

![Groovedropper Banner](docs/images/groovedropper-banner.png)

If you like to be surprised by "the drop of a needle", and get inspired by a 
melodic, vocal or other sample to start a beat, this application might be 
for you!

GrooveDropper is designed to randomly pick samples from _your_ digital 
sample library, which could be vinyl recordings, melodics, whole songs, 
whatever you want to randomly pick from. 
It will pick a wave file at random and randomly plays a section in the
sample, hence the "needle dropping". 

❤️ This application is a labor of love and I created this application as I 
could not find a single tool that actually randomizes sample selection, support 
some tagging and allow me to dig through thousands of sample chops I collected 
over the years.

## Known issues

- Using `run_gui.sh` under Linux (using pywebview) will not pitch down past 
  -3 semitones. This works running in a native browser (use `run.sh`)

## FAQ

- Is GrooveDropper free? — Yes, it is created in my spare time, and I will 
  work on it when time allows.
- Is GrooveDropper local? — Yes it is 100% local, it runs python (Flask) and 
  uses SQLite for the indexing and a web front-end.
- Are my samples safe? — Yes, it only indexes them and builds the database 
  and plays the samples, you cannot edit / delete them accidentally
- Can I contribute? — Yes, just file a ticket and make sure you clarify the 
  bug, or the feature you want
- Why do I have to give a database location? — Because some flavors of Python 
  (on Windows) virtualize everything and the database location will end up 
  in a hidden folder in `%APDATA%` which makes it hard to copy or backup.

## Features

- Lets you randomize a sample based upon the indexed samples, or randomize 
  in the sample itself
- You can index multiple folders, and auto-label the folders
- You can go back in history if you liked a sample that played in the past
- You can change the pitch on the fly to play with the key to see if it matches 
  your song
- You can add or edit tags to filter the random picking
- You can add presets which toggle on or off a set of labels
- You can add the samples you find to a vibe list, to group together 
  matching samples and pitches
- The links are sharable, which means the URL that you copy out could work 
  for someone else (if they have the same sample), or from a note if a chop 
  matches a future song 
- The randomly selected sample drop location can be exported out as a 
  sample slice and downloaded to import into your sampler or DAW.

Check [the manual](docs/USER-MANUAL.md) for a more in depth guide. 

## Usage

This project consists of a Python backend (Flask API + SQLite database) and 
a web front-end. Run it from the command line, it will automatically open a 
tab in your default web browser.

### Windows

Install Python if you haven't already:

```bat
> winget install python
```

Then run from the project directory:

```bat
> bin\run.bat "C:\users\{yourname}\groovedropper.db"
```

The batch file creates a virtual environment and installs all required packages automatically. 
There is also a PowerShell variant:

```powershell
> .\bin\run.ps1 "C:\users\{yourname}\groovedropper.db"
```

### Linux / MacOS

Install Python 3 via your package manager if needed (e.g. `sudo apt install 
python3` on Ubuntu/Debian), then:

```bash
# install your pip, python3-venv as well
> chmod +x bin/run.sh
> ./bin/run.sh ~/groovedropper.db
```

### Command line arguments

Once the browser opens, use the **Add Folder** button in the UI to point 
GrooveDropper at your directory of `.wav` files. Folders and their labels 
are managed through the web interface and persisted in the database.

- `--db-file`: The SQLite database file (e.g. `groovedropper.db`). This file 
  will be created if it does not exist.
- `--port` *(optional)*: Port to serve the app on (default is 5000).
- `--refresh` *(optional)*: Pass this flag to drop all existing data and 
  rescan everything from scratch.
- `--no-browser` *(optional)*: Start the server without opening a browser tab.

### Running as a desktop window (pywebview)

If you prefer a native application window instead of a browser tab, use the `run_gui` 
scripts. They use [pywebview](https://pywebview.flowrl.com/), which wraps the platform 
WebView (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux). No additional 
runtime is required — WebView2 ships with Windows 10/11.

### Windows
```bat
> bin\run_gui.bat "C:\users\{yourname}\groovedropper.db"
```

### Linux / MacOS

**NOTE:** This unfortunately does not yet work, feedback or contributions 
are welcome.

```bash
> chmod +x bin/run_gui.sh
> ./bin/run_gui.sh ~/groovedropper.db
```

## Building a distributable

Coming soon™

## AI disclaimer

I am a developer by profession for 30+ years, and I am adept in Python 
(since 2.7). However, due to time constraints and lack of knowledge in CSS + 
Javascript, I used Claude to generate most of the front-end, and some of the 
code generated in the back-end, but I made sure to review it all. This project 
took me a few weeks to make, which otherwise would have taken many months. I 
take code quality very seriously and only accept changes which I understand 
myself.

✅ I test all features extensively, and only release a new version if nothing 
breaks.

## Built With
- **Python / Flask** - Backend API and static file server.
- **SQLite** - Fast, local, file-based database for tracking files and history.
- **Soundfile / Numpy / Pillow** - For analyzing audio and generating the custom waveform images.
- **pywebview** - Optional native desktop window (WebView2/WKWebView/WebKitGTK).
- **HTML / Vanilla JS / CSS** - The front end. No heavy frameworks!