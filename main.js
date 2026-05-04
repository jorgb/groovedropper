const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

let mainWindow;
let flaskProcess = null;
const port = 5000;

function getSettingsPath() {
    return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
    try {
        return JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8'));
    } catch {
        return {};
    }
}

function saveSettings(settings) {
    fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
}

function getBackendBinary() {
    if (app.isPackaged) {
        const name = process.platform === 'win32' ? 'groove_backend.exe' : 'groove_backend';
        return path.join(process.resourcesPath, 'backend', name);
    }
    return null;
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
        },
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
        if (flaskProcess) flaskProcess.kill();
    });
}

async function resolveDbFile() {
    // CLI arg takes precedence (dev / manual launch)
    const cliArg = process.argv.find(arg => arg.startsWith('--db-file='));
    if (cliArg) return cliArg.split('=')[1];

    // Stored from a previous run
    const settings = loadSettings();
    if (settings.dbFile) return settings.dbFile;

    // First run: ask the user where to place the database
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Choose where to store the GrooveDropper database',
        defaultPath: path.join(app.getPath('documents'), 'groovedropper.db'),
        filters: [{ name: 'SQLite Database', extensions: ['db'] }],
        buttonLabel: 'Use this location',
    });

    if (result.canceled || !result.filePath) {
        app.quit();
        return null;
    }

    saveSettings({ ...settings, dbFile: result.filePath });
    return result.filePath;
}

function startFlask(dbFile) {
    const binary = getBackendBinary();
    let cmd, args;

    if (binary) {
        cmd = binary;
        args = ['--db-file', dbFile, '--port', port.toString(), '--no-browser'];
    } else {
        cmd = process.platform === 'win32' ? 'python' : 'python3';
        args = [path.join(__dirname, 'app.py'), '--db-file', dbFile, '--port', port.toString(), '--no-browser'];
    }

    flaskProcess = spawn(cmd, args);
    flaskProcess.stdout.on('data', (data) => console.log(`Flask: ${data}`));
    flaskProcess.stderr.on('data', (data) => console.error(`Flask Error: ${data}`));
    flaskProcess.on('close', (code) => console.log(`Flask process exited with code ${code}`));
}

function waitForFlask(url, maxRetries = 40, delayMs = 500) {
    return new Promise((resolve, reject) => {
        const attempt = (retriesLeft) => {
            http.get(url, (res) => {
                res.resume();
                resolve();
            }).on('error', () => {
                if (retriesLeft <= 0) {
                    reject(new Error('Flask server did not start in time'));
                    return;
                }
                setTimeout(() => attempt(retriesLeft - 1), delayMs);
            });
        };
        attempt(maxRetries);
    });
}

app.on('ready', async () => {
    createWindow();

    const dbFile = await resolveDbFile();
    if (!dbFile) return;

    startFlask(dbFile);

    try {
        await waitForFlask(`http://127.0.0.1:${port}`);
        if (mainWindow) mainWindow.loadURL(`http://127.0.0.1:${port}`);
    } catch (err) {
        console.error('Flask failed to start:', err);
        dialog.showErrorBox('Backend Error', 'The Flask server failed to start. Check the terminal for details.');
        app.quit();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (mainWindow === null) createWindow();
});

app.on('will-quit', () => {
    if (flaskProcess) flaskProcess.kill();
});
