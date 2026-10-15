// Electron entry point: opens DJ Dudes in its own desktop window.
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: 'DJ Dudes',
    backgroundColor: '#0e0f13',
    autoHideMenuBar: true,
    webPreferences: {
      // Keep timers running at full speed when minimised so automix never misses a cue.
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
